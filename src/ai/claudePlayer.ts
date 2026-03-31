/**
 * claudePlayer.ts
 *
 * ⚠️  Security notice:
 * VITE_ANTHROPIC_API_KEY is a VITE_ env variable, meaning it is bundled into
 * the client-side JavaScript. Never use this in production without a backend
 * proxy. This implementation is intended for local development and trusted
 * environments only.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ActionType, Card, GameState, Player, PlayerAction } from '@/game/types'

// ──────────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────────

export interface ClaudeDecision {
  action: ActionType
  /** Total bet size this street (only for 'raise') */
  amount?: number
  reasoning: string
}

// Expected JSON shape from the model
interface RawDecision {
  action: string
  amount?: number
  reasoning?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Card formatting helpers
// ──────────────────────────────────────────────────────────────────────────────

const SUIT_SYMBOL: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}

function formatCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

function formatCards(cards: Card[]): string {
  return cards.length === 0 ? '(none)' : cards.map(formatCard).join(' ')
}

// ──────────────────────────────────────────────────────────────────────────────
// Position label
// ──────────────────────────────────────────────────────────────────────────────

function getPositionLabel(
  players: Player[],
  player: Player,
  dealerIndex: number,
): string {
  const n = players.length
  const pos = (players.indexOf(player) - dealerIndex + n) % n
  if (n === 2) return pos === 0 ? 'BTN/SB (Dealer/Small Blind)' : 'BB (Big Blind)'
  const labels: Record<number, string> = {
    0: 'BTN (Dealer)',
    1: 'SB (Small Blind)',
    2: 'BB (Big Blind)',
  }
  return labels[pos] ?? `MP+${pos - 2}`
}

// ──────────────────────────────────────────────────────────────────────────────
// Action history formatter
// ──────────────────────────────────────────────────────────────────────────────

function formatActionHistory(history: PlayerAction[], players: Player[]): string {
  if (history.length === 0) return '  (no actions yet)'
  return history
    .map((a) => {
      const name = players.find((p) => p.id === a.playerId)?.name ?? a.playerId
      const amtStr = a.amount != null ? ` ${a.amount}` : ''
      return `  ${name}: ${a.action}${amtStr}`
    })
    .join('\n')
}

// ──────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ──────────────────────────────────────────────────────────────────────────────

/** Classify hole cards into a preflop strength tier */
function classifyHoleCards(cards: [Card, Card]): string {
  const [a, b] = cards
  const ranks = [a.rank, b.rank]
  const suited = a.suit === b.suit
  const suitedStr = suited ? 's' : 'o'

  const rankVal: Record<string, number> = {
    A: 14, K: 13, Q: 12, J: 11, '10': 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
  }
  const [hi, lo] = [rankVal[ranks[0]], rankVal[ranks[1]]].sort((x, y) => y - x)
  const isPair = hi === lo
  const gap = hi - lo
  const combo = isPair ? `${a.rank}${b.rank}` : `${cards.find(c => rankVal[c.rank] === hi)!.rank}${cards.find(c => rankVal[c.rank] === lo)!.rank}${suitedStr}`

  // Tier 1: Premium
  if (isPair && hi >= 10) return `${combo} — Tier1 Premium (3-bet/raise for value always)`
  if (!isPair && hi === 14 && lo >= 12) return `${combo} — Tier1 Premium (3-bet/raise for value always)`
  // Tier 2: Strong
  if (isPair && hi >= 7) return `${combo} — Tier2 Strong (raise/call 3-bet in position)`
  if (!isPair && hi === 14 && lo >= 9) return `${combo} — Tier2 Strong (raise, call 3-bet IP)`
  if (!isPair && hi === 13 && lo >= 11) return `${combo} — Tier2 Strong (raise, fold to 4-bet OOP)`
  if (!isPair && suited && hi >= 11 && gap <= 1) return `${combo} — Tier2 Strong (suited broadways)`
  // Tier 3: Playable
  if (isPair) return `${combo} — Tier3 Playable (raise, fold to large 3-bet OOP)`
  if (suited && gap <= 2 && hi >= 8) return `${combo} — Tier3 Playable (suited connector, raise BTN/CO, fold OOP to 3-bet)`
  if (!isPair && hi >= 10 && lo >= 9) return `${combo} — Tier3 Playable (raise LP, call raise IP)`
  // Tier 4: Speculative
  if (suited && gap <= 3) return `${combo} — Tier4 Speculative (suited gapper, raise BTN only, fold to aggression)`
  if (!isPair && hi >= 10 && gap <= 3) return `${combo} — Tier4 Speculative (offsuit connector, play cautiously)`
  // Tier 5: Weak/Fold
  return `${combo} — Tier5 Weak (fold from EP/MP, bluff-raise BTN occasionally)`
}

