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
import { saveHand, loadLifetimeStats, saveLifetimeStats, clearLifetimeStats } from './statsDb'
export type { SessionStats } from './statsDb'
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
  action: ActionType | 'bet'
  amount?: number
  reasoning: string
  handNumber: number
  timestamp: number
  phase: string
  position: string | null
  pot: number
}

// SessionStats is defined in statsDb.ts and re-exported above via `export type { SessionStats }`
import type { SessionStats } from './statsDb'

// ──────────────────────────────────────────────────────────────────────────────
// Store interface
// ──────────────────────────────────────────────────────────────────────────────

interface GameStore extends GameState {
  aiDifficulty: AiDifficulty
  /** Enable Claude API for all AI players */
  claudeEnabled: boolean
  preflopClaude: boolean
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
  /** Net chip change per hand for the human player: handNumber → netChips */
  handNetChipsMap: Record<number, number>
  // ── Per-hand advanced stat flags ─────────────────────────────────────────────
  /** Human was the preflop raiser (PFR) this hand */
  _humanPfr: boolean
  /** Human checked at least once this street (reset on street change) */
  _humanCheckedThisStreet: boolean
  /** Human has already been counted for CheckRaise opp this street */
  _checkRaiseOppRecorded: boolean
  /** Human saw the flop (called/raised preflop or was BB that wasn't raised) */
  _humanSawFlop: boolean
  /** Opponent c-bet the flop (first bet on flop by a non-human who was PFR) */
  _opponentCbetFlop: boolean
  /** Human has already responded to opponent c-bet this hand (avoid double count) */
  _humanActedVsCbet: boolean
  /** Human faced a 3-bet after opening this hand */
  _humanFaced3bet: boolean
  /** Human's open has already triggered a 3bet-opp count this hand */
  _threeBetOppRecorded: boolean
  /** Steal opportunity already counted this hand */
  _stealOppRecorded: boolean
  /** Initial chip count per player (set once at game start): playerId → chips */
  initialStackMap: Record<string, number>
  /** UI / reasoning language */
  language: 'ja' | 'en'

