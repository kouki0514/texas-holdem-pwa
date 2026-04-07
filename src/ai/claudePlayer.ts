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
import { evaluateHand, compareHandResults } from '@/game/handEvaluator'
import { rankToValue, createDeck } from '@/game/deck'

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
  if (pos in labels) return labels[pos]!
  if (pos === n - 1) return 'CO'
  if (n === 6) {
    if (pos === 3) return 'UTG'
    if (pos === 4) return 'HJ'
  }
  if (n === 5) return 'HJ'
  return 'UTG'
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

/** Classify made hand on flop/turn/river using evaluateHand result */
function classifyMadeHand(holeCards: [Card, Card], communityCards: Card[]): string {
  const result = evaluateHand(holeCards, communityCards)
  const { rank, kickers } = result

  // Tier 1: Straight or better
  if (
    rank === 'straight' ||
    rank === 'flush' ||
    rank === 'full-house' ||
    rank === 'four-of-a-kind' ||
    rank === 'straight-flush' ||
    rank === 'royal-flush'
  ) {
    const label: Record<string, string> = {
      'straight': 'ストレート',
      'flush': 'フラッシュ',
      'full-house': 'フルハウス',
      'four-of-a-kind': 'フォーオブアカインド',
      'straight-flush': 'ストレートフラッシュ',
      'royal-flush': 'ロイヤルフラッシュ',
    }
    return `${label[rank]} — Tier1 Strong made hand (bet/raise for value, protect vs draws)`
  }

  // Tier 2: Two pair or three of a kind
  // Only count as Tier2 if at least one hole card contributes (avoids board-only two-pair/trips)
  if (rank === 'two-pair' || rank === 'three-of-a-kind') {
    const holeRankVals = holeCards.map((c) => rankToValue(c.rank))
    const boardRankCounts: Record<number, number> = {}
    for (const c of communityCards) {
      const v = rankToValue(c.rank)
      boardRankCounts[v] = (boardRankCounts[v] ?? 0) + 1
    }
    // Board-only two-pair: board has 2 different pairs and hole cards match neither
    // Board-only trips: board has 3-of-a-kind and hole cards match none
    const holeMatchesBoard = holeRankVals.some((v) => (boardRankCounts[v] ?? 0) >= 1)
    if (!holeMatchesBoard) {
      // Fall through to High Card / Tier 5 classification below
    } else {
      const label = rank === 'two-pair' ? 'ツーペア' : 'スリーカード'
      return `${label} — Tier2 Strong (bet/raise for value and protection)`
    }
  }

  // Tier 3 / Tier 4: One pair — distinguish top pair vs under pair
  if (rank === 'one-pair') {
    const pairRankValue = kickers[0] // score[1] = pair rank value

    // Check if either hole card contributes to the pair.
    // If the pair rank matches a board pair but neither hole card has that rank,
    // the pair is entirely on the board — treat as High Card (no improvement).
    const holeRankVals = holeCards.map((c) => rankToValue(c.rank))
    const holeContributesToPair = holeRankVals.some((v) => v === pairRankValue)

    if (!holeContributesToPair) {
      // Fall through to High Card / Tier 5 classification below
    } else {
      const boardHighValue = Math.max(...communityCards.map((c) => rankToValue(c.rank)))
      if (pairRankValue >= boardHighValue) {
        return `ワンペア(トップペア以上) — Tier3 Decent (bet for value/protection, call reasonable bets)`
      }
      return `ワンペア(ミドル/ボトムペア) — Tier4 Marginal (check/call small bets, fold to heavy pressure)`
    }
  }

  // Tier 5: High card — sub-classify by draw potential
  const allCards = [...holeCards, ...communityCards]
  const allVals = allCards.map((c) => rankToValue(c.rank))

  // Flush draw: 4 cards of same suit (including hole cards)
  const suitCounts: Record<string, number> = {}
  for (const c of allCards) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1
  const hasFlushDraw = Object.values(suitCounts).some((n) => n === 4)

  // Straight draw detection — build sorted unique rank values
  const uniqueVals = [...new Set(allVals)].sort((a, b) => a - b)
  // Also include Ace as 1 for wheel draws
  const valsWithLowAce = uniqueVals.includes(14)
    ? [1, ...uniqueVals]
    : uniqueVals

  function countInWindow(vals: number[], low: number): number {
    return vals.filter((v) => v >= low && v <= low + 4).length
  }

  let hasOESD = false
  let hasGutshot = false
  for (const base of valsWithLowAce) {
    const inWindow = countInWindow(valsWithLowAce, base)
    if (inWindow === 4) {
      // Check if it's open-ended (both ends open) vs gutshot
      // OESD: 4 consecutive ranks; gutshot: gap of exactly 1 in a 5-rank window
      const windowVals = valsWithLowAce.filter((v) => v >= base && v <= base + 4)
      const isConsecutive4 = windowVals.length === 4 &&
        windowVals[windowVals.length - 1] - windowVals[0] === 3
      if (isConsecutive4) {
        hasOESD = true
      } else {
        hasGutshot = true
      }
    }
  }

  if (hasFlushDraw || hasOESD) {
    const drawType = hasFlushDraw && hasOESD
      ? 'フラッシュドロー+OESD (コンボドロー)'
      : hasFlushDraw
        ? 'フラッシュドロー(4枚同スート)'
        : 'OESD(両面ストレートドロー)'
    return `${drawType} — Tier5-Draw (semi-bluff raise or call with implied odds; ~35-40% equity if one draw)`
  }

  if (hasGutshot) {
    return `ガットショット — Tier5-Gutshot (call only with good pot odds ~20%+; bluff rarely)`
  }

  const boardHighValue = Math.max(...communityCards.map((c) => rankToValue(c.rank)))
  const hasOvercard = holeCards.some((c) => rankToValue(c.rank) > boardHighValue)
  if (hasOvercard) {
    return `オーバーカード — Tier5-Overcard (check/fold unless cheap; runner-runner draw potential only)`
  }

  return `トラッシュハンド — Tier5-Trash (fold to any bet; bluff only with fold equity reads)`
}

