import { useEffect, useState } from 'react'
import { loadAllHands, clearAllHands, type HandRecord } from '@/store/statsDb'
import { useGameStore } from '@/store/gameStore'

interface Props {
  onClose: () => void
}

// ── Cumulative P&L line chart (SVG) ──────────────────────────────────────────
function PnLChart({ hands }: { hands: HandRecord[] }) {
  if (hands.length === 0) return (
    <div className="flex items-center justify-center h-28 text-white/30 text-sm">データなし</div>
  )

  const W = 400, H = 100, PAD = { t: 8, b: 20, l: 40, r: 8 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b

  const cumulative: number[] = []
  let running = 0
  for (const h of hands) { running += h.netChips; cumulative.push(running) }

  const yMin = Math.min(0, ...cumulative)
  const yMax = Math.max(0, ...cumulative)
  const yRange = yMax - yMin || 1

  const xScale = (i: number) => PAD.l + (i / Math.max(cumulative.length - 1, 1)) * iW
  const yScale = (v: number) => PAD.t + (1 - (v - yMin) / yRange) * iH
  const y0 = yScale(0)

  const points = cumulative.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ')
  const areaPoints = [
    `${xScale(0)},${y0}`,
    ...cumulative.map((v, i) => `${xScale(i)},${yScale(v)}`),
    `${xScale(cumulative.length - 1)},${y0}`,
  ].join(' ')

  const last = cumulative[cumulative.length - 1]
  const lineColor = last >= 0 ? '#4ade80' : '#f87171'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 100 }}>
      <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      <polygon points={areaPoints} fill={lineColor} opacity="0.12" />
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
      {[yMin, 0, yMax].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <text key={v} x={PAD.l - 4} y={yScale(v) + 4} textAnchor="end"
          fontSize="8" fill="rgba(255,255,255,0.4)">
          {v >= 0 ? `+${v}` : v}
        </text>
      ))}
      <text x={PAD.l} y={H - 4} fontSize="8" fill="rgba(255,255,255,0.4)">{hands[0].handNumber}</text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.4)">
        {hands[hands.length - 1].handNumber}
      </text>
    </svg>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: string
  sub?: string
  color?: string
}

