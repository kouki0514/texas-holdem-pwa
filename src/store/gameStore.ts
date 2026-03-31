import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ActionType, GameState, Player } from '@/game/types'
import {
  advanceToNextStreet,
  applyAction,
  createInitialState,
  isHandOver,
  isStreetOver,
  resolveShowdown,
  startHand,
} from '@/game/gameEngine'
import { decideAction, type AiDifficulty } from '@/ai/aiPlayer'
import { claudeDecideAction } from '@/ai/claudePlayer'
import { saveHand } from './statsDb'
import { evaluateHand } from '@/game/handEvaluator'
import type { Card } from '@/game/types'

// ──────────────────────────────────────────────────────────────────────────────
// Reasoning log (per player, keyed by playerId)
// ──────────────────────────────────────────────────────────────────────────────

export interface ReasoningEntry {
  communityCards: import('@/game/types').Card[]
  holeCards: import('@/game/types').Card[]
  playerId: string
  playerName: string
  action: ActionType
  amount?: number
  reasoning: string
  handNumber: number
  timestamp: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Session statistics
// ──────────────────────────────────────────────────────────────────────────────

export interface SessionStats {
  initialChips: number
  handsPlayed: number
  handsWon: number       // hands where human won at least one pot
  vpipHands: number      // hands where human voluntarily put chips in preflop
}

// ──────────────────────────────────────────────────────────────────────────────
// Store interface
// ──────────────────────────────────────────────────────────────────────────────

interface GameStore extends GameState {
  aiDifficulty: AiDifficulty
  /** Enable Claude API for all AI players */
  claudeEnabled: boolean
  /** Whether a Claude API call is in-flight (disables human actions until resolved) */
  claudeThinking: boolean
  /** Latest reasoning entry per playerId */
  latestReasoning: Record<string, ReasoningEntry>
  /** Full reasoning log for this hand */
  reasoningLog: ReasoningEntry[]
  /** Accumulated session statistics for the human player */
  sessionStats: SessionStats
  /** Whether the human acted voluntarily preflop this hand (for VPIP tracking) */
  _vpipThisHand: boolean
  /** Whether the human raised preflop this hand (for PFR tracking) */
  _pfrThisHand: boolean
  /** Human's chip count at the start of the current hand (for accurate net P&L) */
  _chipsAtHandStart: number
  /** Whether the hand record has already been persisted this hand (prevent double-write) */
  _handPersisted: boolean

  initGame: (players: Player[]) => void
  startNewHand: () => void
  playerAction: (action: ActionType, amount?: number) => void
  runAiTurn: () => void
  advanceRunout: () => void
  setAiDifficulty: (difficulty: AiDifficulty) => void
  setClaudeEnabled: (enabled: boolean) => void
  clearReasoning: () => void
  quitGame: () => void
}

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...createInitialState([]),
    aiDifficulty: 'medium',
    claudeEnabled: false,
    claudeThinking: false,
    latestReasoning: {},
    reasoningLog: [],
    sessionStats: { initialChips: 0, handsPlayed: 0, handsWon: 0, vpipHands: 0 },
    _vpipThisHand: false,
    _pfrThisHand: false,
    _chipsAtHandStart: 0,
    _handPersisted: false,

    initGame(players) {
      const human = players.find((p) => p.isHuman)
      set((s) => {
        Object.assign(s, createInitialState(players))
        s.latestReasoning = {}
        s.reasoningLog = []
        s.sessionStats = {
          initialChips: human?.chips ?? 1000,
          handsPlayed: 0,
          handsWon: 0,
          vpipHands: 0,
        }
        s._vpipThisHand = false
      })
    },

    startNewHand() {
      const humanBeforeHand = get().players.find((p) => p.isHuman)
      const chipsNow = humanBeforeHand?.chips ?? 0
      set((s) => {
        Object.assign(s, startHand(s as GameState))
        s._vpipThisHand = false
        s._pfrThisHand = false
        s._chipsAtHandStart = chipsNow
        s._handPersisted = false
      })
      scheduleAiIfNeeded(get)
    },