// ──────────────────────────────────────────────────────────────────────────────
// Monte Carlo equity estimator
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Range-weighted hole card sampling helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute the Tier-weight distribution for opponent hole cards given betRatio.
 * betRatio = opponentBet / potBeforeBet (0 = check/no bet).
 *
 * Polarised bet sizing logic:
 *   - Check (0)          : uniform across all tiers
 *   - Small  (≤0.4)      : balanced range — Tier1+2 20%, Tier3+4 50%, Tier5 30%
 *   - Medium (≤0.75)     : polarised  — Tier1+2 40%, Tier3 30%, Tier5 30%
 *   - Large  (>0.75)     : strongly polarised — Tier1 50%, Tier2 10%, Tier5 40%
 *
 * Returns weights [w1, w2, w3, w4, w5] that sum to 1.
 */
function betRatioToTierWeights(betRatio: number): [number, number, number, number, number] {
  if (betRatio <= 0) {
    // Check — uniform
    return [0.20, 0.20, 0.20, 0.20, 0.20]
  } else if (betRatio <= 0.4) {
    // Small bet — balanced
    return [0.10, 0.10, 0.25, 0.25, 0.30]
  } else if (betRatio <= 0.75) {
    // Medium bet — polarised
    return [0.20, 0.20, 0.30, 0.00, 0.30]
  } else {
    // Large / overbet — strongly polarised
    return [0.50, 0.10, 0.00, 0.00, 0.40]
  }
}

/**
 * Classify a pair of cards into a preflop Tier (1=premium … 5=weak).
 * Mirrors the logic in classifyHoleCards but returns a number.
 */
function getCardTier(a: Card, b: Card): 1 | 2 | 3 | 4 | 5 {
  const rankVal: Record<string, number> = {
    A: 14, K: 13, Q: 12, J: 11, '10': 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
  }
  const hi = Math.max(rankVal[a.rank], rankVal[b.rank])
  const lo = Math.min(rankVal[a.rank], rankVal[b.rank])
  const isPair = hi === lo
  const gap = hi - lo
  const suited = a.suit === b.suit

  // Tier 1: Premium
  if (isPair && hi >= 10) return 1
  if (!isPair && hi === 14 && lo >= 12) return 1
  // Tier 2: Strong
  if (isPair && hi >= 7) return 2
  if (!isPair && hi === 14 && lo >= 9) return 2
  if (!isPair && hi === 13 && lo >= 11) return 2
  if (!isPair && suited && hi >= 11 && gap <= 1) return 2
  // Tier 3: Playable
  if (isPair) return 3
  if (suited && gap <= 2 && hi >= 8) return 3
  if (!isPair && hi >= 10 && lo >= 9) return 3
  // Tier 4: Speculative
  if (suited && gap <= 3) return 4
  if (!isPair && hi >= 10 && gap <= 3) return 4
  // Tier 5: Weak
  return 5
}

/**
 * Sample one opponent hole card pair from the remaining deck using
 * tier-based weighted rejection sampling.
 *
 * @param deck        Shuffled remaining deck (already has board + other opp cards removed).
 * @param startIdx    First index in deck available for this opponent (2 consecutive cards used).
 * @param tierWeights [w1..w5] probability each tier is accepted.
 * @param maxAttempts Stop after this many swaps to avoid infinite loops.
 * @returns The chosen [Card, Card] pair (guaranteed to be the cards at startIdx, startIdx+1
 *          after this function finishes).
 */
function sampleRangeWeightedPair(
  deck: Card[],
  startIdx: number,
  deckEnd: number,
  tierWeights: [number, number, number, number, number],
  maxAttempts = 20,
): [Card, Card] {
  // Try to find a pair whose tier passes a probabilistic accept/reject test.
  // We swap candidates into position [startIdx, startIdx+1] on acceptance.
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Pick two random positions from [startIdx, deckEnd)
    const i1 = startIdx + Math.floor(Math.random() * (deckEnd - startIdx))
    let i2 = startIdx + Math.floor(Math.random() * (deckEnd - startIdx - 1))
    if (i2 >= i1) i2++  // ensure i1 !== i2

    if (i2 < startIdx || i2 >= deckEnd) continue

    const tier = getCardTier(deck[i1], deck[i2])
    const weight = tierWeights[tier - 1]

    if (Math.random() < weight / 0.5) {
      // Accept: swap into position
      ;[deck[startIdx],     deck[i1]] = [deck[i1],     deck[startIdx]]
      ;[deck[startIdx + 1], deck[i2]] = [deck[i2], deck[startIdx + 1]]
      return [deck[startIdx], deck[startIdx + 1]]
    }
  }
  // Fallback: use whatever is already at startIdx (pure random)
  return [deck[startIdx], deck[startIdx + 1]]
}

/**
 * Estimate win equity via Monte Carlo simulation.
 * Randomly completes unknown community cards and opponent hole cards,
 * then evaluates who wins. Returns win rate [0, 1].
 *
 * @param opponentBetRatio  Opponent's bet / pot-before-bet (0 = check/no bet).
 *   Used to bias opponent hole card sampling toward plausible hand ranges:
 *   large bets → polarised (nuts or bluff), small bets → balanced range.
 */
function estimateEquity(
  holeCards: [Card, Card],
  communityCards: Card[],
  numOpponents: number,
  iterations = 500,
  opponentBetRatio = 0,
): number {
  if (numOpponents <= 0) return 1

  const tierWeights = betRatioToTierWeights(opponentBetRatio)

  // Build the set of known cards to exclude from the deck
  const knownKeys = new Set<string>([
    ...holeCards.map((c) => `${c.rank}${c.suit}`),
    ...communityCards.map((c) => `${c.rank}${c.suit}`),
  ])

  const fullDeck = createDeck().filter((c) => !knownKeys.has(`${c.rank}${c.suit}`))
  const boardNeeded = 5 - communityCards.length // 0 on river

  let wins = 0
  let validTrials = 0

  for (let i = 0; i < iterations; i++) {
    // Fisher-Yates partial shuffle for board cards only
    const boardCards = boardNeeded
    const deck = [...fullDeck]
    for (let j = 0; j < boardCards && j < deck.length; j++) {
      const r = j + Math.floor(Math.random() * (deck.length - j))
      ;[deck[j], deck[r]] = [deck[r], deck[j]]
    }

    const cardsNeeded = boardNeeded + numOpponents * 2
    if (deck.length < cardsNeeded) continue

    // Complete community cards
    const board: Card[] = [
      ...communityCards,
      ...deck.slice(0, boardNeeded),
    ]

    // Deal opponent hole cards using range-weighted sampling
    let heroWins = true
    let heroResult: ReturnType<typeof evaluateHand> | null = null
    try {
      heroResult = evaluateHand(holeCards, board)
    } catch {
      continue
    }

    for (let opp = 0; opp < numOpponents; opp++) {
      const oppStart = boardNeeded + opp * 2
      const oppHole = sampleRangeWeightedPair(deck, oppStart, deck.length, tierWeights)
      try {
        const oppResult = evaluateHand(oppHole, board)
        if (compareHandResults(oppResult, heroResult!) > 0) {
          heroWins = false
          break
        }
      } catch {
        heroWins = false
        break
      }
    }

    if (heroWins) wins++
    validTrials++
  }

  return validTrials > 0 ? wins / validTrials : 0.5
}

