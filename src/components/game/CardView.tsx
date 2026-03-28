import type { Card } from '@/game/types'

// ─── constants ────────────────────────────────────────────────────────────────

const SYM: Record<string, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
}
const RED = new Set(['hearts', 'diamonds'])

// ─── size config ──────────────────────────────────────────────────────────────
interface Props { card: Card; size?: 'sm' | 'md' | 'lg' }

// w, h  : card outer size
// co    : corner fontSize
// cp    : corner padding (top/left)
// pip   : pip fontSize for number cards
// acePip: pip fontSize for Ace (large centre pip)
// face  : face-card rank fontSize
const CFG = {
  sm: { w: 44,  h: 62,  co: 8,  cp: 2, pip: 8,  acePip: 18, face: 18 },
  md: { w: 60,  h: 84,  co: 10, cp: 3, pip: 11, acePip: 26, face: 24 },
  lg: { w: 84,  h: 118, co: 13, cp: 4, pip: 14, acePip: 36, face: 34 },
}

// ─── Pip absolute-position layout ────────────────────────────────────────────
// Coordinates are defined for md (60×84).
// The pip-area starts just below/above the corner labels.
// corner occupies roughly top 18px and bottom 18px → pip area ≈ 84-36 = 48px tall
// Horizontally: left col ≈ x=14, mid col ≈ x=30, right col ≈ x=46
// Vertically 6 rows for md, evenly in pip area [18..66]:
//   row0=18  row1=27  row2=36  row3=48  row4=57  row5=66
// flip=true → rotate(180deg) for lower-half pips

type Pip = { x: number; y: number; flip?: boolean }

// Coordinates relative to card top-left (md = 60×84)
const PIPS_MD: Record<string, Pip[]> = {
  A: [
    { x: 30, y: 42 },
  ],
  '2': [
    { x: 30, y: 20 },
    { x: 30, y: 64, flip: true },
  ],
  '3': [
    { x: 30, y: 20 },
    { x: 30, y: 42 },
    { x: 30, y: 64, flip: true },
  ],
  '4': [
    { x: 16, y: 22 }, { x: 44, y: 22 },
    { x: 16, y: 62, flip: true }, { x: 44, y: 62, flip: true },
  ],
  '5': [
    { x: 16, y: 22 }, { x: 44, y: 22 },
    { x: 30, y: 42 },
    { x: 16, y: 62, flip: true }, { x: 44, y: 62, flip: true },
  ],
  '6': [
    { x: 16, y: 22 }, { x: 44, y: 22 },
    { x: 16, y: 42 }, { x: 44, y: 42 },
    { x: 16, y: 62, flip: true }, { x: 44, y: 62, flip: true },
  ],
  '7': [
    { x: 16, y: 20 }, { x: 44, y: 20 },
    { x: 30, y: 31 },
    { x: 16, y: 42 }, { x: 44, y: 42 },
    { x: 16, y: 64, flip: true }, { x: 44, y: 64, flip: true },
  ],
  '8': [
    { x: 16, y: 20 }, { x: 44, y: 20 },
    { x: 30, y: 31 },
    { x: 16, y: 42 }, { x: 44, y: 42 },
    { x: 30, y: 53, flip: true },
    { x: 16, y: 64, flip: true }, { x: 44, y: 64, flip: true },
  ],
  '9': [
    { x: 16, y: 20 }, { x: 44, y: 20 },
    { x: 16, y: 31 }, { x: 44, y: 31 },
    { x: 30, y: 42 },
    { x: 16, y: 53, flip: true }, { x: 44, y: 53, flip: true },
    { x: 16, y: 64, flip: true }, { x: 44, y: 64, flip: true },
  ],
  '10': [
    { x: 16, y: 20 }, { x: 44, y: 20 },
    { x: 30, y: 26 },
    { x: 16, y: 33 }, { x: 44, y: 33 },
    { x: 16, y: 51, flip: true }, { x: 44, y: 51, flip: true },
    { x: 30, y: 58, flip: true },
    { x: 16, y: 64, flip: true }, { x: 44, y: 64, flip: true },
  ],
}

