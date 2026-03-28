import { useGameStore, type SessionStats } from '@/store/gameStore'
import { Button } from '@/components/ui/Button'

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/10 last:border-0">
      <span className="text-white/60 text-sm">{label}</span>
      <span className={`font-bold text-sm ${highlight ? 'text-yellow-300' : 'text-white'}`}>
        {value}
      </span>
    </div>
  )
}

export function ResultScreen() {
  const { sessionStats, players, initGame } = useGameStore((s) => ({
    sessionStats: s.sessionStats,
    players: s.players,
    initGame: s.initGame,
  }))

  const human = players.find((p) => p.isHuman)
  const finalChips = human?.chips ?? 0
  const { initialChips, handsPlayed, handsWon, vpipHands }: SessionStats = sessionStats

  const profit = finalChips - initialChips
  const profitSign = profit >= 0 ? '+' : ''
  const winRate = handsPlayed > 0 ? ((handsWon / handsPlayed) * 100).toFixed(1) : '—'
  const vpip = handsPlayed > 0 ? ((vpipHands / handsPlayed) * 100).toFixed(1) : '—'

  const handlePlayAgain = () => {
    // Reset to waiting phase → App will show LobbyScreen
    initGame([])
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-felt-dark gap-6 px-4">
      <h1 className="text-3xl font-bold text-white">セッション終了</h1>

      <div className="bg-black/40 border border-white/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-1">
        <StatRow label="プレイしたハンド数" value={`${handsPlayed} ハンド`} />
        <StatRow label="初期チップ" value={`${initialChips.toLocaleString()} ¢`} />
        <StatRow label="最終チップ" value={`${finalChips.toLocaleString()} ¢`} highlight />
        <StatRow
          label="損益"
          value={`${profitSign}${profit.toLocaleString()} ¢`}
          highlight
        />
        <StatRow label="勝率" value={handsPlayed > 0 ? `${winRate}%` : '—'} />
        <StatRow label="VPIP" value={handsPlayed > 0 ? `${vpip}%` : '—'} />
      </div>

      {/* Profit indicator */}
      <div
        className={`text-4xl font-extrabold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}
      >
        {profitSign}{profit.toLocaleString()} ¢
      </div>

      <Button size="lg" onClick={handlePlayAgain}>
        もう一度プレイ
      </Button>
    </div>
  )
}