// ──────────────────────────────────────────────────────────────────────────────
// Board texture analysis
// ──────────────────────────────────────────────────────────────────────────────

interface BoardTexture {
  suitedness: 'monotone' | 'two-tone' | 'rainbow'
  paired: boolean
  connected: boolean  // max rank gap between any two cards ≤ 3
  summary: string
}

function analyzeBoardTexture(community: Card[]): BoardTexture | null {
  if (community.length < 3) return null

  const suitCounts: Record<string, number> = {}
  for (const c of community) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1
  const maxSuit = Math.max(...Object.values(suitCounts))
  const suitedness: BoardTexture['suitedness'] =
    maxSuit >= community.length ? 'monotone'
    : maxSuit >= 2 ? 'two-tone'
    : 'rainbow'

  const rankVals = community.map((c) => rankToValue(c.rank)).sort((a, b) => a - b)
  const rankSet = new Set(rankVals)
  const paired = rankVals.length !== rankSet.size

  const span = rankVals[rankVals.length - 1] - rankVals[0]
  const connected = span <= 3

  const parts: string[] = [suitedness]
  if (paired) parts.push('paired')
  if (connected) parts.push('connected')
  const summary = parts.join(' / ')

  return { suitedness, paired, connected, summary }
}

// ──────────────────────────────────────────────────────────────────────────────
// Bet sizing guide based on board texture + hand tier
// ──────────────────────────────────────────────────────────────────────────────

function betSizingGuide(texture: BoardTexture | null, totalPot: number): string {
  const small  = Math.round(totalPot * 0.33)
  const medium = Math.round(totalPot * 0.5)
  const large  = Math.round(totalPot * 0.67)
  const overbet = totalPot

  const sizes = `SMALL=${small}(1/3pot) MEDIUM=${medium}(1/2pot) LARGE=${large}(2/3pot) OVERBET=${overbet}(1xpot)`

  if (!texture) {
    return `${sizes}\nPreflop: use SMALL for steals, MEDIUM for value raises, LARGE for 3-bets.`
  }

  const lines: string[] = [sizes]

  if (texture.suitedness === 'monotone') {
    lines.push('Monotone board: LARGE or OVERBET with nuts/strong flush; OVERBET as polarised bluff.')
  } else if (texture.suitedness === 'two-tone') {
    lines.push('Two-tone board: MEDIUM to LARGE with strong value; MEDIUM semi-bluff with flush draws.')
  } else {
    lines.push('Rainbow board: SMALL on dry boards for thin value; MEDIUM for standard value/protection.')
  }

  if (texture.connected) {
    lines.push('Connected board: LARGE with straights/sets to charge draws; SMALL as blocking bet.')
  }
  if (texture.paired) {
    lines.push('Paired board: SMALL/MEDIUM with trips+; polarised OVERBET with full house on dry paired board.')
  }

  return lines.join('\n')
}

// ──────────────────────────────────────────────────────────────────────────────
// Range estimation
// ──────────────────────────────────────────────────────────────────────────────

interface RangeTierDist {
  tier1: number  // fraction [0,1]
  tier2: number
  tier3: number
  tier4: number
  tier5: number
}

interface PlayerRangeEstimate {
  position: string
  action: string
  dist: RangeTierDist
  description: string
}

/**
 * Estimate a player's likely hand range (Tier distribution) from their
 * position and the most aggressive preflop action they took.
 */
