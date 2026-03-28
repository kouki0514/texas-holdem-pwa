import type { Card, Rank, Suit } from './types'

export const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs']
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

/** Numeric value of a rank (A = 14) */
export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
}

/** Unique string key for a card, useful for React keys and debugging */
export function cardId(card: Card): string {
  return `${card.rank}${card.suit[0].toUpperCase()}`
}

/** Create an ordered 52-card deck (face-down) */
export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, faceUp: false })
    }
  }
  return deck
}

/** Fisher–Yates in-place shuffle — returns a new array */
export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck]
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

export function rankToValue(rank: Rank): number {
  return RANK_VALUES[rank]
}
