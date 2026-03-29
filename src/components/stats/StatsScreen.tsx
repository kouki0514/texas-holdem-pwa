import { useEffect, useState } from 'react'
import { loadAllHands, clearAllHands, type HandRecord } from '@/store/statsDb'
import type { HandRank } from '@/game/types'

const HAND_RANK_JA: Record<HandRank, string> = {
  'royal-flush':     'ロイヤルフラッシュ',
  'straight-flush':  'ストレートフラッシュ',
  'four-of-a-kind':  'フォーカード',
  'full-house':      'フルハウス',
  'flush':           'フラッシュ',
  'straight':        'ストレート',
  'three-of-a-kind': 'スリーカード',
  'two-pair':        'ツーペア',
  'one-pair':        'ワンペア',
  'high-card':       'ハイカード',
}

const SUIT_SYM: Record<string, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
}
const SUIT_COLOR: Record<string, string> = {
  spades: 'text-white', hearts: 'text-red-400', diamonds: 'text-red-400', clubs: 'text-white',
}

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

  // cumulative net
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
      {/* zero line */}
      <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {/* area fill */}
      <polygon points={areaPoints} fill={lineColor} opacity="0.12" />
      {/* line */}
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
      {/* y-axis labels */}
      {[yMin, 0, yMax].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <text key={v} x={PAD.l - 4} y={yScale(v) + 4} textAnchor="end"
          fontSize="8" fill="rgba(255,255,255,0.4)">
          {v >= 0 ? `+${v}` : v}
        </text>
      ))}
      {/* x-axis: first and last hand number */}
      <text x={PAD.l} y={H - 4} fontSize="8" fill="rgba(255,255,255,0.4)">{hands[0].handNumber}</text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="8" fill="rgba(255,255,255,0.4)">
        {hands[hands.length - 1].handNumber}
      </text>
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function StatsScreen({ onClose }: Props) {
  const [hands, setHands] = useState<HandRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAllHands().then((h) => { setHands(h); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const handleClear = async () => {
    if (!confirm('全履歴を削除しますか？')) return
    await clearAllHands()
    setHands([])
  }

  // ── Derived stats ────────────────────────────────────────────────────────
  const total      = hands.length
  const won        = hands.filter((h) => h.netChips > 0).length
  const vpipCount  = hands.filter((h) => h.vpip).length
  const pfrCount   = hands.filter((h) => h.pfr).length
  const totalNet   = hands.reduce((s, h) => s + h.netChips, 0)

  // Max drawdown: peak-to-trough on cumulative PnL
  let peak = 0, maxDd = 0, cum = 0
  for (const h of hands) {
    cum += h.netChips
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDd) maxDd = dd
  }

  const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—'

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-4 px-3">
      <div className="bg-felt-dark border border-white/20 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col gap-4 p-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">統計・履歴</h2>
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

            {/* Summary stats */}
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

            {/* Hand history table */}
            {hands.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-white/40 uppercase tracking-wider text-[9px]">
                      <th className="text-left pb-1 pr-2">#</th>
                      <th className="text-left pb-1 pr-2">ホールカード</th>
                      <th className="text-left pb-1 pr-2">役</th>
                      <th className="text-right pb-1">損益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...hands].reverse().map((h) => (
                      <tr key={h.id} className="border-t border-white/5 hover:bg-white/5">
                        <td className="py-1 pr-2 text-white/40">{h.handNumber}</td>
                        <td className="py-1 pr-2">
                          <span className="flex gap-1">
                            {h.holeCards.map((c, i) => (
                              <span key={i} className={`font-bold ${SUIT_COLOR[c.suit]}`}>
                                {c.rank}{SUIT_SYM[c.suit]}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-white/70">
                          {h.handRank ? HAND_RANK_JA[h.handRank] : '—'}
                        </td>
                        <td className={`py-1 text-right font-mono font-bold ${h.netChips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {h.netChips >= 0 ? '+' : ''}{h.netChips}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-white/30 text-center py-4 text-sm">ハンド履歴がありません</p>
            )}

            {/* Clear button */}
            {hands.length > 0 && (
              <button
                onClick={handleClear}
                className="self-end text-xs text-white/30 hover:text-red-400 transition-colors"
              >
                履歴を全削除
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