// ─── component ────────────────────────────────────────────────────────────────
export function CardView({ card, size = 'md' }: Props) {
  const c = CFG[size]
  const scale = c.w / 60  // relative to md baseline

  /* face-down */
  if (!card.faceUp) {
    return (
      <div
        style={{ width: c.w, height: c.h }}
        className="rounded-xl border-2 border-blue-800 shadow-lg flex-shrink-0 overflow-hidden"
      >
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            background:
              'repeating-linear-gradient(135deg,#1a3a6b 0px,#1a3a6b 5px,#15305a 5px,#15305a 10px)',
          }}
        >
          <div
            className="border border-blue-400 rounded opacity-50"
            style={{ width: c.w * 0.58, height: c.h * 0.58 }}
          />
        </div>
      </div>
    )
  }

  const sym    = SYM[card.suit]
  const red    = RED.has(card.suit)
  const clr    = red ? '#dc2626' : '#111827'
  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K'
  const isAce  = card.rank === 'A'

  // corner label height ≈ fontSize * 2.2 (two lines: rank + sym) + 2*cp
  const cornerH = Math.round(c.co * 2.2 + c.cp * 2)

  return (
    <div
      style={{ width: c.w, height: c.h, position: 'relative' }}
      className="rounded-xl bg-white border border-gray-300 shadow-lg flex-shrink-0 overflow-hidden select-none"
    >
      {/* ── top-left corner ── */}
      <div
        className="absolute flex flex-col items-center font-bold"
        style={{
          top: c.cp, left: c.cp,
          color: clr,
          fontSize: c.co,
          lineHeight: 1.1,
        }}
      >
        <span>{card.rank}</span>
        <span>{sym}</span>
      </div>

      {/* ── bottom-right corner (rotated 180°) ── */}
      <div
        className="absolute flex flex-col items-center font-bold"
        style={{
          bottom: c.cp, right: c.cp,
          color: clr,
          fontSize: c.co,
          lineHeight: 1.1,
          transform: 'rotate(180deg)',
        }}
      >
        <span>{card.rank}</span>
        <span>{sym}</span>
      </div>

      {/* ── centre pips or face ── */}
      {isFace
        ? <FaceCentre rank={card.rank} sym={sym} color={clr} c={c} cornerH={cornerH} />
        : <PipLayer
            rank={card.rank}
            sym={sym}
            color={clr}
            pipSize={isAce ? c.acePip : c.pip}
            scale={scale}
          />
      }
    </div>
  )
}

// ─── PipLayer ─────────────────────────────────────────────────────────────────
function PipLayer({
  rank, sym, color, pipSize, scale,
}: {
  rank: string; sym: string; color: string; pipSize: number; scale: number
}) {
  const pips = PIPS_MD[rank]
  if (!pips) return null

  return (
    <>
      {pips.map(({ x, y, flip }, i) => (
        <span
          key={i}
          className="absolute leading-none select-none"
          style={{
            color,
            fontSize: pipSize,
            // scale coordinates from md baseline
            left:      Math.round(x * scale),
            top:       Math.round(y * scale),
            transform: `translate(-50%,-50%)${flip ? ' rotate(180deg)' : ''}`,
          }}
        >
          {sym}
        </span>
      ))}
    </>
  )
}

// ─── FaceCentre ───────────────────────────────────────────────────────────────
function FaceCentre({
  rank, sym, color, c, cornerH,
}: {
  rank: string; sym: string; color: string
  c: typeof CFG['md']
  cornerH: number
}) {
  const red = color === '#dc2626'

  return (
    <div
      className="absolute flex flex-col items-center justify-center overflow-hidden rounded-md"
      style={{
        top: cornerH,
        left: 3,
        right: 3,
        bottom: cornerH,
        border: `1px solid ${red ? '#fca5a5' : '#d1d5db'}`,
        backgroundColor: red ? 'rgba(220,38,38,0.04)' : 'rgba(17,24,39,0.03)',
      }}
    >
      <span
        className="font-extrabold leading-none"
        style={{ color, fontSize: c.face }}
      >
        {rank}
      </span>
      <span
        className="leading-none mt-0.5"
        style={{ color, fontSize: Math.round(c.face * 0.7) }}
      >
        {sym}
      </span>
    </div>
  )
}