function estimatePlayerRange(
  position: string,
  preflopAction: 'fold' | 'call' | 'raise' | 'all-in' | 'none',
): PlayerRangeEstimate {
  const pos = position.toLowerCase()

  // Position looseness factor — BTN opens widest, EP tightest
  type PosKey = 'btn' | 'co' | 'mp' | 'sb' | 'bb' | 'ep'
  const posKey: PosKey =
    pos.includes('btn') ? 'btn'
    : pos.includes('co') ? 'co'
    : pos.includes('sb') ? 'sb'
    : pos.includes('bb') ? 'bb'
    : pos.includes('mp') ? 'mp'
    : 'ep'

  // Base Tier distributions per position + action
  // Values are approximate percentages of their range that fall into each tier
  const tableRaise: Record<PosKey, RangeTierDist> = {
    btn: { tier1: 0.08, tier2: 0.18, tier3: 0.28, tier4: 0.26, tier5: 0.20 },
    co:  { tier1: 0.10, tier2: 0.22, tier3: 0.30, tier4: 0.22, tier5: 0.16 },
    mp:  { tier1: 0.14, tier2: 0.28, tier3: 0.32, tier4: 0.18, tier5: 0.08 },
    sb:  { tier1: 0.10, tier2: 0.20, tier3: 0.28, tier4: 0.24, tier5: 0.18 },
    bb:  { tier1: 0.16, tier2: 0.26, tier3: 0.30, tier4: 0.18, tier5: 0.10 },
    ep:  { tier1: 0.20, tier2: 0.32, tier3: 0.28, tier4: 0.14, tier5: 0.06 },
  }
  const tableCall: Record<PosKey, RangeTierDist> = {
    btn: { tier1: 0.06, tier2: 0.16, tier3: 0.26, tier4: 0.28, tier5: 0.24 },
    co:  { tier1: 0.06, tier2: 0.16, tier3: 0.28, tier4: 0.28, tier5: 0.22 },
    mp:  { tier1: 0.08, tier2: 0.20, tier3: 0.32, tier4: 0.26, tier5: 0.14 },
    sb:  { tier1: 0.06, tier2: 0.14, tier3: 0.24, tier4: 0.30, tier5: 0.26 },
    bb:  { tier1: 0.04, tier2: 0.12, tier3: 0.24, tier4: 0.32, tier5: 0.28 },
    ep:  { tier1: 0.10, tier2: 0.22, tier3: 0.34, tier4: 0.22, tier5: 0.12 },
  }
  const tableAllIn: Record<PosKey, RangeTierDist> = {
    btn: { tier1: 0.30, tier2: 0.35, tier3: 0.20, tier4: 0.10, tier5: 0.05 },
    co:  { tier1: 0.35, tier2: 0.35, tier3: 0.18, tier4: 0.08, tier5: 0.04 },
    mp:  { tier1: 0.42, tier2: 0.34, tier3: 0.14, tier4: 0.07, tier5: 0.03 },
    sb:  { tier1: 0.32, tier2: 0.34, tier3: 0.20, tier4: 0.10, tier5: 0.04 },
    bb:  { tier1: 0.28, tier2: 0.32, tier3: 0.22, tier4: 0.12, tier5: 0.06 },
    ep:  { tier1: 0.50, tier2: 0.32, tier3: 0.12, tier4: 0.04, tier5: 0.02 },
  }

  let dist: RangeTierDist
  let action: string
  if (preflopAction === 'raise') {
    dist = tableRaise[posKey]
    action = 'raise'
  } else if (preflopAction === 'call') {
    dist = tableCall[posKey]
    action = 'call'
  } else if (preflopAction === 'all-in') {
    dist = tableAllIn[posKey]
    action = 'all-in'
  } else {
    // No preflop action info — use average call range
    dist = tableCall[posKey]
    action = preflopAction === 'fold' ? 'folded(no info)' : 'unknown'
  }

  const fmt = (v: number) => `${Math.round(v * 100)}%`
  const description =
    `Tier1:${fmt(dist.tier1)} Tier2:${fmt(dist.tier2)} Tier3:${fmt(dist.tier3)} Tier4:${fmt(dist.tier4)} Tier5:${fmt(dist.tier5)}`

  return { position, action, dist, description }
}

interface RangeAdvantageResult {
  rangeAdvantage: 'hero' | 'villain' | 'neutral'
  nutAdvantage: 'hero' | 'villain' | 'neutral'
  summary: string
}

/**
 * Analyze whether the board texture favours hero's range or opponent ranges.
 * Uses Tier distribution weighted by how well each tier connects to the board.
 */
function analyzeBoardRangeAdvantage(
  communityCards: Card[],
  heroRange: PlayerRangeEstimate,
  opponentRanges: PlayerRangeEstimate[],
): RangeAdvantageResult {
  if (communityCards.length < 3 || opponentRanges.length === 0) {
    return { rangeAdvantage: 'neutral', nutAdvantage: 'neutral', summary: 'Preflop — no board range analysis.' }
  }

  const texture = analyzeBoardTexture(communityCards)

  // Score a range distribution against the board texture.
  // High cards on board → premiums (T1/T2) connect better.
  // Wet boards → T3/T4 (suited connectors, speculative) also connect.
  const boardHighVal = Math.max(...communityCards.map((c) => rankToValue(c.rank)))
  const highBoard = boardHighVal >= 12  // Q, K, A high

  function scoreRange(r: PlayerRangeEstimate): number {
    const d = r.dist
    let score = 0
    // Premium hands always connect (pairs, top pair, strong draws)
    score += d.tier1 * 1.0 + d.tier2 * 0.8

    if (highBoard) {
      // High board: premiums are more connected, speculative less
      score += d.tier3 * 0.5 + d.tier4 * 0.2 + d.tier5 * 0.05
    } else {
      // Low/mid board: suited connectors and speculative hands gain value
      score += d.tier3 * 0.7 + d.tier4 * 0.45 + d.tier5 * 0.2
    }

    // Wet board bonus for draw-heavy ranges (T3/T4)
    if (texture && (texture.suitedness !== 'rainbow' || texture.connected)) {
      score += (d.tier3 + d.tier4) * 0.1
    }

    return score
  }

  const heroScore = scoreRange(heroRange)
  const oppScore = opponentRanges.reduce((sum, r) => sum + scoreRange(r), 0) / opponentRanges.length

  const delta = heroScore - oppScore
  const rangeAdvantage: RangeAdvantageResult['rangeAdvantage'] =
    delta > 0.05 ? 'hero' : delta < -0.05 ? 'villain' : 'neutral'

  // Nut advantage: who has more Tier1 hands?
  const heroNuts = heroRange.dist.tier1
  const oppNuts = opponentRanges.reduce((sum, r) => sum + r.dist.tier1, 0) / opponentRanges.length
  const nutDelta = heroNuts - oppNuts
  const nutAdvantage: RangeAdvantageResult['nutAdvantage'] =
    nutDelta > 0.03 ? 'hero' : nutDelta < -0.03 ? 'villain' : 'neutral'

  const parts: string[] = []
  if (rangeAdvantage === 'hero') {
    parts.push(`Hero has range advantage (score ${heroScore.toFixed(2)} vs ${oppScore.toFixed(2)}) — this board connects better to hero's range.`)
  } else if (rangeAdvantage === 'villain') {
    parts.push(`Villain(s) have range advantage (score ${oppScore.toFixed(2)} vs ${heroScore.toFixed(2)}) — board favours opponent range.`)
  } else {
    parts.push(`Ranges are roughly even on this board (${heroScore.toFixed(2)} vs ${oppScore.toFixed(2)}).`)
  }

  if (nutAdvantage === 'hero') {
    parts.push(`Hero has nut advantage (more Tier1 combos: ${Math.round(heroNuts * 100)}% vs ${Math.round(oppNuts * 100)}%).`)
  } else if (nutAdvantage === 'villain') {
    parts.push(`Villain(s) have nut advantage (more Tier1 combos: ${Math.round(oppNuts * 100)}% vs ${Math.round(heroNuts * 100)}%).`)
  } else {
    parts.push(`Nut advantage is neutral.`)
  }

  return { rangeAdvantage, nutAdvantage, summary: parts.join(' ') }
}

