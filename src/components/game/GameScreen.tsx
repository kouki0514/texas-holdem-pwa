import { useEffect, useState } from 'react'
import { useGame } from '@/hooks/useGame'
import { useGameStore } from '@/store/gameStore'
import { PlayerSeat } from './PlayerSeat'
import { GameBoard } from './GameBoard'
import { ActionBar } from './ActionBar'
import { ShowdownResult } from './ShowdownResult'
import { ClaudeReasoningPanel } from './ClaudeReasoningPanel'
import { ClaudeToggle } from '@/components/ui/ClaudeToggle'
import { StatsScreen } from '@/components/stats/StatsScreen'
import { useSoundEffects } from '@/hooks/useSoundEffects'

export function GameScreen() {
  const { phase, communityCards, players, pots, humanPlayer, startNewHand } = useGame()
  const currentBet = useGameStore((s) => s.currentBet)
  const dealerIndex    = useGameStore((s) => s.dealerIndex)
  const winners        = useGameStore((s) => s.winners)
  const claudeThinking = useGameStore((s) => s.claudeThinking)
  const actionHistory  = useGameStore((s) => s.actionHistory)
  const actedThisStreet = useGameStore((s) => s.actedThisStreet)
  const quitGame       = useGameStore((s) => s.quitGame)

  const actedSet = new Set(actedThisStreet)
  const lastActionMap = actionHistory.reduce<Record<string, import('@/game/types').ActionType>>(
    (acc, a) => { acc[a.playerId] = a.action; return acc },
    {},
  )
  for (const id of Object.keys(lastActionMap)) {
    if (!actedSet.has(id)) delete lastActionMap[id]
  }

  useSoundEffects()

  const initialStackMap  = useGameStore((s) => s.initialStackMap)
  const addOnChips       = useGameStore((s) => s.addOnChips)

  const [showResult, setShowResult] = useState(false)
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const [showAddOn, setShowAddOn] = useState(false)
  const [addOnSelected, setAddOnSelected] = useState<Set<string>>(new Set())
  useEffect(() => { if (phase === 'showdown') setShowResult(true) }, [phase])

  // Players eligible for add-on: below initial stack at showdown
  const addOnEligible = phase === 'showdown'
    ? players.filter((p) => {
        const initial = initialStackMap[p.id] ?? 0
        return initial > 0 && p.chips < initial
      })
    : []

  const handleOpenAddOn = () => {
    setAddOnSelected(new Set(addOnEligible.map((p) => p.id)))
    setShowAddOn(true)
  }

  const handleConfirmAddOn = () => {
    addOnChips([...addOnSelected])
    setShowAddOn(false)
  }

  const handleNextHand = () => { setShowResult(false); startNewHand() }
  const handleQuit = () => setShowQuitConfirm(true)

  const opponents = players.filter((p) => !p.isHuman)
  const human     = humanPlayer ?? players[0]

  // ── Oval table layout ────────────────────────────────────────────────────────
  // The arena div is 600×420px (capped by screen). All seats are absolute inside it.
  // Center of the arena is cx=300, cy=210.
  // Seats sit on an ellipse with rx=240, ry=160 — large enough to clear the table edge.
  // Player is fixed at 6 o'clock (90° in standard math = bottom, i.e. angle=90°).
  // AIs fill remaining positions clockwise starting from 7 o'clock.
  //
  // Convention: angle 0° = right (3 o'clock), increases clockwise.
  //   top  = cy + ry * sin(angle)
  //   left = cx + rx * cos(angle)
  const ARENA_W = 720
  const ARENA_H = 520
  const cx = ARENA_W / 2   // 360
  const cy = ARENA_H / 2   // 260
  // Seat orbit ellipse — intentionally larger than the table oval so seats never overlap the board
  const rx = 300
  const ry = 200
  // Table oval fixed size (independent of rx/ry)
  const TABLE_W = 360
  const TABLE_H = 230

  const totalSeats = players.length  // human + AIs
  const stepDeg = 360 / totalSeats   // e.g. 120° for 3 players

  // Human is at 90° (bottom center / 6 o'clock in CSS coords where y increases downward)
  const humanAngleDeg = 90

  // AI seats: clockwise from human+step (7 o'clock direction → 8 o'clock → …)
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const seatPos = (angleDeg: number) => ({
    left: cx + rx * Math.cos(toRad(angleDeg)),
    top:  cy + ry * Math.sin(toRad(angleDeg)),
  })

  const humanPos = seatPos(humanAngleDeg)
  const aiSeatPositions = opponents.map((_, i) => {
    const angleDeg = humanAngleDeg + stepDeg * (i + 1)
    return seatPos(angleDeg)
  })

  return (
    <div className="flex flex-col w-screen h-screen bg-felt-dark overflow-hidden select-none">

      {/* 1. Top bar — z-40 so it stays above Showdown (z-30) */}
      <header className="relative z-40 shrink-0 flex items-center justify-between
                         px-3 py-1.5 bg-black/40 border-b border-white/10">
        <span className="text-[11px] text-white/40 font-mono uppercase tracking-widest">
          {phase}
        </span>
        {claudeThinking && (
          <span className="text-[11px] text-purple-400 animate-pulse">Claude 思考中…</span>
        )}
        <div className="flex items-center gap-2">
          <ClaudeToggle />
          {/* 履歴ボタン */}
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className={`text-[11px] font-mono uppercase tracking-widest transition-colors px-2 py-0.5 rounded border ${
              showReasoning
                ? 'text-purple-300 border-purple-400/60 bg-purple-900/30'
                : 'text-white/40 border-white/20 hover:text-white'
            }`}
          >
            履歴
          </button>
          <button
            onClick={() => setShowStats(true)}
            className="text-[11px] text-white/40 hover:text-white transition-colors font-mono uppercase tracking-widest"
          >
            統計
          </button>
          <button
            onClick={handleQuit}
            className="text-[11px] text-white/40 hover:text-red-400 transition-colors font-mono uppercase tracking-widest"
          >
            退出
          </button>
        </div>
      </header>

      {/* 2. Table arena — all seats + table oval in one relative container */}
      <section className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <div
          className="relative shrink-0"
          style={{ width: ARENA_W, height: ARENA_H }}
        >
          {/* Table oval centered in the arena */}
          <div
            className="absolute bg-felt rounded-[50%] border-4 border-felt-light/30 shadow-2xl
                        flex items-center justify-center"
            style={{
              left:   cx - TABLE_W / 2,
              top:    cy - TABLE_H / 2,
              width:  TABLE_W,
              height: TABLE_H,
            }}
          >
            <GameBoard phase={phase} communityCards={communityCards} pots={pots} currentBet={currentBet} />
          </div>

          {/* AI seats */}
          {opponents.map((p, i) => {
            const pos = aiSeatPositions[i]
            return (
              <div
                key={p.id}
                className="absolute"
                style={{ left: pos.left, top: pos.top, transform: 'translate(-50%, -50%)' }}
              >
                <PlayerSeat
                  player={p}
                  isDealer={players.indexOf(p) === dealerIndex}
                  size="sm"
                  lastAction={lastActionMap[p.id]}
                />
              </div>
            )
          })}

          {/* Human seat — 6 o'clock */}
          {human && (
            <div
              className="absolute"
              style={{ left: humanPos.left, top: humanPos.top, transform: 'translate(-50%, -50%)' }}
            >
              <PlayerSeat
                player={human}
                isDealer={players.indexOf(human) === dealerIndex}
                size="sm"
                lastAction={lastActionMap[human.id]}
              />
            </div>
          )}
        </div>
      </section>

      {/* 5. Action bar */}
      <section className="shrink-0 px-3 pb-1">
        <ActionBar />
      </section>

      {/* 履歴サイドパネル (fixed, 右側, メインに影響なし) */}
      {showReasoning && (
        <div className="fixed top-12 right-0 bottom-0 w-[420px] bg-black/85 backdrop-blur-sm border-l border-white/10 flex flex-col z-35">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
            <span className="text-[11px] text-purple-300 font-mono uppercase tracking-widest">履歴</span>
            <button
              onClick={() => setShowReasoning(false)}
              className="text-white/40 hover:text-white text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ClaudeReasoningPanel />
          </div>
        </div>
      )}

      {/* Showdown overlay */}
      {showResult && phase === 'showdown' && winners.length > 0 && (
        <ShowdownResult
          players={players}
          winners={winners}
          communityCards={communityCards}
          onNextHand={handleNextHand}
          onClose={() => setShowResult(false)}
        />
      )}

      {/* Next hand floating button — shown when Showdown is closed but phase is still showdown */}
      {phase === 'showdown' && !showResult && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
          {addOnEligible.length > 0 && (
            <button
              onClick={handleOpenAddOn}
              className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full shadow-xl text-sm transition-colors"
            >
              アドオン
            </button>
          )}
          <button
            onClick={handleNextHand}
            className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-full shadow-2xl text-sm transition-colors"
          >
            次のハンド →
          </button>
        </div>
      )}

      {/* Add-on modal */}
      {showAddOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-felt-dark border border-white/20 rounded-2xl p-6 w-80 flex flex-col gap-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white text-center">アドオン</h2>
            <p className="text-xs text-white/50 text-center">初期スタックまでチップを補填します</p>
            <div className="flex flex-col gap-2">
              {addOnEligible.map((p) => {
                const initial = initialStackMap[p.id] ?? 0
                const shortfall = initial - p.chips
                const checked = addOnSelected.has(p.id)
                return (
                  <label key={p.id} className="flex items-center justify-between gap-3 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-white/5">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setAddOnSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(p.id)) next.delete(p.id)
                            else next.add(p.id)
                            return next
                          })
                        }}
                        className="w-4 h-4 accent-green-500"
                      />
                      <span className={`text-sm font-semibold ${p.isHuman ? 'text-green-300' : 'text-white'}`}>
                        {p.name}
                      </span>
                    </div>
                    <span className="text-xs text-white/60 font-mono">
                      {p.chips} → {initial} <span className="text-green-400">+{shortfall}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAddOn(false)}
                className="flex-1 py-2 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 text-sm transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmAddOn}
                disabled={addOnSelected.size === 0}
                className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
              >
                アドオン実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats overlay */}
      {showStats && <StatsScreen onClose={() => setShowStats(false)} />}

      {/* Quit confirm */}
      {showQuitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-felt-dark border border-white/20 rounded-2xl p-6 w-72 flex flex-col gap-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white text-center">ゲームを退出しますか？</h2>
            <p className="text-sm text-white/60 text-center">現在のハンドを中断してリザルト画面に移動します。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="flex-1 py-2 rounded-lg border border-white/20 text-white/70 hover:bg-white/10 text-sm transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={quitGame}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
              >
                退出する
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
