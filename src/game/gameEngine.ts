import { createDeck, shuffleDeck } from './deck'
import { compareHandResults, evaluateHand } from './handEvaluator'
import type {
  ActionType,
  Card,
  GamePhase,
  GameState,
  Player,
  PlayerAction,
  Pot,
  PotResult,
} from './types'

// ──────────────────────────────────────────────────────────────────────────────
// Constants / helpers
// ──────────────────────────────────────────────────────────────────────────────
const PHASE_ORDER: GamePhase[] = ['preflop', 'flop', 'turn', 'river', 'showdown']
const COMMUNITY_CARDS_PER_PHASE: Partial<Record<GamePhase, number>> = {
  flop: 3,
  turn: 1,
  river: 1,
}

function clonePlayers(players: Player[]): Player[] {
  return players.map((p) => ({ ...p }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Initial State
// ──────────────────────────────────────────────────────────────────────────────
export function createInitialState(players: Player[], bigBlind = 20): GameState {
  return {
    phase: 'waiting',
    players,
    deck: [],
    communityCards: [],
    pots: [],
    currentBet: 0,
    minRaise: bigBlind,
    bigBlind,
    smallBlind: bigBlind / 2,
    dealerIndex: 0,
    activePlayerIndex: -1,
    actionHistory: [],
    handNumber: 0,
    winners: [],
    actedThisStreet: [],
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Deal / Start Hand
// ──────────────────────────────────────────────────────────────────────────────
const REBUY_STACK = 1000

export function startHand(state: GameState): GameState {
  const deck = shuffleDeck(createDeck())
  const n = state.players.length

  // Auto-rebuy: players with 0 chips re-enter with the initial stack
  const rebought = clonePlayers(state.players).map((p) =>
    p.chips === 0 ? { ...p, chips: REBUY_STACK } : p,
  )

  // Reset all players for new hand
  const players = rebought.map((p) => ({
    ...p,
    holeCards: [] as unknown as [Card, Card],
    isFolded: false,
    isAllIn: false,
    currentBet: 0,
    totalBetThisHand: 0,
    isTurn: false,
    isDealer: false,
  }))

  // Rotate dealer button
  const dealerIdx = (state.dealerIndex + 1) % n
  players[dealerIdx].isDealer = true

  // Blind positions: heads-up rule (dealer = SB)
  const sbIdx = n === 2 ? dealerIdx : (dealerIdx + 1) % n
  const bbIdx = (sbIdx + 1) % n

  // Deal 2 hole cards each (alternating, as in real poker)
  const dealt = [...deck]
  const tempHands: Card[][] = players.map(() => [])
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const card = dealt.pop()!
      tempHands[i].push({ ...card, faceUp: players[i].isHuman })
    }
  }
  for (let i = 0; i < n; i++) {
    players[i].holeCards = tempHands[i] as [Card, Card]
  }

  // Post blinds (handle short stacks going all-in on blind)
  const postBlind = (idx: number, amount: number) => {
    const actual = Math.min(amount, players[idx].chips)
    players[idx].chips -= actual
    players[idx].currentBet = actual
    players[idx].totalBetThisHand = actual
    if (players[idx].chips === 0) players[idx].isAllIn = true
  }
  postBlind(sbIdx, state.smallBlind)
  postBlind(bbIdx, state.bigBlind)

  const currentBet = players[bbIdx].currentBet // may be < bigBlind if short stack

  // UTG is first to act preflop (or dealer in heads-up)
  const utgIdx = n === 2 ? dealerIdx : (bbIdx + 1) % n
  const firstActor = findNextCanAct(players, (utgIdx - 1 + n) % n)
  if (firstActor !== -1) players[firstActor].isTurn = true

  return {
    ...state,
    phase: 'preflop',
    deck: dealt,
    players,
    communityCards: [],
    pots: [
      {
        amount: players[sbIdx].currentBet + players[bbIdx].currentBet,
        eligiblePlayerIds: players.map((p) => p.id),
      },
    ],
    currentBet,
    minRaise: state.bigBlind,
    dealerIndex: dealerIdx,
    activePlayerIndex: firstActor,
    actionHistory: [],
    handNumber: state.handNumber + 1,
    winners: [],
    actedThisStreet: [],
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Player Actions
// ──────────────────────────────────────────────────────────────────────────────
export function applyAction(state: GameState, action: ActionType, amount?: number): GameState {
  const players = clonePlayers(state.players)
  const actor = players[state.activePlayerIndex]
  if (!actor) {
    console.warn('[applyAction] No active player at index', state.activePlayerIndex)
    return state
  }

  const playerAction: PlayerAction = {
    playerId: actor.id,
    action,
    amount,
    timestamp: Date.now(),
  }

  let newCurrentBet = state.currentBet
  let newMinRaise = state.minRaise
  let isRaise = false

  switch (action) {
    // ── Fold ──
    case 'fold':
      actor.isFolded = true
      actor.holeCards = [] as unknown as [Card, Card]
      break

    // ── Check ──
    case 'check':
      // no chip movement; only valid when currentBet === actor.currentBet
      break

    // ── Call ──
    case 'call': {
      const toCall = state.currentBet - actor.currentBet
      const actual = Math.min(toCall, actor.chips)
      actor.chips -= actual
      actor.currentBet += actual
      actor.totalBetThisHand += actual
      if (actor.chips === 0) actor.isAllIn = true
      break
    }

    // ── Raise ──
    case 'raise': {
      // `amount` = total bet size this street (not the increment)
      const targetBet = Math.max(amount ?? state.currentBet + state.minRaise, state.currentBet + state.minRaise)
      const cappedBet = Math.min(targetBet, actor.currentBet + actor.chips)
      const extra = cappedBet - actor.currentBet
      actor.chips -= extra
      const prevBet = actor.currentBet
      actor.currentBet = cappedBet
      actor.totalBetThisHand += extra
      if (actor.chips === 0) actor.isAllIn = true
      newMinRaise = Math.max(state.minRaise, actor.currentBet - prevBet)
      newCurrentBet = actor.currentBet
      isRaise = true
      break
    }

    // ── All-in ──
    case 'all-in': {
      const allIn = actor.chips
      const prevBet = actor.currentBet
      actor.currentBet += allIn
      actor.totalBetThisHand += allIn
      actor.chips = 0
      actor.isAllIn = true
      if (actor.currentBet > state.currentBet) {
        // counts as a raise (reopens action)
        newMinRaise = Math.max(state.minRaise, actor.currentBet - prevBet)
        newCurrentBet = actor.currentBet
        isRaise = true
      }
      break
    }
  }

  // Rebuild single pot total (side-pot splits happen at showdown)
  const totalInPot = state.pots.reduce((s, p) => s + p.amount, 0)
  const totalPlayerBets = players.reduce((s, p) => s + p.totalBetThisHand, 0)
  // pots[0].amount = total money wagered this hand
  const pots: Pot[] = [
    {
      amount: Math.max(totalInPot, totalPlayerBets),
      eligiblePlayerIds: players.filter((p) => !p.isFolded).map((p) => p.id),
    },
  ]

  // Track who has acted since last raise
  const actedThisStreet = isRaise
    ? [actor.id]
    : [...state.actedThisStreet, actor.id]

  actor.isTurn = false
  const nextIdx = findNextCanAct(players, state.activePlayerIndex)
  if (nextIdx !== -1) players[nextIdx].isTurn = true

  return {
    ...state,
    players,
    pots,
    currentBet: newCurrentBet,
    minRaise: newMinRaise,
    activePlayerIndex: nextIdx,
    actionHistory: [...state.actionHistory, playerAction],
    actedThisStreet,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Round / Street completion checks
// ──────────────────────────────────────────────────────────────────────────────

/** True when only ≤1 non-folded player remains — hand is immediately over */
export function isHandOver(state: GameState): boolean {
  return state.players.filter((p) => !p.isFolded).length <= 1
}

/**
 * True when betting for the current street is complete.
 * Conditions:
 *   1. All non-folded players are all-in (no one can act)
 *   2. All active (non-folded, non-all-in) players have:
 *      - acted since the last raise, AND
 *      - put in the same bet as currentBet
 */
export function isStreetOver(state: GameState): boolean {
  const canAct = state.players.filter((p) => !p.isFolded && !p.isAllIn)

  // No one left who can act
  if (canAct.length === 0) return true

  const allActed = canAct.every((p) => state.actedThisStreet.includes(p.id))
  const allBetsEqual = canAct.every((p) => p.currentBet === state.currentBet)

  return allActed && allBetsEqual
}

// ──────────────────────────────────────────────────────────────────────────────
// Street / Phase advancement
// ──────────────────────────────────────────────────────────────────────────────

/** Deal community cards and advance to the next street, resetting bets. */
export function advanceToNextStreet(state: GameState): GameState {
  const currentIdx = PHASE_ORDER.indexOf(state.phase as GamePhase)
  const nextPhase = PHASE_ORDER[currentIdx + 1]

  // If already at river or showdown → go to showdown
  if (!nextPhase || nextPhase === 'showdown') {
    return resolveShowdown(state)
  }

  // Deal community cards
  let newState = state
  const cardsToDeal = COMMUNITY_CARDS_PER_PHASE[nextPhase]
  if (cardsToDeal) {
    newState = dealCommunityCards(state, cardsToDeal)
  }

  // Reset bets for new street
  const players = clonePlayers(newState.players).map((p) => ({
    ...p,
    currentBet: 0,
    isTurn: false,
  }))

  // First to act post-flop: first active player left of dealer (SB and clockwise)
  const firstActor = findFirstPostflopActor(players, newState.dealerIndex)
  if (firstActor !== -1) players[firstActor].isTurn = true

  const nextStreetState: GameState = {
    ...newState,
    phase: nextPhase,
    players,
    currentBet: 0,
    minRaise: state.bigBlind,
    activePlayerIndex: firstActor,
    actedThisStreet: [],
  }

  return nextStreetState
}

function dealCommunityCards(state: GameState, count: number): GameState {
  const deck = [...state.deck]
  deck.pop() // burn card
  const newCards: Card[] = []
  for (let i = 0; i < count; i++) {
    newCards.push({ ...deck.pop()!, faceUp: true })
  }
  return {
    ...state,
    deck,
    communityCards: [...state.communityCards, ...newCards],
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Side-pot calculation
// ──────────────────────────────────────────────────────────────────────────────

interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
  potType: 'main' | 'side'
}

/**
 * Compute side pots from each player's total investment this hand.
 *
 * Algorithm: for each unique "all-in level" (sorted ascending), collect
 * contributions up to that level from all contributors (including folders,
 * since their chips are already in the pot), and assign eligibility to
 * non-folded players who reached that level.
 *
 * Example:
 *   P1: 50 all-in,  P2: 100 all-in,  P3: 150,  P4: 150
 *   → Main (all):        50 × 4 = 200  (eligible: P1 P2 P3 P4)
 *   → Side 1 (P2+):  50 × 3 = 150  (eligible: P2 P3 P4)
 *   → Side 2 (P3 P4): 50 × 2 = 100  (eligible: P3 P4)
 */
function computeSidePots(players: Player[]): SidePot[] {
  // Only non-folded players are eligible to win; all players contribute
  const nonFolded = players.filter((p) => !p.isFolded && p.totalBetThisHand > 0)
  const allContributors = players.filter((p) => p.totalBetThisHand > 0)

  if (nonFolded.length === 0) return []

  // Pot levels are defined by non-folded players' bets
  const levels = [...new Set(nonFolded.map((p) => p.totalBetThisHand))].sort((a, b) => a - b)

  const pots: SidePot[] = []
  let prev = 0

  for (const level of levels) {
    // Amount each contributor adds to this layer (capped at their bet)
    const amount = allContributors.reduce((sum, p) => {
      const contribution = Math.min(p.totalBetThisHand, level) - prev
      return sum + Math.max(0, contribution)
    }, 0)

    if (amount <= 0) {
      prev = level
      continue
    }

    const eligiblePlayerIds = nonFolded
      .filter((p) => p.totalBetThisHand >= level)
      .map((p) => p.id)

    pots.push({
      amount,
      eligiblePlayerIds,
      potType: pots.length === 0 ? 'main' : 'side',
    })

    prev = level
  }

  return pots
}

// ──────────────────────────────────────────────────────────────────────────────
// Showdown
// ──────────────────────────────────────────────────────────────────────────────
export function resolveShowdown(state: GameState): GameState {
  const players = clonePlayers(state.players)

  // Reveal all remaining hole cards
  for (const p of players) {
    if (!p.isFolded && p.holeCards.length === 2) {
      p.holeCards = (p.holeCards as [Card, Card]).map((c) => ({ ...c, faceUp: true })) as [Card, Card]
    }
  }

  const nonFolded = players.filter((p) => !p.isFolded)
  const winners: PotResult[] = []

  // ── Uncontested (everyone else folded) ──
  if (nonFolded.length === 1) {
    const winner = nonFolded[0]
    const totalPot = state.pots.reduce((s, p) => s + p.amount, 0)
    winner.chips += totalPot
    winners.push({ winners: [winner.id], amount: totalPot, potType: 'main', isUncontested: true })
    return buildShowdownState(state, players, winners)
  }

  // ── Multi-way showdown with side pots ──
  const sidePots = computeSidePots(players)

  for (const pot of sidePots) {
    const eligible = nonFolded.filter((p) => pot.eligiblePlayerIds.includes(p.id))
    if (eligible.length === 0) continue

    // Auto-win if only one eligible player
    if (eligible.length === 1) {
      eligible[0].chips += pot.amount
      winners.push({ winners: [eligible[0].id], amount: pot.amount, potType: pot.potType })
      continue
    }

    // Evaluate hands for all eligible players
    const hands = eligible.map((p) => ({
      ...evaluateHand(p.holeCards as [Card, Card], state.communityCards),
      playerId: p.id,
    }))

    // Find winner(s) — support split pots (ties)
    const potWinners = hands.reduce<typeof hands>((best, hand) => {
      const cmp = compareHandResults(hand, best[0])
      if (cmp > 0) return [hand]
      if (cmp === 0) return [...best, hand]
      return best
    }, [hands[0]])

    // Distribute pot (remainder chip goes to first winner — position closest to dealer)
    const share = Math.floor(pot.amount / potWinners.length)
    const remainder = pot.amount % potWinners.length
    potWinners.forEach((hand, i) => {
      const player = players.find((p) => p.id === hand.playerId)!
      player.chips += share + (i === 0 ? remainder : 0)
    })

    winners.push({
      winners: potWinners.map((h) => h.playerId),
      amount: pot.amount,
      potType: pot.potType,
    })
  }

  return buildShowdownState(state, players, winners)
}

function buildShowdownState(state: GameState, players: Player[], winners: PotResult[]): GameState {
  return {
    ...state,
    phase: 'showdown',
    players,
    pots: [],
    winners,
    activePlayerIndex: -1,
    actedThisStreet: [],
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Navigation helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Find the next player who can act (not folded, not all-in).
 * Searches clockwise from `fromIdx` (exclusive).
 */
function findNextCanAct(players: Player[], fromIdx: number): number {
  const n = players.length
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n
    if (!players[idx].isFolded && !players[idx].isAllIn) return idx
  }
  return -1 // everyone is folded or all-in
}

/**
 * Post-flop first actor: first non-folded, non-all-in player
 * clockwise from the dealer (dealer is last to act post-flop).
 */
function findFirstPostflopActor(players: Player[], dealerIdx: number): number {
  const n = players.length
  for (let i = 1; i <= n; i++) {
    const idx = (dealerIdx + i) % n
    if (!players[idx].isFolded && !players[idx].isAllIn) return idx
  }
  return -1
}
