// ──────────────────────────────────────────────
// Card & Deck
// ──────────────────────────────────────────────
export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  suit: Suit
  rank: Rank
  faceUp: boolean
}

// ──────────────────────────────────────────────
// Player
// ──────────────────────────────────────────────
export type PlayerPosition = 'BTN' | 'SB' | 'BB' | 'UTG' | 'HJ' | 'CO'

export interface Player {
  id: string
  name: string
  chips: number
  holeCards: [Card, Card] | []
  position: PlayerPosition | null
  isHuman: boolean
  isFolded: boolean
  isAllIn: boolean
  currentBet: number
  totalBetThisHand: number
  isDealer: boolean
  isTurn: boolean
}

// ──────────────────────────────────────────────
// Betting & Actions
// ──────────────────────────────────────────────
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in'

export interface PlayerAction {
  playerId: string
  action: ActionType
  amount?: number
  timestamp: number
}

// ──────────────────────────────────────────────
// Game Phase
// ──────────────────────────────────────────────
export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended'

// ──────────────────────────────────────────────
// Hand Result
// ──────────────────────────────────────────────
export type HandRank =
  | 'high-card'
  | 'one-pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush'

export interface HandResult {
  playerId: string
  rank: HandRank
  /** Primary rank category: 0 = high-card … 9 = royal-flush */
  rankValue: number
  bestFive: [Card, Card, Card, Card, Card]
  /** Numeric tiebreakers (suit-agnostic), for display and comparison */
  kickers: number[]
  /** Full lexicographic score vector [rankValue, ...tiebreakers] — internal use */
  _score: number[]
}

export interface PotResult {
  winners: string[]
  amount: number
  potType: 'main' | 'side'
  /** true when all opponents folded — no showdown, hand rank should not be displayed */
  isUncontested?: boolean
}

// ──────────────────────────────────────────────
// Game State
// ──────────────────────────────────────────────
export interface Pot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface GameState {
  phase: GamePhase
  players: Player[]
  deck: Card[]
  communityCards: Card[]
  pots: Pot[]
  currentBet: number
  minRaise: number
  bigBlind: number
  smallBlind: number
  dealerIndex: number
  activePlayerIndex: number
  actionHistory: PlayerAction[]
  handNumber: number
  winners: PotResult[]
  /** playerIds who have acted since the last raise this street (for round-over detection) */
  actedThisStreet: string[]
}
