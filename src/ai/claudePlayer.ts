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

/**
 * Estimate win equity via Monte Carlo simulation.
 * Randomly completes unknown community cards and opponent hole cards,
 * then evaluates who wins. Returns win rate [0, 1].
 */
function estimateEquity(
  holeCards: [Card, Card],
  communityCards: Card[],
  numOpponents: number,
  iterations = 500,
): number {
  if (numOpponents <= 0) return 1

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
    // Fisher-Yates partial shuffle — only shuffle as many cards as we need
    const cardsNeeded = boardNeeded + numOpponents * 2
    const deck = [...fullDeck]
    for (let j = 0; j < cardsNeeded && j < deck.length; j++) {
      const r = j + Math.floor(Math.random() * (deck.length - j))
      ;[deck[j], deck[r]] = [deck[r], deck[j]]
    }
    if (deck.length < cardsNeeded) continue

    // Complete community cards
    const board: Card[] = [
      ...communityCards,
      ...deck.slice(0, boardNeeded),
    ]

    // Deal opponent hole cards
    let heroWins = true
    let heroResult: ReturnType<typeof evaluateHand> | null = null
    try {
      heroResult = evaluateHand(holeCards, board)
    } catch {
      continue
    }

    for (let opp = 0; opp < numOpponents; opp++) {
      const oppHole: [Card, Card] = [
        deck[boardNeeded + opp * 2],
        deck[boardNeeded + opp * 2 + 1],
      ]
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

  // ── Monte Carlo equity ───────────────────────────────────────────────────────
  const equity = estimateEquity(holeCards, state.communityCards, numOpponents, 500)
  const equityPct = `${(equity * 100).toFixed(1)}%`

  // ── Pot odds & required equity ──────────────────────────────────────────────
  const potOdds = toCall > 0 ? toCall / (totalPot + toCall) : 0
  const potOddsStr = toCall > 0
    ? `${(potOdds * 100).toFixed(1)}% (call ${toCall} into pot-after-call ${totalPot + toCall})`
    : 'N/A (no call required)'

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

  // ── Opponent bet sizing relative to pot ─────────────────────────────────────
  // potBeforeBet = pot before opponent's bet was made.
  // totalPot already includes the opponent's currentBet, so subtract it to get pre-bet pot.
  let betSizeNote = 'N/A'
  if (state.currentBet > 0 && totalPot > 0) {
    const potBeforeBet = Math.max(1, totalPot - state.currentBet)
    const ratio = state.currentBet / potBeforeBet
    if (ratio <= 0.4) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — small bet: wide continuing range, re-raise bluffs viable`
    else if (ratio <= 0.6) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — half-pot: balanced range; need ~25% equity to call`
    else if (ratio <= 0.85) betSizeNote = `${(ratio * 100).toFixed(0)}% pot — 2/3 pot: polarised range; need ~32% equity`
    else betSizeNote = `${(ratio * 100).toFixed(0)}% pot — pot-size+: very polarised; need ~40%+ equity, fold marginal hands`
  }

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

  let posStrategy: string
  if (posLower.includes('btn')) {
    posStrategy = 'BTN: widest open-raise range (~45-50% hands), steal often, apply max pressure post-flop IP'
  } else if (posLower.includes('co')) {
    posStrategy = 'CO: open ~30% hands, 3-bet squeeze BTN/SB, play aggressively IP'
  } else if (posLower.includes('sb')) {
    posStrategy = isIP
      ? 'SB (IP vs BB HU): acts last post-flop — apply pressure, bet wide for value and bluffs'
      : 'SB: OOP post-flop — prefer 3-bet over call to deny equity; use check-raise, avoid donk-betting'
  } else if (posLower.includes('bb')) {
    posStrategy = isIP
      ? 'BB (IP vs SB HU): acts last post-flop — apply pressure, bet wide for value and bluffs'
      : 'BB: getting best price, defend wide (pot odds), check-raise as primary weapon OOP'
  } else {
    posStrategy = 'EP/MP: tight range, raise for value/protection, fold to 3-bets without premiums'
  }

  // ── River IP + opponent checked: 3-way decision note ────────────────────────
  const isRiver = state.phase === 'river'
  const opponentChecked = isRiver && toCall === 0 &&
    state.actionHistory.some((a) => a.action === 'check' && a.playerId !== player.id)
  const riverIpCheckNote = isRiver && isIP && opponentChecked
    ? `RIVER IP + OPPONENT CHECKED: You have exactly 3 options — (A) Value bet (SMALL/MEDIUM/LARGE) with strong made hand, (B) Bluff bet (SMALL/MEDIUM) to fold out weak hands you can't beat, (C) Check behind for free showdown with medium-strength hands. Do NOT consider call or fold here — bet or check only.`
    : null

  // ── Bluff frequency guidance ─────────────────────────────────────────────────
  const bluffBase = toCall > 0
    ? `To keep opponent indifferent: bluff ${(potOdds * 100).toFixed(0)}% of your betting range`
    : '1/3 pot needs 25% bluffs, 1/2 pot needs 33%, 2/3 pot needs 40%'
  const bluffRatio = isMultiway
    ? `${bluffBase}. MULTIWAY POT (${numOpponents} opponents): significantly reduce bluff frequency — each opponent independently calls, so bluffs lose EV rapidly.`
    : bluffBase

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

  const rangeAnalysisLines: string[] = [
    `Hero range estimate   : ${heroRange.description} (based on ${heroRange.position}, action: ${heroRange.action})`,
  ]
  opponentRanges.forEach((r, i) => {
    const name = activeOpponents[i]?.name ?? `Opp${i + 1}`
    rangeAnalysisLines.push(`${name} range estimate: ${r.description} (${r.position}, action: ${r.action})`)
  })
  rangeAnalysisLines.push(`Range advantage: ${rangeAdvResult.rangeAdvantage === 'hero' ? 'HERO ✓' : rangeAdvResult.rangeAdvantage === 'villain' ? 'VILLAIN ✗' : 'NEUTRAL'}`)
  rangeAnalysisLines.push(`Nut advantage  : ${rangeAdvResult.nutAdvantage === 'hero' ? 'HERO ✓' : rangeAdvResult.nutAdvantage === 'villain' ? 'VILLAIN ✗' : 'NEUTRAL'}`)
  rangeAnalysisLines.push(rangeAdvResult.summary)

  // ── Range-based strategy hint ─────────────────────────────────────────────────
  let rangeStrategyHint: string
  if (rangeAdvResult.rangeAdvantage === 'hero') {
    rangeStrategyHint = 'Hero has range advantage — increase bet frequency, prefer leading bets and double barrels over checking.'
  } else if (rangeAdvResult.rangeAdvantage === 'villain') {
    rangeStrategyHint = 'Villain(s) have range advantage — prefer check-raise or check-call; avoid wide donk-betting; let opponent bet into your strong hands.'
  } else {
    rangeStrategyHint = 'Ranges are balanced — mix bets and checks; use hand strength and position to guide sizing.'
  }

  const nutStrategyHint = rangeAdvResult.nutAdvantage === 'hero'
    ? 'Hero has nut advantage — polarize sizing (LARGE/OVERBET) when value betting; opponent must call with weaker ranges.'
    : rangeAdvResult.nutAdvantage === 'villain'
      ? 'Villain has nut advantage — be cautious with medium-strength hands facing large bets; check-raise bluffs less effective.'
      : ''

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

  return `You are a GTO-trained Texas Hold'em expert named "${player.name}". Make decisions using equity, pot odds, SPR, board texture, position, range analysis, and balanced bluff/value ratios. Always reason step-by-step before deciding.

## Situation
- Phase           : ${state.phase}
- Position        : ${position}
- Hole cards      : ${formatCards(holeCards)}
- Hand strength   : ${handStrength}
- Community cards : ${formatCards(state.communityCards)}
- Board texture   : ${textureStr}
- Stack           : ${player.chips} chips  |  Current bet this street: ${player.currentBet}
- Pot             : ${totalPot} chips  |  To call: ${toCall}  |  Big blind: ${state.bigBlind}
- Min raise to    : ${minRaiseTotal} chips
- Opponents active: ${numOpponents}${isMultiway ? ' (MULTIWAY — tighten ranges, reduce bluffs)' : ''}

## Quantitative Metrics
- Equity (Monte Carlo ${500} trials): ${equityPct}
- Pot odds (if calling)             : ${potOddsStr}
- SPR                               : ${sprNote}
- Opponent bet vs pot               : ${betSizeNote}

## Bet Sizing Guide
${sizingGuide}

## Range Analysis
${rangeAnalysisLines.map((l) => `- ${l}`).join('\n')}

## Strategic Context
- Position strategy : ${posStrategy}
- Range strategy    : ${rangeStrategyHint}${nutStrategyHint ? `\n- Nut advantage    : ${nutStrategyHint}` : ''}
- Bluff frequency   : ${bluffRatio}${riverIpCheckNote ? `\n- River situation  : ${riverIpCheckNote}` : ''}

## Active Opponents
${opponents || '  (none remaining)'}

## Action History This Hand
${formatActionHistory(state.actionHistory, state.players)}

## Decision Framework
1. Compare equity (${equityPct}) vs pot odds (${potOddsStr}) — if equity < pot odds and no strong draw, fold.
2. Apply SPR: low SPR → commit or fold; high SPR → implied odds matter.
3. In position (BTN/CO): apply pressure; out of position (SB/BB): prefer check-raise over donk-bet.
4. Large opponent bets (>2/3 pot) = polarised → re-raise or fold, rarely call.
5. Use bet sizing guide above — choose SMALL/MEDIUM/LARGE/OVERBET and state the exact chip amount.
6. Multiway: avoid bluffing unless you have strong fold equity. Bet for value or check.
7. Range advantage (hero): increase bet frequency, double barrel more, bet for protection and value.
8. Range disadvantage (villain): prefer check-raise and check-call; avoid wide donk-betting; trap with strong hands.
9. River IP bluff: when hand is Tier5-Trash or Tier5-Overcard and you are IP (BTN/CO) with opponent checked, consider SMALL or MEDIUM bluff bet (~30-40% frequency) to balance your betting range and deny free showdowns to dominated hands. Use blockers to nuts as additional motivation.

## Your Valid Actions
${validActions.map((a) => `  • ${a}`).join('\n')}

## Response Format
Respond with ONLY a JSON object — no markdown, no extra text:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in",
  "amount": <integer, REQUIRED when action is "raise" — total bet size this street, use sizing guide above>,
  "reasoning": "<2-3 sentences: cite equity%, pot odds, board texture, range advantage, sizing choice, then explain your decision>"
}

Constraints:
- "check" only valid when toCall === 0
- "raise" amount must be ≥ ${minRaiseTotal} and ≤ ${player.chips + player.currentBet}
- If you cannot afford a raise, use "all-in" instead
${language === 'ja'
  ? `- You MUST write the reasoning field in Japanese only. Do NOT use English in the reasoning field. Poker terms should be written in katakana (e.g. リバー、コール、レイズ、フロップ、ターン、チェック、フォールド、ブラフ、バリュー、ポット).`
  : `- You MUST write the reasoning field in English only. Do NOT use Japanese in the reasoning field.`
}`
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

    return sanitise(extractJson(textBlock.text!), state, player)
  })()

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Claude timeout after ${CLAUDE_TIMEOUT_MS}ms`)), CLAUDE_TIMEOUT_MS)
  )

  return Promise.race([apiCall, timeout])
}
