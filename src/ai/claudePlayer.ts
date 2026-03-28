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

function buildSystemPrompt(state: GameState, player: Player): string {
  const holeCards = player.holeCards as [Card, Card]
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const totalPot = state.pots.reduce((s, p) => s + p.amount, 0)
  const position = getPositionLabel(state.players, player, state.dealerIndex)

  // Valid actions list
  const validActions: string[] = ['fold']
  if (canCheck) {
    validActions.push('check')
  } else {
    validActions.push(`call (cost: ${toCall} chips)`)
  }
  const minRaiseTotal = state.currentBet + state.minRaise
  if (player.chips > toCall) {
    validActions.push(
      `raise (min total bet: ${minRaiseTotal}, max: ${player.chips + player.currentBet} chips)`,
    )
  }
  validActions.push(`all-in (push ${player.chips} chips)`)

  // Other active players summary
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

  return `You are an expert Texas Hold'em poker player named "${player.name}".
Analyze the situation and choose the optimal action.

## Your Hand
- Hole cards : ${formatCards(holeCards)}
- Position   : ${position}
- Stack      : ${player.chips} chips
- Current bet this street : ${player.currentBet} chips

## Board
- Phase           : ${state.phase}
- Community cards : ${formatCards(state.communityCards)}
- Pot             : ${totalPot} chips
- Table bet       : ${state.currentBet} chips (you need ${toCall} to call)
- Min raise to    : ${minRaiseTotal} chips
- Big blind       : ${state.bigBlind} chips

## Active Opponents
${opponents || '  (none remaining)'}

## Action History This Hand
${formatActionHistory(state.actionHistory, state.players)}

## Your Valid Actions
${validActions.map((a) => `  • ${a}`).join('\n')}

## Response Format
Respond with ONLY a JSON object — no markdown, no extra text:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in",
  "amount": <integer, REQUIRED when action is "raise" — total bet size this street>,
  "reasoning": "<1-2 sentences explaining your decision in Japanese>"
}

Constraints:
- "check" is only valid when toCall === 0
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
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: 'あなたの番です。アクションを選んでください。',
      },
    ],
  })

  // Extract text content
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text content in Claude response')
  }

  const raw = extractJson(textBlock.text)
  return sanitise(raw, state, player)
}
