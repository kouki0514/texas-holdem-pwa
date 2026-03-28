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
      set((s) => {
        Object.assign(s, startHand(s as GameState))
        s._vpipThisHand = false
        s._pfrThisHand = false
      })
      scheduleAiIfNeeded(get)
    },

    playerAction(action, amount) {
      set((s) => {
        const prevPhase = (s as GameState).phase
        const state = s as GameState

        // Capture human's holeCards BEFORE applyAction (fold clears them)
        const humanBefore = state.players.find((p) => p.isHuman)
        const humanHoleCards = humanBefore ? [...humanBefore.holeCards] as typeof humanBefore.holeCards : []

        let next: GameState = applyAction(state, action, amount)

        // VPIP: human voluntarily put chips in preflop (call/raise/all-in, not BB post)
        // PFR:  human raised preflop
        // Only track when the ACTIVE player is the human (not AI actions routed through playerAction)
        const activePlayer = state.players[state.activePlayerIndex]
        if (activePlayer?.isHuman && prevPhase === 'preflop') {
          if (!s._vpipThisHand && (action === 'call' || action === 'raise' || action === 'all-in')) {
            s._vpipThisHand = true
          }
          if (!s._pfrThisHand && (action === 'raise' || action === 'all-in')) {
            s._pfrThisHand = true
          }
        }

        if (isHandOver(next)) {
          next = resolveShowdown(next)
        } else if (isStreetOver(next)) {
          next = advanceToNextStreet(next)
        }

        // Record hand stats when showdown is reached
        if (next.phase === 'showdown') {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (s._vpipThisHand) s.sessionStats.vpipHands += 1
          persistHandRecord(next, humanHoleCards, s._vpipThisHand, s._pfrThisHand)
        }

        Object.assign(s, next)
      })

      // If everyone is all-in after advancing, run out the board with delays
      const afterAction = get()
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
      set((s) => {
        const state = s as GameState
        if (state.phase === 'showdown' || state.phase === 'waiting') return
        // advanceToNextStreet handles river→showdown via resolveShowdown internally
        const humanBefore = state.players.find((p) => p.isHuman)
        const humanHoleCards = humanBefore ? [...humanBefore.holeCards] as typeof humanBefore.holeCards : []
        const next = advanceToNextStreet(state)

        // Record hand stats when runout reaches showdown
        if (next.phase === 'showdown') {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (s._vpipThisHand) s.sessionStats.vpipHands += 1
          persistHandRecord(next, humanHoleCards, s._vpipThisHand, s._pfrThisHand)
        }

        Object.assign(s, next)
      })

      const afterAdvance = get()
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
) {
  const human = state.players.find((p) => p.isHuman)
  if (!human || holeCards.length !== 2) return

  // Net chips: sum of pots won minus total invested
  let net = -human.totalBetThisHand
  for (const w of state.winners) {
    if (w.winners.includes(human.id)) {
      net += Math.floor(w.amount / w.winners.length)
    }
  }

  // Hand rank — only available if human reached showdown (not folded)
  let handRank = null
  try {
    const result = evaluateHand(holeCards as [Card, Card], state.communityCards)
    handRank = result.rank
  } catch {
    // communityCards may be empty (folded preflop) — rank unavailable
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