// ──────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ──────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(state: GameState, player: Player, language: 'ja' | 'en' = 'ja'): string {
  const holeCards = player.holeCards as [Card, Card]
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const totalPot = state.pots.reduce((s, p) => s + p.amount, 0)
  const position = getPositionLabel(state.players, player, state.dealerIndex)
  const minRaiseTotal = state.currentBet + state.minRaise

  const activeOpponents = state.players.filter((p) => p.id !== player.id && !p.isFolded)
  const numOpponents = activeOpponents.length
  const isMultiway = numOpponents >= 2

  // ── Pot odds & required equity ──────────────────────────────────────────────
  // Cap actual call amount by player's remaining chips (short-stack scenario)
  const actualCall = Math.min(toCall, player.chips)
  const potOdds = actualCall > 0 ? actualCall / (totalPot + actualCall) : 0
  const potOddsStr = actualCall > 0
    ? `${(potOdds * 100).toFixed(1)}% (call ${actualCall} into pot-after-call ${totalPot + actualCall})`
    : 'N/A (no call required)'
  const requiredEquityPct = (potOdds * 100).toFixed(1)

  // ── Opponent bet sizing relative to pot ─────────────────────────────────────
  // potBeforeBet = pot before opponent's bet was made.
  // totalPot already includes the opponent's currentBet, so subtract it to get pre-bet pot.
  let betSizeNote = 'N/A'
  let opponentBetRatio = 0
  if (state.currentBet > 0 && totalPot > 0) {
    const potBeforeBet = Math.max(1, totalPot - state.currentBet)
    opponentBetRatio = toCall / potBeforeBet
    const ratio = state.currentBet / potBeforeBet
    if (ratio <= 0.4) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — small bet: wide continuing range, re-raise bluffs viable`
    else if (ratio <= 0.6) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — half-pot: balanced range; need ~25% equity to call`
    else if (ratio <= 0.85) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — 2/3 pot: polarised range; need ~32% equity`
    else betSizeNote = `${(ratio * 100).toFixed(0)}% pot — pot-size+: very polarised; need ~40%+ equity, fold marginal hands`
  }

  // ── Monte Carlo equity (uses opponentBetRatio for range-weighted sampling) ──
  const equity = estimateEquity(holeCards, state.communityCards, numOpponents, 500, opponentBetRatio)
  const equityPct = `${(equity * 100).toFixed(1)}%`

  // ── SPR (Stack-to-Pot Ratio) ─────────────────────────────────────────────────
  const effectiveStack = Math.min(
    player.chips,
    ...activeOpponents.map((p) => p.chips),
  )
  const spr = totalPot > 0 ? (effectiveStack / totalPot) : 999
  let sprNote: string
  if (spr <= 3) sprNote = `${spr.toFixed(1)} — LOW: commit with top pair+, avoid fancy play`
  else if (spr <= 10) sprNote = `${spr.toFixed(1)} — MEDIUM: prefer sets/two-pair+ to stack off; draws need good odds`
  else sprNote = `${spr.toFixed(1)} — HIGH: implied odds matter; speculative hands gain value`

  // ── Position-based strategy note ────────────────────────────────────────────
  const posLower = position.toLowerCase()

  // Postflop IP/OOP: determined by who acts LAST among active players.
  // Action order postflop: SB(pos=1) → BB(pos=2) → MP... → CO(pos=n-1) → BTN(pos=0) acts last.
  // Convert pos values to a postflop action order (higher = later = IP):
  //   pos=0 (BTN) → order n-1 (last)
  //   pos=k (k>0) → order k-1
  const n = state.players.length
  function postflopOrder(p: Player): number {
    const pos = (state.players.indexOf(p) - state.dealerIndex + n) % n
    return pos === 0 ? n - 1 : pos - 1
  }
  const activePlayers2 = state.players.filter((p) => !p.isFolded && !p.isAllIn)
  const myOrder = postflopOrder(player)
  const isIP = activePlayers2.every((p) => postflopOrder(p) <= myOrder)

  // ── Aggressor / checked-back detection ──────────────────────────────────────
  const isRiver = state.phase === 'river'
  const isFlop  = state.phase === 'flop'
  const isTurn  = state.phase === 'turn'

  // Hero is preflop aggressor if the last raise in actionHistory belongs to hero
  const preflopRaises = state.actionHistory.filter(
    (a) => a.action === 'raise' || a.action === 'all-in'
  )
  const isPreflopAggressor = preflopRaises.length > 0 &&
    preflopRaises[preflopRaises.length - 1]?.playerId === player.id

  // Hero checked back on the flop (IP aggressor who checked behind on flop)
  // Detected as: hero is preflop aggressor + current street is turn/river +
  // actionHistory contains hero's 'check' action (no bet on flop)
  const heroCheckedFlop = isPreflopAggressor && (isTurn || isRiver) &&
    state.actionHistory.some((a) => a.action === 'check' && a.playerId === player.id)

  // Opponent checked on current street (hero faces a check → hero has initiative)
  const opponentCheckedThisStreet = toCall === 0 &&
    state.actionHistory.some((a) => a.action === 'check' && a.playerId !== player.id)

  // Betting situation label
  const bettingSituation: string = (() => {
    if (state.phase === 'preflop') return 'PREFLOP'
    if (!canCheck) {
      // Facing a bet
      return isPreflopAggressor
        ? 'FACING BET (hero was preflop aggressor — opponent is leading/donk-betting or 3-betting)'
        : 'FACING BET (hero was preflop caller — opponent continues as aggressor)'
    }
    // Hero can check or bet
    if (isPreflopAggressor && !heroCheckedFlop) {
      if (isFlop) return 'C-BET SPOT: Hero is preflop aggressor, first to act on flop. Standard c-bet or check decision.'
      if (isTurn) return 'DOUBLE BARREL SPOT: Hero is preflop aggressor, barreling the turn. High fold equity with good boards; give up on bad run-outs.'
      if (isRiver) return 'TRIPLE BARREL SPOT: Hero is preflop aggressor on river. Triple barrel only with strong value or high fold-equity bluffs.'
    }
    if (isPreflopAggressor && heroCheckedFlop) {
      if (isTurn) return 'DELAYED C-BET SPOT: Hero checked back flop (aggressor), now betting turn. Range is uncapped; strong credibility for value bets.'
      if (isRiver) return 'DELAYED C-BET SPOT (river): Hero checked flop and turn, now acting on river. Betting here looks very strong — polarize.'
    }
    if (!isPreflopAggressor && opponentCheckedThisStreet) {
      if (isFlop) return 'PROBE BET OPPORTUNITY (flop): Opponent (preflop aggressor) checked — hero can probe with medium-strength hands and draws. Avoid wide donk-betting on separate streets.'
      if (isTurn) return 'PROBE BET OPPORTUNITY (turn): Aggressor checked flop AND turn — range is weakened. Probe with a wide range; strong hands, draws, and bluffs all viable.'
      if (isRiver) return 'PROBE BET OPPORTUNITY (river): Aggressor checked through — polarized probe (strong value or bluff). Medium hands often check behind.'
    }
    if (!isPreflopAggressor && !opponentCheckedThisStreet && canCheck) {
      return 'OOP CHECK: Hero is preflop caller and acts first. Check-raise is the primary weapon; donk-bet only with range advantage and clear value/semi-bluff hands.'
    }
    return 'STANDARD SPOT'
  })()

  // River IP + opponent checked note (existing logic, now using updated vars)
  const opponentChecked = isRiver && toCall === 0 && opponentCheckedThisStreet
  const riverIpCheckNote = isRiver && isIP && opponentChecked
    ? `RIVER IP + OPPONENT CHECKED: You have exactly 3 options — (A) Value bet (SMALL/MEDIUM/LARGE) with strong made hand, (B) Bluff bet (SMALL/MEDIUM) to fold out weak hands you can't beat, (C) Check behind for free showdown with medium-strength hands. Do NOT consider call or fold here — bet or check only.`
    : null

  // ── Hole card strength ───────────────────────────────────────────────────────
  const handStrength = state.communityCards.length > 0
    ? classifyMadeHand(holeCards, state.communityCards)
    : classifyHoleCards(holeCards)

  // ── Board texture ────────────────────────────────────────────────────────────
  const texture = analyzeBoardTexture(state.communityCards)
  const textureStr = texture ? texture.summary : 'N/A (preflop)'
  const sizingGuide = betSizingGuide(texture, totalPot)

  // ── Range analysis ───────────────────────────────────────────────────────────
  // Infer each player's preflop action from actionHistory
  function getPreflopAction(playerId: string): 'fold' | 'call' | 'raise' | 'all-in' | 'none' {
    const preflopActions = state.actionHistory.filter((a) => {
      // actionHistory only has current street; we approximate from current hand context
      return a.playerId === playerId
    })
    if (preflopActions.length === 0) return 'none'
    // Find the most aggressive action
    const actionOrder = ['all-in', 'raise', 'call', 'fold'] as const
    for (const act of actionOrder) {
      if (preflopActions.some((a) => a.action === act)) return act
    }
    return 'none'
  }

  const heroPositionLabel = getPositionLabel(state.players, player, state.dealerIndex)
  const heroPreflopAction = getPreflopAction(player.id)
  const heroRange = estimatePlayerRange(heroPositionLabel, heroPreflopAction)

  const opponentRanges = activeOpponents.map((opp) => {
    const oppPos = getPositionLabel(state.players, opp, state.dealerIndex)
    const oppAction = getPreflopAction(opp.id)
    return estimatePlayerRange(oppPos, oppAction)
  })

  const rangeAdvResult = analyzeBoardRangeAdvantage(state.communityCards, heroRange, opponentRanges)


  // ── Valid actions list ───────────────────────────────────────────────────────
  const validActions: string[] = ['fold']
  if (canCheck) {
    validActions.push('check')
  } else {
    validActions.push(`call (cost: ${toCall} chips)`)
  }
  if (player.chips > toCall) {
    // No prior bet this street → opening action is a "bet", not a "raise"
    const raiseLabel = canCheck ? 'bet' : 'raise'
    validActions.push(
      `${raiseLabel} (min total bet: ${minRaiseTotal}, max: ${player.chips + player.currentBet} chips — use action "raise" in JSON)`,
    )
  }
  validActions.push(`all-in (push ${player.chips} chips)`)

  // ── Active opponents (with VPIP/PFR if available) ───────────────────────────
  const opponents = activeOpponents
    .map((p) => {
      const parts: string[] = [
        p.isAllIn ? 'all-in' : `${p.chips} chips`,
      ]
      if (p.currentBet > 0) parts.push(`bet ${p.currentBet}`)
      // VPIP/PFR — these fields may not exist on all player objects
      const anyP = p as unknown as Record<string, unknown>
      if (typeof anyP['vpip'] === 'number') parts.push(`VPIP ${((anyP['vpip'] as number) * 100).toFixed(0)}%`)
      if (typeof anyP['pfr']  === 'number') parts.push(`PFR ${((anyP['pfr']  as number) * 100).toFixed(0)}%`)
      return `  ${p.name}: ${parts.filter(Boolean).join(', ')}`
    })
    .join('\n')

  // ── Preflop range tendency for current position ──────────────────────────────
  const preflopRangeTendency: Record<string, string> = {
    btn: 'BTN opens ~45-50% of hands (all pairs, most broadways, many suited connectors/aces). Postflop: widest range, highest range equity on most boards. Bet frequency: HIGH.',
    co:  'CO opens ~28-32% of hands (all pairs down to 22, suited aces, broadway combos). Postflop: solid range advantage vs BB/SB. Bet frequency: MEDIUM-HIGH.',
    sb:  'SB opens ~35-40% vs BTN, 3-bets or folds vs CO/EP. Postflop OOP: range is polarised (3-bet value + bluffs). Prefer check-raise. Bet frequency: LOW unless 3-bet pot.',
    bb:  'BB defends wide (pot odds), so range is wide but capped — lacks 4-bet range vs EP. Postflop OOP: check-raise is primary weapon. Do NOT donk-bet wide. Bet frequency: LOW-MEDIUM.',
    mp:  'EP/MP (UTG/HJ) opens ~15-22% — tight, value-heavy (pairs, AK-AT, KQ, suited broadways). Postflop: strong top-of-range, bet for value on connected boards. Bet frequency: MEDIUM.',
  }
  const posTendencyKey = posLower.includes('btn') ? 'btn'
    : posLower.includes('co') ? 'co'
    : posLower.includes('sb') ? 'sb'
    : posLower.includes('bb') ? 'bb'
    : 'mp'
  const preflopRangeNote = preflopRangeTendency[posTendencyKey] ?? preflopRangeTendency['mp']!

  // ── Hand assignment: check-range vs bet-range ─────────────────────────────────
  // Classify this specific hand into betting or checking category
  const phase = state.phase
  let handAssignmentNote: string
  if (phase === 'preflop') {
    handAssignmentNote = 'PREFLOP: Assign hand to open-raise range (for value/fold-equity) or fold/call range based on position and hand strength.'
  } else {
    const boardAdv = rangeAdvResult.rangeAdvantage
    const nutAdv   = rangeAdvResult.nutAdvantage
    if (canCheck) {
      // IP check or OOP check
      const betCategory = equity >= 0.65 ? 'VALUE-BET (strong — thin value is still value)' :
                          equity >= 0.48 ? 'THIN-VALUE or PROTECTION bet (slightly ahead of calling range)' :
                          equity >= 0.30 ? 'CHECK (medium strength — protect against check-raise; pot control)' :
                          equity >= 0.15 ? 'BLUFF candidate (low equity — bet only with fold equity or good blockers)' :
                                           'CHECK/GIVE-UP (no equity, no fold equity — check or fold to any bet)'
      const rangeCtx = boardAdv === 'hero'
        ? 'Range advantage → prefer betting to deny equity, leverage higher-frequency range.'
        : boardAdv === 'villain'
        ? 'Villain range advantage → check more, check-raise with strong hands, avoid wide donk-bets.'
        : 'Balanced ranges → mix bets and checks guided by hand strength and position.'
      handAssignmentNote = `HAND ASSIGNMENT: ${betCategory}. ${rangeCtx}${nutAdv === 'hero' ? ' Nut advantage → polarize sizing (LARGE/OVERBET) when betting.' : ''}`
    } else {
      // Facing a bet — call vs raise vs fold decision
      const callCategory = equity >= potOdds + 0.10 ? 'RAISE for value (strong equity cushion above pot odds)' :
                           equity >= potOdds          ? 'CALL (equity meets pot odds — continue)' :
                           equity >= potOdds - 0.08   ? 'MARGINAL — consider pot odds, outs, implied odds; lean call if draw' :
                                                         'FOLD (equity below pot odds, insufficient draws)'
      handAssignmentNote = `HAND ASSIGNMENT vs bet: ${callCategory}. Equity ${equityPct} vs required ${(potOdds*100).toFixed(1)}%.`
    }
  }

  // ── Thin value & bluff guidance ───────────────────────────────────────────────
  const thinValueBluffGuide = [
    `THIN VALUE: Bet any hand that beats more than 50% of villain's calling range. Do NOT check back medium-strength hands IP when they have showdown value and beat bluff-catchers.`,
    `BLUFF: Bluff when (a) you have fold equity (villain capped range, dry board, or showed weakness), AND (b) your hand has low showdown value (air, missed draws). Bluff frequency: ~${toCall > 0 ? (potOdds * 100).toFixed(0) : canCheck ? '25-40' : '30'}% of your betting range.`,
    isMultiway
      ? `MULTIWAY (${numOpponents} opponents): DRASTICALLY reduce bluff frequency. Each opponent calls independently. Only bluff with strong blockers and near-zero equity.`
      : `HEADS-UP: Full bluff/value polarization is EV+. Balance your range at every decision point.`,
  ].join(' ')

  return `You are a GTO-trained Texas Hold'em AI named "${player.name}". Your goal is to maximize EV across your ENTIRE RANGE at this decision point — not just for this specific hand. Think in ranges, assign this hand to bet or check range, then choose the action.

## Betting Situation
- Situation       : ${bettingSituation}
- Preflop role    : ${isPreflopAggressor ? 'AGGRESSOR (last raiser preflop)' : 'CALLER / DEFENDER (preflop caller or BB)'}${heroCheckedFlop ? ' — checked back on flop' : ''}

## Betting Term Definitions
- **C-bet (continuation bet)**: Preflop aggressor bets on the flop after checking or being first to act. Standard aggressive play.
- **Double barrel**: Preflop aggressor bets turn after c-betting flop. Requires good board run-out or credible range.
- **Triple barrel**: Preflop aggressor bets river after betting flop and turn. Highly polarized — strong value or high fold-equity bluff only.
- **Delayed c-bet**: Preflop aggressor checks flop, then bets turn or river. Range appears uncapped; often used as a trap or on boards that improve the aggressor's range on later streets.
- **Donk bet**: Preflop CALLER bets into the preflop AGGRESSOR on the flop. Generally weak in theory — avoid unless: (a) board strongly favors caller's range, (b) hand benefits from immediate protection, (c) opponent's c-bet frequency is very low.
- **Probe bet**: Preflop CALLER bets into preflop AGGRESSOR on the TURN or RIVER after aggressor checked the previous street. Legitimate play — aggressor's range is weakened after checking; probe with draws, medium hands, and polarized bluffs.
- **Check-raise**: OOP player checks then raises after opponent bets. Primary OOP weapon for building the pot with strong hands and as a bluff with draws.

## Game State
- Phase           : ${phase}
- Position        : ${position} — ${isIP ? 'IN POSITION (act last)' : 'OUT OF POSITION (act first)'}
- Hole cards      : ${formatCards(holeCards)}
- Hand strength   : ${handStrength}
- Community cards : ${formatCards(state.communityCards)}
- Board texture   : ${textureStr}
- Stack           : ${player.chips} chips  |  Bet this street: ${player.currentBet}
- Pot             : ${totalPot} chips  |  To call: ${toCall}  |  Big blind: ${state.bigBlind}
- Opponents active: ${numOpponents}${isMultiway ? ' (MULTIWAY)' : ''}

## Quantitative Metrics
- Equity (Monte Carlo)      : ${equityPct}
- Pot odds (if calling)     : ${potOddsStr}
- Required equity to call   : ${requiredEquityPct}%${actualCall > 0 ? ` — your equity (${equityPct}) is ${parseFloat(equityPct) >= parseFloat(requiredEquityPct) ? 'ABOVE (call has +EV)' : 'BELOW (fold unless strong draw)'}` : ' — N/A'}
- SPR                       : ${sprNote}
- Opponent bet vs pot       : ${betSizeNote}

## Preflop Range Tendency (${position})
${preflopRangeNote}

## Board Texture & Range Advantage
- Board texture     : ${textureStr}
- Bet sizing guide  : ${sizingGuide}
- Hero range        : ${heroRange.description}
${opponentRanges.map((r, i) => `- ${activeOpponents[i]?.name ?? `Opp${i+1}`} range: ${r.description} (${r.position}, ${r.action})`).join('\n')}
- Range advantage   : ${rangeAdvResult.rangeAdvantage === 'hero' ? 'HERO ✓ → bet more frequently, deny equity, double barrel' : rangeAdvResult.rangeAdvantage === 'villain' ? 'VILLAIN ✗ → check more, check-raise strong hands, avoid wide donk-bets' : 'NEUTRAL → mix bets/checks by hand strength and position'}
- Nut advantage     : ${rangeAdvResult.nutAdvantage === 'hero' ? 'HERO ✓ → polarize sizing LARGE/OVERBET; opponent must call with weaker range' : rangeAdvResult.nutAdvantage === 'villain' ? 'VILLAIN ✗ → caution with medium hands facing large bets; check-raise bluffs less effective' : 'NEUTRAL → standard sizing applies'}
- Summary           : ${rangeAdvResult.summary}

## Hand Assignment (Check-Range vs Bet-Range)
${handAssignmentNote}

## Thin Value & Bluff Policy
${thinValueBluffGuide}
${riverIpCheckNote ? `\n## River Spot\n${riverIpCheckNote}` : ''}

## Active Opponents
${opponents || '  (none remaining)'}

## Action History This Hand
${formatActionHistory(state.actionHistory, state.players)}

## Decision Steps (follow in order)
1. RANGE CONTEXT: Does hero have range/nut advantage on this board? Use the Range Advantage section.
2. HAND ASSIGNMENT: Assign THIS hand to bet-range or check-range using the Hand Assignment section above.
3. SIZING: If betting, select size from the Bet Sizing Guide. Thin value → SMALL/MEDIUM. Strong value → MEDIUM/LARGE. Bluff → size for fold equity (SMALL/MEDIUM). Nut advantage → LARGE/OVERBET.
4. MULTIWAY CHECK: If 2+ opponents, cut bluff frequency to near zero. Bet only for value.
5. POSITION: IP → lean toward betting/raising to deny equity. OOP → prefer check-raise over donk-bet (unless range advantage).
6. FINAL CHECK: Is the chosen action consistent with maximizing EV across the full range?

## Your Valid Actions
${validActions.map((a) => `  • ${a}`).join('\n')}

## Response Format
Respond with ONLY a JSON object — no markdown, no extra text:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in",
  "amount": <integer, REQUIRED when action is "raise" — total bet size this street>,
  "reasoning": "REQUIRED: 2-3 sentences covering (1) hand assignment to bet/check range and why, (2) range/board context, (3) chosen action and sizing rationale."
}

