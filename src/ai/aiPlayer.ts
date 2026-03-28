import type { ActionType, GameState, Player } from '@/game/types'
import { rankToValue } from '@/game/deck'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ──────────────────────────────────────────────
// Simple hand strength heuristic (pre-flop)
// ──────────────────────────────────────────────
function preflopStrength(player: Player): number {
  const [c1, c2] = player.holeCards as NonNullable<typeof player.holeCards>
  if (!c1 || !c2) return 0

  const v1 = rankToValue(c1.rank)
  const v2 = rankToValue(c2.rank)
  const isPair = c1.rank === c2.rank
  const isSuited = c1.suit === c2.suit
  const high = Math.max(v1, v2)
  const low = Math.min(v1, v2)

  let score = high + low * 0.5
  if (isPair) score += 10
  if (isSuited) score += 2
  if (high - low <= 2) score += 1   // connected

  return score
}

// ──────────────────────────────────────────────
// Decision function
// ──────────────────────────────────────────────
export function decideAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty = 'medium',
): { action: ActionType; amount?: number } {
  const toCall = state.currentBet - player.currentBet
  const canCheck = toCall === 0

  const strength = preflopStrength(player)

  // Aggression thresholds vary by difficulty
  const thresholds = {
    easy:   { raise: 28, call: 20 },
    medium: { raise: 24, call: 18 },
    hard:   { raise: 20, call: 15 },
  }[difficulty]

  // Bluff occasionally on hard
  const bluff = difficulty === 'hard' && Math.random() < 0.08

  if (bluff || strength >= thresholds.raise) {
    const raiseAmount = state.currentBet + state.minRaise * (1 + Math.floor(Math.random() * 3))
    if (player.chips >= raiseAmount - player.currentBet) {
      return { action: 'raise', amount: raiseAmount }
    }
    return { action: 'all-in' }
  }

  if (strength >= thresholds.call || canCheck) {
    return canCheck ? { action: 'check' } : { action: 'call' }
  }

  return { action: 'fold' }
}