function buildSystemPrompt(state: GameState, player: Player): string {
  const holeCards = player.holeCards as [Card, Card]
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const totalPot = state.pots.reduce((s, p) => s + p.amount, 0)
  const position = getPositionLabel(state.players, player, state.dealerIndex)
  const minRaiseTotal = state.currentBet + state.minRaise

  // ── Pot odds & required equity ──────────────────────────────────────────────
  const potOdds = toCall > 0 ? toCall / (totalPot + toCall) : 0
  const potOddsStr = toCall > 0
    ? `${(potOdds * 100).toFixed(1)}% (call ${toCall} into pot-after-call ${totalPot + toCall})`
    : 'N/A (no call required)'

  // ── SPR (Stack-to-Pot Ratio) ─────────────────────────────────────────────────
  const effectiveStack = Math.min(
    player.chips,
    ...state.players.filter((p) => p.id !== player.id && !p.isFolded).map((p) => p.chips),
  )
  const spr = totalPot > 0 ? (effectiveStack / totalPot) : 999
  let sprNote: string
  if (spr <= 3) sprNote = `${spr.toFixed(1)} — LOW: commit with top pair+, avoid fancy play`
  else if (spr <= 10) sprNote = `${spr.toFixed(1)} — MEDIUM: prefer sets/two-pair+ to stack off; draws need good odds`
  else sprNote = `${spr.toFixed(1)} — HIGH: implied odds matter; speculative hands gain value`

  // ── Opponent bet sizing relative to pot ─────────────────────────────────────
  let betSizeNote = 'N/A'
  if (state.currentBet > 0 && totalPot > 0) {
    const ratio = state.currentBet / totalPot
    if (ratio <= 0.4) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — small bet: wide continuing range, re-raise bluffs viable`
    else if (ratio <= 0.6) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — half-pot: balanced range; need ~25% equity to call`
    else if (ratio <= 0.85) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — 2/3 pot: polarised range; need ~32% equity`
    else betSizeNote = `${(ratio * 100).toFixed(0)}% pot — pot-size+: very polarised; need ~40%+ equity, fold marginal hands`
  }

  // ── Position-based strategy note ────────────────────────────────────────────
  const posLower = position.toLowerCase()
  let posStrategy: string
  if (posLower.includes('btn')) {
    posStrategy = 'BTN: widest open-raise range (~45-50% hands), steal often, apply max pressure post-flop IP'
  } else if (posLower.includes('co')) {
    posStrategy = 'CO: open ~30% hands, 3-bet squeeze BTN/SB, play aggressively IP'
  } else if (posLower.includes('sb')) {
    posStrategy = 'SB: defend wide vs BTN steal (call/3-bet), but OOP post-flop — prefer 3-bet over call to deny equity'
  } else if (posLower.includes('bb')) {
    posStrategy = 'BB: getting best price, defend wide (pot odds), check-raise as primary weapon OOP'
  } else {
    posStrategy = 'EP/MP: tight range, raise for value/protection, fold to 3-bets without premiums'
  }

  // ── Bluff frequency guidance ─────────────────────────────────────────────────
  // GTO bluff:value ratio based on bet size — bluffs / (bluffs + value) = pot_odds
  const bluffRatio = toCall > 0
    ? `To keep opponent indifferent: bluff ${(potOdds * 100).toFixed(0)}% of your betting range (matching their pot odds)`
    : 'Set your own bet size — 1/3 pot needs 25% bluffs, 1/2 pot needs 33%, 2/3 pot needs 40%'

  // ── Hole card strength ───────────────────────────────────────────────────────
  const handStrength = classifyHoleCards(holeCards)

  // ── Valid actions list ───────────────────────────────────────────────────────
  const validActions: string[] = ['fold']
  if (canCheck) {
    validActions.push('check')
  } else {
    validActions.push(`call (cost: ${toCall} chips)`)
  }
  if (player.chips > toCall) {
    validActions.push(
      `raise (min total bet: ${minRaiseTotal}, max: ${player.chips + player.currentBet} chips)`,
    )
  }
  validActions.push(`all-in (push ${player.chips} chips)`)

  // ── Active opponents ─────────────────────────────────────────────────────────
  const opponents = state.players
    .filter((p) => p.id !== player.id && !p.isFolded)
    .map((p) => {
      const flags = [
        p.isAllIn ? 'all-in' : `${p.chips} chips`,
        p.currentBet > 0 ? `bet ${p.currentBet}` : '',
      ]
        .filter(Boolean)
        .join(', ')
      return `  ${p.name}: ${flags}`
    })
    .join('\n')

  return `You are a GTO-trained Texas Hold'em expert named "${player.name}". Make decisions using pot odds, SPR, position, hand strength, and balanced bluff/value ratios. Always reason step-by-step before deciding.

## Situation
- Phase           : ${state.phase}
- Position        : ${position}
- Hole cards      : ${formatCards(holeCards)}
- Hand strength   : ${handStrength}
- Community cards : ${formatCards(state.communityCards)}
- Stack           : ${player.chips} chips  |  Current bet this street: ${player.currentBet}
- Pot             : ${totalPot} chips  |  To call: ${toCall}  |  Big blind: ${state.bigBlind}
- Min raise to    : ${minRaiseTotal} chips

## Quantitative Metrics
- Pot odds (if calling)  : ${potOddsStr}
- SPR                    : ${sprNote}
- Opponent bet vs pot    : ${betSizeNote}

## Strategic Context
- Position strategy : ${posStrategy}
- Bluff frequency   : ${bluffRatio}

## Active Opponents
${opponents || '  (none remaining)'}

## Action History This Hand
${formatActionHistory(state.actionHistory, state.players)}

## Decision Framework
1. Check hand tier vs pot odds — if equity < pot odds and no draw, fold.
2. Apply SPR: low SPR → commit or fold; high SPR → implied odds matter.
3. In position (BTN/CO): apply pressure with wide range; out of position (SB/BB): prefer check-raise over donk-bet.
4. Large opponent bets (>2/3 pot) = polarised → re-raise or fold, rarely call.
5. Maintain bluff/value balance: bluff combos ≈ pot-odds% of your total betting range.

## Your Valid Actions
${validActions.map((a) => `  • ${a}`).join('\n')}

## Response Format
Respond with ONLY a JSON object — no markdown, no extra text:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in",
  "amount": <integer, REQUIRED when action is "raise" — total bet size this street>,
  "reasoning": "<2-3 sentences: state pot odds/SPR/hand tier used, then explain decision in Japanese>"
}

Constraints:
- "check" only valid when toCall === 0
- "raise" amount must be ≥ ${minRaiseTotal} and ≤ ${player.chips + player.currentBet}
- If you cannot afford a raise, use "all-in" instead
- reasoning must be written in Japanese`
}

// ──────────────────────────────────────────────────────────────────────────────
// Response validation / sanitisation
// ──────────────────────────────────────────────────────────────────────────────

function sanitise(
  raw: RawDecision,
  state: GameState,
  player: Player,
): ClaudeDecision {
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const minRaiseTotal = state.currentBet + state.minRaise
  const maxBet = player.chips + player.currentBet
  const reasoning = raw.reasoning?.trim() || '最善手を選択しました。'

  // Validate action
  const validActions: ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in']
  let action = raw.action as ActionType
  if (!validActions.includes(action)) action = canCheck ? 'check' : 'call'

  // Fix illegal check
  if (action === 'check' && !canCheck) action = 'call'

  // Fix raise amount
  if (action === 'raise') {
    const amt = typeof raw.amount === 'number' ? raw.amount : minRaiseTotal
    const clamped = Math.max(minRaiseTotal, Math.min(amt, maxBet))
    if (clamped >= maxBet) return { action: 'all-in', reasoning }
    return { action: 'raise', amount: clamped, reasoning }
  }

  return { action, reasoning }
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON extraction (handles ```json fences, trailing commas, etc.)
// ──────────────────────────────────────────────────────────────────────────────