Constraints:
- "check" only valid when toCall === 0
- "raise" amount must be ≥ ${minRaiseTotal} and ≤ ${player.chips + player.currentBet}
- If you cannot afford a raise, use "all-in" instead
- IMPORTANT: always use action "raise" in the JSON even when opening the betting (no prior bet this street).
${language === 'ja'
  ? `- You MUST write the reasoning field in Japanese only. Do NOT use English in the reasoning field. Poker terms in katakana (e.g. レンジ、チェックレンジ、ベットレンジ、バリュー、ブラフ、ポジション、レンジアドバンテージ、ナッツアドバンテージ、ポットオッズ).`
    + (canCheck ? `\n- This is an opening bet situation. In reasoning say "ベット" NOT "レイズ".` : '')
  : `- You MUST write the reasoning field in English only.`
    + (canCheck ? `\n- This is an opening bet situation. In reasoning say "bet" NOT "raise".` : '')
}`
}

// ──────────────────────────────────────────────────────────────────────────────
// Response validation / sanitisation
// ──────────────────────────────────────────────────────────────────────────────

function sanitise(
  raw: RawDecision,
  state: GameState,
  player: Player,
  language: 'ja' | 'en' = 'ja',
): ClaudeDecision {
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const minRaiseTotal = state.currentBet + state.minRaise
  const maxBet = player.chips + player.currentBet
  const fallbackReasoning = language === 'en'
    ? 'Selected the best available action based on hand strength and pot odds.'
    : '手の強さとポットオッズに基づいて最善のアクションを選択しました。'
  const reasoning = raw.reasoning?.trim() || fallbackReasoning

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

function extractJson(text: string): RawDecision | null {
  try {
    // Strip markdown code fences
    const stripped = text.replace(/```[a-z]*\n?/gi, '').trim()

    // Find the first {...} block
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start === -1 || end === -1) return null

    const jsonStr = stripped.slice(start, end + 1)
    return JSON.parse(jsonStr) as RawDecision
  } catch {
    return null
  }
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
const CLAUDE_TIMEOUT_MS = 15_000

export async function claudeDecideAction(
  state: GameState,
  player: Player,
  language: 'ja' | 'en' = 'ja',
): Promise<ClaudeDecision> {
  const client = getClient()
  const systemPrompt = buildSystemPrompt(state, player, language)

  const apiCall = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.messages.create as any)({
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
          content: language === 'ja' ? 'アクションを選んでください。' : 'Please choose your action.',
        },
      ],
    })

    // Extract text content
    const textBlock = (response.content as Array<{type: string; text?: string}>).find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content in Claude response')
    }

    const raw = extractJson(textBlock.text!)
    if (raw === null) {
      const toCall = Math.max(0, state.currentBet - player.currentBet)
      const fallbackReasoning = language === 'en'
        ? 'Selected the best available action based on hand strength and pot odds.'
        : '手の強さとポットオッズに基づいて最善のアクションを選択しました。'
      return { action: (toCall === 0 ? 'check' : 'call') as ActionType, reasoning: fallbackReasoning }
    }
    return sanitise(raw, state, player, language)
  })()

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Claude timeout after ${CLAUDE_TIMEOUT_MS}ms`)), CLAUDE_TIMEOUT_MS)
  )

  return Promise.race([apiCall, timeout])
}