    playerAction(action, amount) {
      // Capture human's holeCards as plain objects BEFORE entering Immer draft
      // (fold clears holeCards; Immer Proxy objects cannot be stored in IndexedDB)
      const stateSnapshot = get()
      const humanBefore = stateSnapshot.players.find((p) => p.isHuman)
      const humanHoleCards: Card[] = humanBefore
        ? humanBefore.holeCards.map((c) => ({ ...c }))
        : []

      // VPIP/PFR: track before entering Immer draft so Object.assign(s, next) cannot overwrite flags
      // Only count when the active player is human (AI actions also route through playerAction)
      const activePlayer = stateSnapshot.players[stateSnapshot.activePlayerIndex]
      const isHumanPreflop = activePlayer?.isHuman && stateSnapshot.phase === 'preflop'
      const vpipNow = stateSnapshot._vpipThisHand ||
        (isHumanPreflop && (action === 'call' || action === 'raise' || action === 'all-in'))
      const pfrNow = stateSnapshot._pfrThisHand ||
        (isHumanPreflop && (action === 'raise' || action === 'all-in'))

      // Is the human the one folding right now?
      const humanIsFolding = stateSnapshot.players[stateSnapshot.activePlayerIndex]?.isHuman
        && action === 'fold'

      set((s) => {
        const state = s as GameState

        s._vpipThisHand = vpipNow
        s._pfrThisHand = pfrNow

        let next: GameState = applyAction(state, action, amount)

        if (isHandOver(next)) {
          next = resolveShowdown(next)
        } else if (isStreetOver(next)) {
          next = advanceToNextStreet(next)
        }

        // Record session stats at showdown (covers all endings)
        if (next.phase === 'showdown' && !s._handPersisted) {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (vpipNow) s.sessionStats.vpipHands += 1
        }

        // When human folds mid-hand (others still playing), count it now
        if (humanIsFolding && next.phase !== 'showdown' && !s._handPersisted) {
          s.sessionStats.handsPlayed += 1
          if (vpipNow) s.sessionStats.vpipHands += 1
        }

        Object.assign(s, next)
        // Restore flags overwritten by Object.assign (next is GameState, has no _vpipThisHand)
        s._vpipThisHand = vpipNow
        s._pfrThisHand = pfrNow
      })

      // Persist hand record outside Immer draft via setTimeout to avoid Proxy serialization issues
      const afterAction = get()
      const shouldPersistNow =
        (afterAction.phase === 'showdown' || humanIsFolding) && !afterAction._handPersisted
      if (shouldPersistNow) {
        const vpip = afterAction._vpipThisHand
        const pfr = afterAction._pfrThisHand
        const chipsAtHandStart = afterAction._chipsAtHandStart
        // Mark persisted synchronously before setTimeout fires to prevent duplicate writes
        set((s) => { s._handPersisted = true })
        setTimeout(() => persistHandRecord(afterAction as GameState, humanHoleCards, vpip, pfr, chipsAtHandStart), 0)
      }

      if (
        afterAction.phase !== 'showdown' &&
        afterAction.phase !== 'waiting' &&
        afterAction.activePlayerIndex === -1
      ) {
        scheduleRunout(get)
      } else {
        scheduleAiIfNeeded(get)
      }
    },

    advanceRunout() {
      // Capture human's holeCards as plain objects BEFORE entering Immer draft
      const stateSnapshot = get()
      if (stateSnapshot.phase === 'showdown' || stateSnapshot.phase === 'waiting') return
      const humanBefore = stateSnapshot.players.find((p) => p.isHuman)
      const humanHoleCards: Card[] = humanBefore
        ? humanBefore.holeCards.map((c) => ({ ...c }))
        : []

      set((s) => {
        const state = s as GameState
        if (state.phase === 'showdown' || state.phase === 'waiting') return
        const next = advanceToNextStreet(state)

        // Record session stats when runout reaches showdown (persist happens outside via setTimeout)
        if (next.phase === 'showdown') {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (s._vpipThisHand) s.sessionStats.vpipHands += 1
        }

        Object.assign(s, next)
      })

      // Persist hand record outside Immer draft via setTimeout to avoid Proxy serialization issues
      const afterAdvance = get()
      if (afterAdvance.phase === 'showdown' && !afterAdvance._handPersisted) {
        const vpip = afterAdvance._vpipThisHand
        const pfr = afterAdvance._pfrThisHand
        const chipsAtHandStart = afterAdvance._chipsAtHandStart
        set((s) => { s._handPersisted = true })
        setTimeout(() => persistHandRecord(afterAdvance as GameState, humanHoleCards, vpip, pfr, chipsAtHandStart), 0)
      }

      // If still no one can act (more streets remaining), schedule next reveal
      if (afterAdvance.phase !== 'showdown' && afterAdvance.activePlayerIndex === -1) {
        scheduleRunout(get)
      }
    },