  initGame: (players: Player[]) => void
  startNewHand: () => void
  playerAction: (action: ActionType, amount?: number) => void
  runAiTurn: () => void
  advanceRunout: () => void
  setAiDifficulty: (difficulty: AiDifficulty) => void
  setClaudeEnabled: (enabled: boolean) => void
  setPreflopClaude: (enabled: boolean) => void
  clearReasoning: () => void
  quitGame: () => void
  addOnChips: (playerIds: string[]) => void
  setLanguage: (lang: 'ja' | 'en') => void
  resetLifetimeStats: () => void
}

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...createInitialState([]),
    aiDifficulty: 'medium',
    claudeEnabled: true,
    preflopClaude: false,
    claudeThinking: false,
    latestReasoning: {},
    reasoningLog: [],
    sessionStats: {
      initialChips: 0, handsPlayed: 0, handsWon: 0, vpipHands: 0,
      stealOpps: 0, steals: 0,
      checkRaiseOpps: 0, checkRaises: 0,
      threeBetOpps: 0, threeBets: 0,
      foldTo3betOpps: 0, foldTo3bets: 0,
      cbetOpps: 0, cbets: 0,
      foldToCbetOpps: 0, foldToCbets: 0,
      sawFlopHands: 0, wtsdHands: 0,
      wsdHands: 0, wsdWins: 0,
      totalInvested: 0,
    },
    _vpipThisHand: false,
    _pfrThisHand: false,
    _chipsAtHandStart: 0,
    _handPersisted: false,
    handNetChipsMap: {},
    initialStackMap: {},
    language: 'ja' as const,
    _humanPfr: false,
    _humanCheckedThisStreet: false,
    _checkRaiseOppRecorded: false,
    _humanSawFlop: false,
    _opponentCbetFlop: false,
    _humanActedVsCbet: false,
    _humanFaced3bet: false,
    _threeBetOppRecorded: false,
    _stealOppRecorded: false,

    initGame(players) {
      const human = players.find((p) => p.isHuman)
      const stackMap: Record<string, number> = {}
      for (const p of players) stackMap[p.id] = p.chips
      set((s) => {
        Object.assign(s, createInitialState(players))
        s.latestReasoning = {}
        s.reasoningLog = []
        // Load lifetime cumulative stats and carry them forward into this session
        const lifetime = loadLifetimeStats()
        s.sessionStats = {
          ...lifetime,
          initialChips: human?.chips ?? 1000,
        }
        s._vpipThisHand = false
        s._humanPfr = false
        s._humanCheckedThisStreet = false
        s._checkRaiseOppRecorded = false
        s._humanSawFlop = false
        s._opponentCbetFlop = false
        s._humanActedVsCbet = false
        s._humanFaced3bet = false
        s._threeBetOppRecorded = false
        s._stealOppRecorded = false
        s.handNetChipsMap = {}
        s.initialStackMap = stackMap
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
        s._humanPfr = false
        s._humanCheckedThisStreet = false
        s._checkRaiseOppRecorded = false
        s._humanSawFlop = false
        s._opponentCbetFlop = false
        s._humanActedVsCbet = false
        s._humanFaced3bet = false
        s._threeBetOppRecorded = false
        s._stealOppRecorded = false
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

      // ── Advanced stat computation (pre-Immer snapshot) ──────────────────────
      // All flags read from stateSnapshot so they are stable across the set() calls.
      const isHumanActor = activePlayer?.isHuman === true
      const phase = stateSnapshot.phase
      const humanIdx = stateSnapshot.players.findIndex((p) => p.isHuman)
      const humanPosition = humanIdx >= 0
        ? calcPosition(humanIdx, stateSnapshot.players.length, stateSnapshot.dealerIndex)
        : null
      const isStealPosition = humanPosition === 'BTN' || humanPosition === 'CO' ||
        humanPosition === 'SB' || humanPosition === 'BTN/SB'

      // ①Steal: BTN/CO/SB open raise (no prior raises in actionHistory)
      const advSteal = (() => {
        if (!isHumanActor || phase !== 'preflop') return null
        if (stateSnapshot._stealOppRecorded) return null
        if (!isStealPosition) return null
        // Check no prior raise in this preflop (only blinds posted)
        const priorRaises = stateSnapshot.actionHistory.filter(
          (a) => a.action === 'raise' || a.action === 'all-in'
        )
        if (priorRaises.length > 0) return null
        // It's a steal opportunity
        const didSteal = action === 'raise' || action === 'all-in'
        return { opp: true, did: didSteal }
      })()

      // ③3bet opportunity: human faces an open raise (first raiser), human is not BB defending
      const advThreeBet = (() => {
        if (!isHumanActor || phase !== 'preflop') return null
        if (stateSnapshot._threeBetOppRecorded) return null
        // There must be exactly one raise in actionHistory (the open) and human hasn't raised yet
        const raises = stateSnapshot.actionHistory.filter(
          (a) => a.action === 'raise' || a.action === 'all-in'
        )
        if (raises.length !== 1) return null
        if (raises[0].playerId === activePlayer?.id) return null // human's own raise
        const did3bet = action === 'raise' || action === 'all-in'
        return { opp: true, did: did3bet }
      })()

      // ④Fold-to-3bet: human was opener and now faces a 3-bet (2nd raise in preflop)
      const advFoldTo3bet = (() => {
        if (!isHumanActor || phase !== 'preflop') return null
        if (!stateSnapshot._humanPfr) return null
        if (stateSnapshot._humanFaced3bet) return null
        // Check there are 2 raises, and the latest is not by human
        const raises = stateSnapshot.actionHistory.filter(
          (a) => a.action === 'raise' || a.action === 'all-in'
        )
        if (raises.length < 2) return null
        const lastRaiser = raises[raises.length - 1]
        if (lastRaiser.playerId === activePlayer?.id) return null
        return { opp: true, did: action === 'fold' }
      })()

      // ②CheckRaise: human previously checked this street and now faces a bet
      const advCheckRaise = (() => {
        if (!isHumanActor || phase === 'preflop') return null
        if (!stateSnapshot._humanCheckedThisStreet) return null
        if (stateSnapshot._checkRaiseOppRecorded) return null
        // There must be a bet on the table (toCall > 0)
        const toCallNow = Math.max(0, stateSnapshot.currentBet - (activePlayer?.currentBet ?? 0))
        if (toCallNow === 0) return null
        const didCheckRaise = action === 'raise' || action === 'all-in'
        return { opp: true, did: didCheckRaise }
      })()

      // ⑤Cbet: human was PFR, flop, first to act (no prior bets this street)
      const advCbet = (() => {
        if (!isHumanActor || phase !== 'flop') return null
        if (!stateSnapshot._humanPfr) return null
        // No bets this street yet: currentBet === 0 or equals BB (preflop residual cleared on new street)
        const toCallNow = Math.max(0, stateSnapshot.currentBet - (activePlayer?.currentBet ?? 0))
        if (toCallNow > 0) return null // someone already bet
        // Check actionHistory has no bets this street
        const flopBets = stateSnapshot.actionHistory.filter(
          (a) => a.action === 'raise' || a.action === 'all-in'
        )
        if (flopBets.length > 0) return null
        const didCbet = action === 'raise' || action === 'all-in'
        return { opp: true, did: didCbet }
      })()

      // ⑥Fold-to-Cbet: opponent c-bet (detected via _opponentCbetFlop), human must respond
      const advFoldToCbet = (() => {
        if (!isHumanActor || phase !== 'flop') return null
        if (!stateSnapshot._opponentCbetFlop) return null
        if (stateSnapshot._humanActedVsCbet) return null
        return { opp: true, did: action === 'fold' }
      })()

      // Detect opponent c-bet: non-human actor raises/bets on flop when human was NOT PFR
      // (We track this for future human actions in the same street)
      const isOpponentCbet = !isHumanActor && phase === 'flop' &&
        !stateSnapshot._humanPfr &&
        !stateSnapshot._opponentCbetFlop &&
        (action === 'raise' || action === 'all-in')

      // PFR update: if human raises preflop, set _humanPfr
      const humanPfrNow = stateSnapshot._humanPfr ||
        (isHumanActor && phase === 'preflop' && (action === 'raise' || action === 'all-in'))

      // Track human check (for CheckRaise detection)
      const humanCheckedNow = stateSnapshot._humanCheckedThisStreet ||
        (isHumanActor && phase !== 'preflop' && action === 'check')

      // Saw-flop tracking: if this action transitions to flop, mark human as having seen flop
      // (captured in advanceRunout / street transition — we detect it by phase after applyAction)
      // We'll handle sawFlop in the set() block by checking next.phase

      // Record human action into reasoningLog so it appears in the history timeline
      if (activePlayer?.isHuman) {
        const humanEntry: ReasoningEntry = {
          ...buildReasoningEntry(stateSnapshot as import('@/game/types').GameState, activePlayer, action, amount, ''),
          holeCards: humanHoleCards,
        }
        set((s) => {
          s.latestReasoning[activePlayer.id] = humanEntry
          s.reasoningLog.push(humanEntry)
        })
      }

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

        // ── Advanced stat flags update ───────────────────────────────────────
        if (humanPfrNow) s._humanPfr = true
        if (humanCheckedNow) s._humanCheckedThisStreet = true
        if (isOpponentCbet) s._opponentCbetFlop = true

        // Reset per-street flags when street advances
        const prevPhase = stateSnapshot.phase
        if (next.phase !== prevPhase && next.phase !== 'showdown') {
          s._humanCheckedThisStreet = false
          s._checkRaiseOppRecorded = false
        }

        // ①Steal
        if (advSteal) {
          s.sessionStats.stealOpps += 1
          if (advSteal.did) s.sessionStats.steals += 1
          s._stealOppRecorded = true
        }
        // ③3bet
        if (advThreeBet) {
          s.sessionStats.threeBetOpps += 1
          if (advThreeBet.did) s.sessionStats.threeBets += 1
          s._threeBetOppRecorded = true
        }
        // ④Fold-to-3bet
        if (advFoldTo3bet) {
          s.sessionStats.foldTo3betOpps += 1
          if (advFoldTo3bet.did) s.sessionStats.foldTo3bets += 1
          s._humanFaced3bet = true
        }
        // ②CheckRaise
        if (advCheckRaise) {
          s.sessionStats.checkRaiseOpps += 1
          if (advCheckRaise.did) s.sessionStats.checkRaises += 1
          s._checkRaiseOppRecorded = true
        }
        // ⑤Cbet
        if (advCbet) {
          s.sessionStats.cbetOpps += 1
          if (advCbet.did) s.sessionStats.cbets += 1
        }
        // ⑥Fold-to-Cbet
        if (advFoldToCbet) {
          s.sessionStats.foldToCbetOpps += 1
          if (advFoldToCbet.did) s.sessionStats.foldToCbets += 1
          s._humanActedVsCbet = true
        }

        // Record session stats at showdown (covers all endings)
        if (next.phase === 'showdown' && !s._handPersisted) {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (vpipNow) s.sessionStats.vpipHands += 1
          // ⑦WTSD / ⑧WSD
          if (s._humanSawFlop) {
            s.sessionStats.wtsdHands += 1
          }
          if (humanPlayer && !humanPlayer.isFolded) {
            const isRealShowdown = !next.winners.some((w) => w.isUncontested)
            if (isRealShowdown) {
              s.sessionStats.wsdHands += 1
              if (humanWon) s.sessionStats.wsdWins += 1
            }
          }
          // ⑨ROI: record investment
          const invested = humanPlayer?.totalBetThisHand ?? 0
          if (invested > 0) s.sessionStats.totalInvested += invested
        }

        // When human folds mid-hand (others still playing), count it now
        if (humanIsFolding && next.phase !== 'showdown' && !s._handPersisted) {
          s.sessionStats.handsPlayed += 1
          if (vpipNow) s.sessionStats.vpipHands += 1
          const humanPlayer = next.players.find((p) => p.isHuman)
          const invested = humanPlayer?.totalBetThisHand ?? 0
          if (invested > 0) s.sessionStats.totalInvested += invested
        }

        // Track human saw flop: if previous phase was preflop and next is flop/later
        if (prevPhase === 'preflop' && next.phase !== 'preflop' && next.phase !== 'showdown') {
          const humanInNext = next.players.find((p) => p.isHuman)
          if (humanInNext && !humanInNext.isFolded) {
            s._humanSawFlop = true
            s.sessionStats.sawFlopHands += 1
          }
        }

        Object.assign(s, next)
        // Restore flags overwritten by Object.assign (next is GameState, has no these flags)
        s._vpipThisHand = vpipNow
        s._pfrThisHand = pfrNow
        s._humanPfr = humanPfrNow
        if (humanCheckedNow) s._humanCheckedThisStreet = true
        if (isOpponentCbet) s._opponentCbetFlop = true
        if (advSteal) s._stealOppRecorded = true
        if (advThreeBet) s._threeBetOppRecorded = true
        if (advFoldTo3bet) s._humanFaced3bet = true
        if (advCheckRaise) s._checkRaiseOppRecorded = true
        if (advFoldToCbet) s._humanActedVsCbet = true
      })

      // Persist hand record outside Immer draft via setTimeout to avoid Proxy serialization issues
      const afterAction = get()
      const shouldPersistNow =
        (afterAction.phase === 'showdown' || humanIsFolding) && !afterAction._handPersisted
      if (shouldPersistNow) {
        const vpip = afterAction._vpipThisHand
        const pfr = afterAction._pfrThisHand
        const chipsAtHandStart = afterAction._chipsAtHandStart
        const humanAfter = afterAction.players.find((p) => p.isHuman)
        const netChips = humanAfter != null && chipsAtHandStart > 0
          ? humanAfter.chips - chipsAtHandStart
          : 0
        // Mark persisted synchronously before setTimeout fires to prevent duplicate writes
        set((s) => {
          s._handPersisted = true
          s.handNetChipsMap[afterAction.handNumber] = netChips
        })
        // Save current sessionStats (which already carries the full cumulative total) to localStorage
        saveLifetimeStats(get().sessionStats)
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
        const prevPhase = state.phase
        const next = advanceToNextStreet(state)

        // Track saw-flop on runout street transitions
        if (prevPhase === 'preflop' && next.phase !== 'preflop' && next.phase !== 'showdown') {
          const humanInNext = next.players.find((p) => p.isHuman)
          if (humanInNext && !humanInNext.isFolded && !s._humanSawFlop) {
            s._humanSawFlop = true
            s.sessionStats.sawFlopHands += 1
          }
        }

        // Reset per-street flags when street advances
        if (next.phase !== prevPhase && next.phase !== 'showdown') {
          s._humanCheckedThisStreet = false
          s._checkRaiseOppRecorded = false
        }

        // Record session stats when runout reaches showdown (persist happens outside via setTimeout)
        if (next.phase === 'showdown') {
          const humanPlayer = next.players.find((p) => p.isHuman)
          const humanWon = next.winners.some((w) => humanPlayer && w.winners.includes(humanPlayer.id))
          s.sessionStats.handsPlayed += 1
          if (humanWon) s.sessionStats.handsWon += 1
          if (s._vpipThisHand) s.sessionStats.vpipHands += 1
          // ⑦WTSD / ⑧WSD
          if (s._humanSawFlop) {
            s.sessionStats.wtsdHands += 1
          }
          if (humanPlayer && !humanPlayer.isFolded) {
            const isRealShowdown = !next.winners.some((w) => w.isUncontested)
            if (isRealShowdown) {
              s.sessionStats.wsdHands += 1
              if (humanWon) s.sessionStats.wsdWins += 1
            }
          }
          // ⑨ROI investment
          const humanPlayer2 = next.players.find((p) => p.isHuman)
          const invested = humanPlayer2?.totalBetThisHand ?? 0
          if (invested > 0) s.sessionStats.totalInvested += invested
        }

        Object.assign(s, next)
        // Restore per-hand flags overwritten by Object.assign
        if (prevPhase === 'preflop' && next.phase !== 'preflop') {
          // keep _humanSawFlop as set above
        }
      })

      // Persist hand record outside Immer draft via setTimeout to avoid Proxy serialization issues
      const afterAdvance = get()
      if (afterAdvance.phase === 'showdown' && !afterAdvance._handPersisted) {
        const vpip = afterAdvance._vpipThisHand
        const pfr = afterAdvance._pfrThisHand
        const chipsAtHandStart = afterAdvance._chipsAtHandStart
        const humanAfter = afterAdvance.players.find((p) => p.isHuman)
        const netChips = humanAfter != null && chipsAtHandStart > 0
          ? humanAfter.chips - chipsAtHandStart
          : 0
        set((s) => {
          s._handPersisted = true
          s.handNetChipsMap[afterAdvance.handNumber] = netChips
        })
        // Save current sessionStats (which already carries the full cumulative total) to localStorage
        saveLifetimeStats(get().sessionStats)
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

      const isPreflop = state.phase === 'preflop'
    const useClaudeNow = state.claudeEnabled && (!isPreflop || state.preflopClaude)
    if (useClaudeNow) {
        // ── Claude path (async) ────────────────────────────────────────────
        set((s) => { s.claudeThinking = true })

        claudeDecideAction(state, player, state.language)
          .then((decision) => {
            const entry: ReasoningEntry = buildReasoningEntry(state, player, decision.action, decision.amount, decision.reasoning)
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
            console.warn('[Claude] error, falling back to rule-based AI:', err)
            const fallback = decideAction(state, player, state.aiDifficulty)
            const fallbackEntry: ReasoningEntry = buildReasoningEntry(state, player, fallback.action, fallback.amount, fallback.reasoning)
            set((s) => {
              s.claudeThinking = false
              s.latestReasoning[player.id] = fallbackEntry
              s.reasoningLog.push(fallbackEntry)
            })
            const current = get()
            if (current.phase !== 'showdown' && current.phase !== 'ended' && current.phase !== 'waiting') {
              get().playerAction(fallback.action, fallback.amount)
            }
          })
      } else {
        // ── Rule-based path (sync) ─────────────────────────────────────────
        const { action, amount, reasoning } = decideAction(state, player, state.aiDifficulty)
        const entry: ReasoningEntry = buildReasoningEntry(state, player, action, amount, reasoning)
        set((s) => {
          s.latestReasoning[player.id] = entry
          s.reasoningLog.push(entry)
        })
        get().playerAction(action, amount)
      }
    },

    setAiDifficulty(difficulty) {
      set((s) => { s.aiDifficulty = difficulty })
    },

    setClaudeEnabled(enabled) {
      set((s) => { s.claudeEnabled = enabled })
    },

    setPreflopClaude(enabled) {
      set((s) => { s.preflopClaude = enabled })
    },

    clearReasoning() {
      set((s) => {
        s.latestReasoning = {}
        s.reasoningLog = []
      })
    },

    setLanguage(lang) {
      set((s) => { s.language = lang })
    },

    addOnChips(playerIds) {
      const stackMap = get().initialStackMap
      set((s) => {
        for (const p of s.players) {
          if (playerIds.includes(p.id)) {
            const initial = stackMap[p.id] ?? 0
            if (initial > 0 && p.chips < initial) {
              p.chips = initial
            }
          }
        }
      })
    },

    quitGame() {
      set((s) => { s.phase = 'ended' })
    },

    resetLifetimeStats() {
      clearLifetimeStats()
      const zero = loadLifetimeStats() // returns ZERO_STATS after clear
      set((s) => {
        s.sessionStats = { ...zero, initialChips: s.sessionStats.initialChips }
      })
    },
  })),
)