function StatCard({ label, value, sub, color }: StatCardProps) {
  return (
    <div className="bg-black/30 rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[9px] text-white/40 uppercase tracking-wider leading-none">{label}</p>
      <p className={`text-base font-bold mt-1 ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[9px] text-white/30 font-mono">{sub}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function StatsScreen({ onClose }: Props) {
  const [hands, setHands] = useState<HandRecord[]>([])
  const [loading, setLoading] = useState(true)
  const sessionStats = useGameStore((s) => s.sessionStats)

  useEffect(() => {
    loadAllHands().then((h) => { setHands(h); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const handleClear = async () => {
    if (!confirm('全履歴を削除しますか？')) return
    await clearAllHands()
    setHands([])
  }

  // ── Derived stats from IndexedDB hands ──────────────────────────────────
  const total      = hands.length
  const won        = hands.filter((h) => h.netChips > 0).length
  const vpipCount  = hands.filter((h) => h.vpip).length
  const pfrCount   = hands.filter((h) => h.pfr).length
  const totalNet   = hands.reduce((s, h) => s + h.netChips, 0)
  const bigBlind   = 20  // default big blind; used for win rate calc

  let peak = 0, maxDd = 0, cum = 0
  for (const h of hands) {
    cum += h.netChips
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDd) maxDd = dd
  }

  const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—'
  const num = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(1) : null

  // ── 10 advanced metrics from sessionStats ────────────────────────────────
  const ss = sessionStats
  const handsPlayed = ss.handsPlayed || total || 1

  // ①Steal%
  const stealPct    = pct(ss.steals, ss.stealOpps)
  const stealSub    = ss.stealOpps > 0 ? `${ss.steals}/${ss.stealOpps}` : '機会なし'

  // ②CheckRaise%
  const crPct       = pct(ss.checkRaises, ss.checkRaiseOpps)
  const crSub       = ss.checkRaiseOpps > 0 ? `${ss.checkRaises}/${ss.checkRaiseOpps}` : '機会なし'

  // ③3bet%
  const threeBetPct = pct(ss.threeBets, ss.threeBetOpps)
  const threeBetSub = ss.threeBetOpps > 0 ? `${ss.threeBets}/${ss.threeBetOpps}` : '機会なし'

  // ④Fold-to-3bet%
  const f3bPct      = pct(ss.foldTo3bets, ss.foldTo3betOpps)
  const f3bSub      = ss.foldTo3betOpps > 0 ? `${ss.foldTo3bets}/${ss.foldTo3betOpps}` : '機会なし'

  // ⑤Cbet%
  const cbetPct     = pct(ss.cbets, ss.cbetOpps)
  const cbetSub     = ss.cbetOpps > 0 ? `${ss.cbets}/${ss.cbetOpps}` : '機会なし'

  // ⑥Fold-to-Cbet%
  const fcbPct      = pct(ss.foldToCbets, ss.foldToCbetOpps)
  const fcbSub      = ss.foldToCbetOpps > 0 ? `${ss.foldToCbets}/${ss.foldToCbetOpps}` : '機会なし'

  // ⑦WTSD%
  const wtsdPct     = pct(ss.wtsdHands, ss.sawFlopHands)
  const wtsdSub     = ss.sawFlopHands > 0 ? `${ss.wtsdHands}/${ss.sawFlopHands}` : '機会なし'

  // ⑧WSD%
  const wsdPct      = pct(ss.wsdWins, ss.wsdHands)
  const wsdSub      = ss.wsdHands > 0 ? `${ss.wsdWins}/${ss.wsdHands}` : '機会なし'

  // ⑨ROI
  const netFromSS   = ss.initialChips > 0
    ? (hands.length > 0 ? totalNet : 0)
    : totalNet
  const roiVal      = ss.totalInvested > 0
    ? `${((netFromSS / ss.totalInvested) * 100).toFixed(1)}%`
    : '—'
  const roiColor    = ss.totalInvested > 0
    ? (netFromSS >= 0 ? 'text-green-400' : 'text-red-400')
    : undefined

  // ⑩WinRate (BB/100)
  const winRateVal  = (() => {
    const v = num(totalNet / bigBlind * 100, handsPlayed)
    if (v === null) return '—'
    const n = parseFloat(v)
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`
  })()
  const winRateColor = totalNet >= 0 ? 'text-green-400' : 'text-red-400'

  const advancedMetrics: StatCardProps[] = [
    { label: '①Steal %', value: stealPct, sub: stealSub },
    { label: '②Check-Raise %', value: crPct, sub: crSub },
    { label: '③3-Bet %', value: threeBetPct, sub: threeBetSub },
    { label: '④Fold to 3-Bet %', value: f3bPct, sub: f3bSub },
    { label: '⑤C-Bet %', value: cbetPct, sub: cbetSub },
    { label: '⑥Fold to C-Bet %', value: fcbPct, sub: fcbSub },
    { label: '⑦WTSD %', value: wtsdPct, sub: wtsdSub },
    { label: '⑧WSD (Win at SD) %', value: wsdPct, sub: wsdSub },
    { label: '⑨ROI', value: roiVal, sub: ss.totalInvested > 0 ? `投資 ${ss.totalInvested}` : undefined, color: roiColor },
    { label: '⑩Win Rate (BB/100)', value: winRateVal, sub: `${handsPlayed}ハンド`, color: winRateColor },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-4 px-3">
      <div className="bg-felt-dark border border-white/20 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col gap-4 p-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">統計</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>

        {loading ? (
          <p className="text-white/40 text-center py-8">読み込み中…</p>
        ) : (
          <>
            {/* Cumulative P&L chart */}
            <div className="bg-black/30 rounded-xl p-3">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">累積損益</p>
              <PnLChart hands={hands} />
            </div>

            {/* Base summary stats */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[
                { label: '総ハンド数', value: `${total}` },
                { label: '累積損益', value: `${totalNet >= 0 ? '+' : ''}${totalNet}`, color: totalNet >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: '勝率', value: pct(won, total) },
                { label: 'VPIP', value: pct(vpipCount, total) },
                { label: 'PFR', value: pct(pfrCount, total) },
                { label: '最大DD', value: maxDd > 0 ? `-${maxDd}` : '0', color: 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-black/30 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-white/40 uppercase tracking-wider">{label}</p>
                  <p className={`text-sm font-bold mt-0.5 ${color ?? 'text-white'}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* 10 advanced metrics — 2-column card grid */}
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">アドバンスト指標（このセッション）</p>
              <div className="grid grid-cols-2 gap-2">
                {advancedMetrics.map((m) => (
                  <StatCard key={m.label} {...m} />
                ))}
              </div>
            </div>

            {/* Clear button */}
            <button
              onClick={handleClear}
              className="self-end text-xs text-white/30 hover:text-red-400 transition-colors"
            >
              履歴を全削除
            </button>
          </>
        )}
      </div>
    </div>
  )
}
