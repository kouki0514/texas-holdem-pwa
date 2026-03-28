import { rankToValue } from './deck'
import type { Card, HandRank, HandResult } from './types'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
type FiveCards = [Card, Card, Card, Card, Card]

/** Hand strength as [rankValue, ...tiebreakerValues] for lexicographic comparison */
type ScoreVector = [number, ...number[]]

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function rv(c: Card): number { return rankToValue(c.rank) }

/** C(n, k) combinations */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [head, ...tail] = arr
  return [
    ...combinations(tail, k - 1).map((c) => [head, ...c]),
    ...combinations(tail, k),
  ]
}

/**
 * Build tiebreaker vector for non-straight/non-flush hands.
 * Groups cards by frequency (desc), then by rank (desc) within the same count.
 * Examples:
 *   Full house K-K-K-A-A → [13,13,13,14,14]  (trips first)
 *   Two-pair   A-A-K-K-Q → [14,14,13,13,12]  (higher pair first)
 *   One pair   A-A-K-Q-J → [14,14,13,12,11]
 */
function buildGroupedVector(freq: Record<number, number>): number[] {
  return (
    Object.entries(freq)
      .map(([v, c]) => ({ v: Number(v), c }))
      .sort((a, b) => b.c - a.c || b.v - a.v)
      .flatMap(({ v, c }) => Array<number>(c).fill(v))
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Five-card evaluator — returns rank classification + score vector
// ──────────────────────────────────────────────────────────────────────────────
function evaluateFive(cards: FiveCards): { rank: HandRank; score: ScoreVector } {
  const vals = cards.map(rv).sort((a, b) => b - a) // desc
  const suits = cards.map((c) => c.suit)

  const isFlush = suits.every((s) => s === suits[0])

  // Straight detection (normal)
  const sortedAsc = [...vals].sort((a, b) => a - b)
  const isNormalStraight = sortedAsc.every((v, i) => i === 0 || v === sortedAsc[i - 1] + 1)
  // Wheel: A-2-3-4-5
  const isWheelStraight =
    sortedAsc[4] === 14 &&
    sortedAsc[0] === 2 &&
    sortedAsc[1] === 3 &&
    sortedAsc[2] === 4 &&
    sortedAsc[3] === 5
  const isStraight = isNormalStraight || isWheelStraight

  // Frequency map (rank → count)
  const freq: Record<number, number> = {}
  for (const v of vals) freq[v] = (freq[v] ?? 0) + 1
  const counts = Object.values(freq).sort((a, b) => b - a)

  // ── Straight flush / Royal flush ──
  if (isFlush && isStraight) {
    if (!isWheelStraight && vals[0] === 14) {
      // A-K-Q-J-10 same suit
      return { rank: 'royal-flush', score: [9, ...vals] }
    }
    const highCard = isWheelStraight ? 5 : vals[0]
    return { rank: 'straight-flush', score: [8, highCard] }
  }

  // ── Four of a kind ──
  if (counts[0] === 4) {
    return { rank: 'four-of-a-kind', score: [7, ...buildGroupedVector(freq)] }
  }

  // ── Full house ──
  if (counts[0] === 3 && counts[1] === 2) {
    return { rank: 'full-house', score: [6, ...buildGroupedVector(freq)] }
  }

  // ── Flush ──
  if (isFlush) {
    return { rank: 'flush', score: [5, ...vals] }
  }

  // ── Straight ──
  if (isStraight) {
    const highCard = isWheelStraight ? 5 : vals[0]
    return { rank: 'straight', score: [4, highCard] }
  }

  // ── Three of a kind ──
  if (counts[0] === 3) {
    return { rank: 'three-of-a-kind', score: [3, ...buildGroupedVector(freq)] }
  }

  // ── Two pair ──
  if (counts[0] === 2 && counts[1] === 2) {
    return { rank: 'two-pair', score: [2, ...buildGroupedVector(freq)] }
  }

  // ── One pair ──
  if (counts[0] === 2) {
    return { rank: 'one-pair', score: [1, ...buildGroupedVector(freq)] }
  }

  // ── High card ──
  return { rank: 'high-card', score: [0, ...vals] }
}

// ──────────────────────────────────────────────────────────────────────────────
// Lexicographic score comparison
// ──────────────────────────────────────────────────────────────────────────────
function compareScores(a: ScoreVector, b: ScoreVector): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0 // exact tie
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compare two HandResults.
 * Returns positive if `a` is better, negative if `b` is better, 0 for a tie.
 */
export function compareHandResults(a: HandResult, b: HandResult): number {
  return compareScores(a._score as ScoreVector, b._score as ScoreVector)
}

/**
 * Evaluate the best 5-card hand from a player's 2 hole cards + up to 5 community cards.
 * The `playerId` field is intentionally left blank — set it at the call site.
 */
export function evaluateHand(holeCards: [Card, Card], communityCards: Card[]): HandResult {
  const all = [...holeCards, ...communityCards]
  if (all.length < 5) {
    // Pad with duplicates if fewer than 5 cards — evaluate hole cards only as best effort
    while (all.length < 5) all.push(all[all.length - 1])
  }
  const combos = combinations(all, 5) as FiveCards[]

  let bestCombo = combos[0]
  let bestEval = evaluateFive(combos[0])

  for (const combo of combos.slice(1)) {
    const ev = evaluateFive(combo)
    if (compareScores(ev.score, bestEval.score) > 0) {
      bestCombo = combo
      bestEval = ev
    }
  }

  // kickers: expose score[1..] as the numeric tiebreaker list for UI display
  return {
    playerId: '',
    rank: bestEval.rank,
    rankValue: bestEval.score[0],
    bestFive: bestCombo,
    kickers: bestEval.score.slice(1),
    // Internal: keep full score vector for fast comparison
    _score: bestEval.score,
  } as HandResult & { _score: ScoreVector }
}
