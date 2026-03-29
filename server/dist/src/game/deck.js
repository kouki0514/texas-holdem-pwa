"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RANK_VALUES = exports.RANKS = exports.SUITS = void 0;
exports.cardId = cardId;
exports.createDeck = createDeck;
exports.shuffleDeck = shuffleDeck;
exports.rankToValue = rankToValue;
exports.SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
exports.RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
/** Numeric value of a rank (A = 14) */
exports.RANK_VALUES = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};
/** Unique string key for a card, useful for React keys and debugging */
function cardId(card) {
    return `${card.rank}${card.suit[0].toUpperCase()}`;
}
/** Create an ordered 52-card deck (face-down) */
function createDeck() {
    const deck = [];
    for (const suit of exports.SUITS) {
        for (const rank of exports.RANKS) {
            deck.push({ suit, rank, faceUp: false });
        }
    }
    return deck;
}
/** Fisher–Yates in-place shuffle — returns a new array */
function shuffleDeck(deck) {
    const d = [...deck];
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}
function rankToValue(rank) {
    return exports.RANK_VALUES[rank];
}
