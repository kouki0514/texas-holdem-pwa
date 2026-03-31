import type { ActionType, Card, Player } from '@/game/types'
import { CardView } from './CardView'
import { PokerChip } from '@/components/ui/PokerChip'

interface Props {
  player: Player
  isDealer: boolean
  size?: 'sm' | 'md'
  lastAction?: ActionType | null
}

const BET_ACTIONS = new Set<string>(['raise', 'call', 'all-in', 'sb', 'bb'])

export function PlayerSeat({ player, isDealer, size = 'md', lastAction }: Props) {
  const cards = player.holeCards as Card[]

  const ring = player.isTurn
    ? 'ring-2 ring-yellow-400 shadow-[0_0_12px_2px_rgba(250,204,21,0.5)]'
    : ''
  const dimmed = player.isFolded ? 'opacity-40' : ''
  const cardSize = size === 'sm' ? 'sm' : 'md'

  const showChip = player.currentBet > 0 && !player.isFolded &&
    (lastAction == null || BET_ACTIONS.has(lastAction as string))
  const chipSize = size === 'sm' ? 22 : 28

  return (
    <div className={`flex flex-col items-center gap-1 ${dimmed}`}>
      {/* Hole cards */}
      <div className="flex gap-1">
        {cards.length > 0
          ? cards.map((card, i) => (
              <CardView key={i} card={card} size={cardSize} />
            ))
          : !player.isFolded && (
              <>
                <div className={`${cardSize === 'sm' ? 'w-10 h-14' : 'w-14 h-20'} rounded-lg bg-gray-800/40 border border-gray-700/50`} />
                <div className={`${cardSize === 'sm' ? 'w-10 h-14' : 'w-14 h-20'} rounded-lg bg-gray-800/40 border border-gray-700/50`} />
              </>
            )}
      </div>

      {/* Bet chip — shown between cards and name plate (table side) */}
      {showChip && (
        <div className="flex items-center gap-1">
          <PokerChip amount={player.currentBet} size={chipSize} />
          <span className="text-[10px] text-yellow-300 font-mono">{player.currentBet}</span>
        </div>
      )}

      {/* Name plate */}
      <div
        className={`px-3 py-1.5 rounded-lg bg-black/60 border text-center min-w-[80px] ${ring}
          ${player.isTurn ? 'border-yellow-400' : 'border-white/10'}`}
      >
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {isDealer && (
            <span className="bg-white text-black text-[10px] font-bold px-1 rounded">D</span>
          )}
          <span
            className={`text-xs font-semibold truncate max-w-[80px]
              ${player.isTurn ? 'text-yellow-300' : 'text-white'}`}
          >
            {player.name}
          </span>
          {player.isAllIn && (
            <span className="text-[10px] text-purple-400 font-bold">ALL IN</span>
          )}
        </div>
        <div className="text-[11px] text-white/60 mt-0.5">{player.chips.toLocaleString()} ¢</div>

        {player.isFolded && (
          <div className="text-[10px] text-red-400 font-semibold">FOLD</div>
        )}
        {!player.isFolded && lastAction === 'check' && (
          <div className="text-[10px] text-green-400 font-semibold">CHECK</div>
        )}
      </div>
    </div>
  )
}