    runAiTurn() {
      const state = get()
      if (state.phase === 'showdown' || state.phase === 'ended') return
      if (state.claudeThinking) return

      const idx = state.activePlayerIndex
      if (idx === -1) return
      const player = state.players[idx]
      if (!player || player.isHuman || player.isFolded || player.isAllIn) return

      if (state.claudeEnabled) {
        // ── Claude path (async) ────────────────────────────────────────────
        set((s) => { s.claudeThinking = true })

        claudeDecideAction(state, player)
          .then((decision) => {
            // Record reasoning
            const entry: ReasoningEntry = {
              playerId: player.id,
              playerName: player.name,
              action: decision.action,
              amount: decision.amount,
              reasoning: decision.reasoning,
              handNumber: state.handNumber,
              timestamp: Date.now(),
              communityCards: [...state.communityCards],
              holeCards: [...(player.holeCards.length > 0 ? player.holeCards : (state.players.find(p => p.id === player.id)?.holeCards ?? []))],
            }
            set((s) => {
              s.claudeThinking = false
              s.latestReasoning[player.id] = entry
              s.reasoningLog.push(entry)
            })
            // Guard: state may have changed (new hand, quit) while Claude was thinking
            const current = get()
            if (current.phase !== 'showdown' && current.phase !== 'ended' && current.phase !== 'waiting') {
              get().playerAction(decision.action, decision.amount)
            }
          })
          .catch((err) => {
            // Fallback to rule-based AI on error
            console.warn('[Claude] API error, falling back to rule-based AI:', err)
            set((s) => { s.claudeThinking = false })
            const fallback = decideAction(state, player, state.aiDifficulty)
            get().playerAction(fallback.action, fallback.amount)
          })
      } else {
        // ── Rule-based path (sync) ─────────────────────────────────────────
        const { action, amount } = decideAction(state, player, state.aiDifficulty)
        get().playerAction(action, amount)
      }
    },

    setAiDifficulty(difficulty) {
      set((s) => { s.aiDifficulty = difficulty })
    },

    setClaudeEnabled(enabled) {
      set((s) => { s.claudeEnabled = enabled })
    },

    clearReasoning() {
      set((s) => {
        s.latestReasoning = {}
        s.reasoningLog = []
      })
    },

    quitGame() {
      set((s) => { s.phase = 'ended' })
    },
  })),
)

// ──────────────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────────────

function scheduleAiIfNeeded(get: () => GameStore) {
  const state = get()
  const idx = state.activePlayerIndex
  if (idx === -1) return
  const player = state.players[idx]
  if (player && !player.isHuman && !player.isFolded && !player.isAllIn) {
    // Longer delay when Claude is enabled to give a "thinking" feel
    const delay = state.claudeEnabled ? 200 : 600 + Math.random() * 600
    setTimeout(() => get().runAiTurn(), delay)
  }
}

const RUNOUT_INTERVAL_MS = 1500

function scheduleRunout(get: () => GameStore) {
  setTimeout(() => get().advanceRunout(), RUNOUT_INTERVAL_MS)
}

function persistHandRecord(
  state: GameState,
  holeCards: Card[],  // captured before applyAction (fold clears them on the player object)
  vpip: boolean,
  pfr: boolean,
  chipsAtHandStart: number,
) {
  const human = state.players.find((p) => p.isHuman)
  if (!human || holeCards.length !== 2) return

  // Net chips: chips after showdown (pot already awarded) minus chips before this hand started.
  // This is the most reliable calculation as it does not depend on pot/winners accounting.
  const net = human.chips - chipsAtHandStart

  // Hand rank — only evaluate when human reached a genuine showdown:
  //   1. communityCards must be 5 (river was dealt)
  //   2. human must not have folded (isFolded check on final state)
  //   3. pot must have been contested (isUncontested means everyone else folded)
  const wasShowdown =
    state.communityCards.length === 5 &&
    !human.isFolded &&
    !state.winners.some((w) => w.isUncontested)
  let handRank = null
  if (wasShowdown) {
    try {
      const result = evaluateHand(holeCards as [Card, Card], state.communityCards)
      handRank = result.rank
    } catch {
      // evaluation failed — leave handRank as null
    }
  }

  saveHand({
    handNumber: state.handNumber,
    timestamp:  Date.now(),
    holeCards:  holeCards as [Card, Card],
    handRank,
    netChips:   net,
    vpip,
    pfr,
  }).catch(console.warn)
}
