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

  const [showResult, setShowResult] = useState(false)
  const [showQuitConfirm, setShowQuitConfirm] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  useEffect(() => { if (phase === 'showdown') setShowResult(true) }, [phase])

  const handleNextHand = () => { setShowResult(false); startNewHand() }
  const handleQuit = () => setShowQuitConfirm(true)

  const opponents = players.filter((p) => !p.isHuman)
  const human     = humanPlayer ?? players[0]

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

      {/* 2. Opponents */}
      <section className="shrink-0 flex justify-around items-center flex-wrap
                          gap-x-2 gap-y-1 px-3 pt-2 pb-1 min-h-[80px]">
        {opponents.map((p) => (
          <PlayerSeat
            key={p.id}
            player={p}
            isDealer={players.indexOf(p) === dealerIndex}
            size="sm"
            lastAction={lastActionMap[p.id]}
          />
        ))}
      </section>

      {/* 3. Table */}
      <section className="flex-1 min-h-0 max-h-[280px] flex items-center justify-center px-3 py-2">
        <div className="w-full max-w-xl py-5 px-6
                        bg-felt rounded-[48px] border-4 border-felt-light/30
                        shadow-2xl flex items-center justify-center">
          <GameBoard phase={phase} communityCards={communityCards} pots={pots} />
        </div>
      </section>

      {/* 4. Human seat */}
      {human && (
        <section className="shrink-0 flex justify-center py-1">
          <PlayerSeat
            player={human}
            isDealer={players.indexOf(human) === dealerIndex}
            size="sm"
            lastAction={lastActionMap[human.id]}
          />
        </section>
      )}

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
          onClose={handleNextHand}
        />
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
