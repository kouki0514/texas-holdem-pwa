"use strict";
/**
 * claudeServer.ts
 *
 * Server-side Claude API integration.
 * The ANTHROPIC_API_KEY is read from process.env and never exposed to clients.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeDecideAction = claudeDecideAction;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const config_1 = require("./config");
// ──────────────────────────────────────────────────────────────────────────────
// Lazy client (initialized once)
// ──────────────────────────────────────────────────────────────────────────────
let _client = null;
function getClient() {
    if (!_client) {
        if (!config_1.config.anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY is not set in server environment');
        }
        // No dangerouslyAllowBrowser needed — this is Node.js
        _client = new sdk_1.default({ apiKey: config_1.config.anthropicApiKey });
    }
    return _client;
}
// ──────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────────────────────────────────────
const SUIT_SYM = {
    spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};
function fmt(card) {
    return `${card.rank}${SUIT_SYM[card.suit]}`;
}
function fmtCards(cards) {
    return cards.length === 0 ? '(なし)' : cards.map(fmt).join(' ');
}
function fmtHistory(history, players) {
    if (history.length === 0)
        return '  (アクションなし)';
    return history
        .map((a) => {
        const name = players.find((p) => p.id === a.playerId)?.name ?? '?';
        return `  ${name}: ${a.action}${a.amount != null ? ` ${a.amount}` : ''}`;
    })
        .join('\n');
}
function positionLabel(players, player, dealerIdx) {
    const n = players.length;
    const pos = (players.indexOf(player) - dealerIdx + n) % n;
    if (n === 2)
        return pos === 0 ? 'BTN/SB' : 'BB';
    const m = { 0: 'BTN', 1: 'SB', 2: 'BB' };
    return m[pos] ?? `MP+${pos - 2}`;
}
// ──────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ──────────────────────────────────────────────────────────────────────────────
function buildPrompt(state, player) {
    const toCall = Math.max(0, state.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    const pot = state.pots.reduce((s, p) => s + p.amount, 0);
    const minRaise = state.currentBet + state.minRaise;
    const maxBet = player.chips + player.currentBet;
    const pos = positionLabel(state.players, player, state.dealerIndex);
    const validActions = [
        'fold',
        canCheck ? 'check' : `call (コール額: ${toCall})`,
        player.chips > toCall
            ? `raise (最小: ${minRaise} ～ 最大: ${maxBet})`
            : null,
        `all-in (${player.chips} chips)`,
    ]
        .filter(Boolean)
        .map((a) => `  • ${a}`)
        .join('\n');
    const opponents = state.players
        .filter((p) => p.id !== player.id && !p.isFolded)
        .map((p) => `  ${p.name}: ${p.isAllIn ? 'all-in' : `${p.chips}chips`}、ベット${p.currentBet}`)
        .join('\n') || '  (なし)';
    return `あなたはテキサスホールデムポーカーの熟練プレイヤー「${player.name}」です。
現在の状況を分析し、最適なアクションを選択してください。

## あなたの手札
- ホールカード : ${fmtCards(player.holeCards)}
- ポジション   : ${pos}
- スタック     : ${player.chips} chips
- このストリートのベット額 : ${player.currentBet}

## ボード
- フェーズ         : ${state.phase}
- コミュニティカード: ${fmtCards(state.communityCards)}
- ポット           : ${pot} chips
- 現在のベット     : ${state.currentBet} chips（コールに必要: ${toCall}）
- 最小レイズ       : ${minRaise} chips
- ビッグブラインド : ${state.bigBlind}

## アクティブな相手
${opponents}

## このハンドのアクション履歴
${fmtHistory(state.actionHistory, state.players)}

## 選択可能なアクション
${validActions}

## 回答形式
マークダウンなし、JSONのみで回答してください:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in",
  "amount": <raiseの場合のみ必須、このストリートの合計ベット額>,
  "reasoning": "<1〜2文で判断理由を日本語で説明>"
}

制約:
- check は toCall=0 のときのみ有効
- raise の amount は ${minRaise} 以上 ${maxBet} 以下
- raise できない場合は all-in を使用`;
}
// ──────────────────────────────────────────────────────────────────────────────
// Response validation
// ──────────────────────────────────────────────────────────────────────────────
function extractJson(text) {
    const stripped = text.replace(/```[a-z]*\n?/gi, '').trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1)
        throw new Error('JSON object not found');
    return JSON.parse(stripped.slice(start, end + 1));
}
function sanitise(raw, state, player) {
    const toCall = Math.max(0, state.currentBet - player.currentBet);
    const canCheck = toCall === 0;
    const minRaise = state.currentBet + state.minRaise;
    const maxBet = player.chips + player.currentBet;
    const reasoning = typeof raw.reasoning === 'string' && raw.reasoning.trim()
        ? raw.reasoning.trim()
        : '最善手を選択しました。';
    const validActions = ['fold', 'check', 'call', 'raise', 'all-in'];
    let action = raw.action;
    if (!validActions.includes(action))
        action = canCheck ? 'check' : 'call';
    if (action === 'check' && !canCheck)
        action = 'call';
    if (action === 'raise') {
        const amt = typeof raw.amount === 'number' ? raw.amount : minRaise;
        const clamped = Math.max(minRaise, Math.min(amt, maxBet));
        if (clamped >= maxBet)
            return { action: 'all-in', reasoning };
        return { action: 'raise', amount: clamped, reasoning };
    }
    return { action, reasoning };
}
// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────
async function claudeDecideAction(state, player) {
    const client = getClient();
    const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: buildPrompt(state, player),
        messages: [{ role: 'user', content: 'あなたの番です。アクションを選んでください。' }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text block in Claude response');
    }
    return sanitise(extractJson(textBlock.text), state, player);
}
