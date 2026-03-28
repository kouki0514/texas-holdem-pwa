import type { Card, GamePhase, Pot } from '@/game/types'
import { CardView } from './CardView'

interface Props {
  phase: GamePhase
  communityCards: Card[]
  pots: Pot[]
}

const PHASE_LABEL: Partial<Record<GamePhase, string>> = {
  preflop: 'PRE-FLOP',
  flop:    'FLOP',
  turn:    'TURN',
  river:   'RIVER',
  showdown:'SHOWDOWN',
}

export function GameBoard({ phase, communityCards, pots }: Props) {
  const totalPot = pots.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Phase label */}
      <span className="text-xs font-bold tracking-widest text-green-400 uppercase">
        {PHASE_LABEL[phase] ?? phase}
      </span>

      {/* Community cards */}
      <div className="flex gap-2">
        {communityCards.map((card, i) => (
          <CardView key={i} card={card} size="lg" />
        ))}
        {/* Placeholder slots */}
        {Array.from({ length: 5 - communityCards.length }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="w-20 h-28 rounded-lg border-2 border-dashed border-white/10"
          />
        ))}
      </div>

      {/* Pot */}
      {totalPot > 0 && (
        <div className="flex items-center gap-2 bg-black/40 px-4 py-1.5 rounded-full border border-white/10">
          <span className="text-yellow-400 text-sm">🪙</span>
          <span className="text-white font-semibold text-sm">
            Pot: {totalPot.toLocaleString()}
          </span>
          {pots.length > 1 && (
            <span className="text-white/50 text-xs">
              ({pots.length} pots)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