function extractJson(text: string): RawDecision {
  // Strip markdown code fences
  const stripped = text.replace(/```[a-z]*\n?/gi, '').trim()

  // Find the first {...} block
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in response')

  const jsonStr = stripped.slice(start, end + 1)
  return JSON.parse(jsonStr) as RawDecision
}

// ──────────────────────────────────────────────────────────────────────────────
// Lazy-initialised Anthropic client (one instance per page load)
// ──────────────────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY is not set')
    _client = new Anthropic({
      apiKey,
      /**
       * ⚠️  Required for browser usage.
       * The API key will be visible in network requests and client bundles.
       * Use a backend proxy for any production or public-facing deployment.
       */
      dangerouslyAllowBrowser: true,
    })
  }
  return _client
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Ask Claude to decide a poker action for `player` in the given `state`.
 *
 * On any API or parsing error the function throws — callers should catch and
 * fall back to the rule-based AI.
 */
export async function claudeDecideAction(
  state: GameState,
  player: Player,
): Promise<ClaudeDecision> {
  const client = getClient()
  const systemPrompt = buildSystemPrompt(state, player)

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: 'アクションを選んでください。',
      },
    ],
  } as Parameters<typeof client.messages.create>[0])

  // Extract text content
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in Claude response')
  }

  const raw = extractJson(textBlock.text)
  return sanitise(raw, state, player)
}
