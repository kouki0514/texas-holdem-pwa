function chipColors(amount: number): { fill: string; stroke: string; text: string; dashes: string } {
  if (amount <= 10)  return { fill: '#e5e7eb', stroke: '#9ca3af', text: '#374151', dashes: '#9ca3af' } // 白
  if (amount <= 20)  return { fill: '#3b82f6', stroke: '#1d4ed8', text: '#ffffff', dashes: '#93c5fd' } // 青
  if (amount <= 100) return { fill: '#ef4444', stroke: '#b91c1c', text: '#ffffff', dashes: '#fca5a5' } // 赤
  if (amount <= 500) return { fill: '#22c55e', stroke: '#15803d', text: '#ffffff', dashes: '#86efac' } // 緑
  return { fill: '#1f2937', stroke: '#d97706', text: '#fbbf24', dashes: '#d97706' }                   // 黒(金縁)
}

interface Props {
  amount: number
  /** Render size in px (default 20) */
  size?: number
}

export function PokerChip({ amount, size = 20 }: Props) {
  const c = chipColors(amount)
  const label = amount >= 1000 ? `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k` : String(amount)
  const dashes = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * 45 * Math.PI) / 180
    const r1 = 8, r2 = 10
    const x1 = 12 + r1 * Math.cos(angle)
    const y1 = 12 + r1 * Math.sin(angle)
    const x2 = 12 + r2 * Math.cos(angle)
    const y2 = 12 + r2 * Math.sin(angle)
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.dashes} strokeWidth="2" strokeLinecap="round" />
  })
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="inline-block shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="11" fill={c.stroke} />
      <circle cx="12" cy="12" r="10" fill={c.fill} />
      {dashes}
      <circle cx="12" cy="12" r="7" fill={c.fill} stroke={c.stroke} strokeWidth="1" />
      <text
        x="12" y="12"
        textAnchor="middle" dominantBaseline="central"
        fontSize={label.length >= 3 ? '4' : '5'}
        fontWeight="bold"
        fill={c.text}
        fontFamily="monospace"
      >
        {label}
      </text>
    </svg>
  )
}