// ──────────────────────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────────────────────

/** Compute position label for a player given dealer index */
export function calcPosition(playerIndex: number, numPlayers: number, dealerIndex: number): string | null {
  if (numPlayers < 2) return null
  const rel = (playerIndex - dealerIndex + numPlayers) % numPlayers
  if (numPlayers === 2) return rel === 0 ? 'BTN/SB' : 'BB'
  const posMap: Record<number, string> = { 0: 'BTN', 1: 'SB', 2: 'BB' }
  if (rel in posMap) return posMap[rel]
  if (rel === numPlayers - 1) return 'CO'
  return 'MP'
}

/** Build a ReasoningEntry for any player action */
export function buildReasoningEntry(
  state: import('@/game/types').GameState,
  player: Player,
  action: ActionType | 'bet',
  amount: number | undefined,
  reasoning: string,
): ReasoningEntry {
  const idx = state.players.findIndex((p) => p.id === player.id)
  // Normalize 'raise' → 'bet' when there is no prior bet this street
  const displayAction: ActionType | 'bet' =
    action === 'raise' && state.currentBet <= state.bigBlind ? 'bet' : action
  return {
    playerId: player.id,
    playerName: player.name,
    action: displayAction,
    amount,
    reasoning,
    handNumber: state.handNumber,
    timestamp: Date.now(),
    communityCards: state.communityCards.map((c) => ({ ...c })),
    holeCards: player.holeCards.map((c) => ({ ...c })),
    phase: state.phase,
    position: calcPosition(idx, state.players.length, state.dealerIndex),
    pot: state.pots.reduce((s, p) => s + p.amount, 0),
  }
}

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
