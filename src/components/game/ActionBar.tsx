import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useGame } from '@/hooks/useGame'

const POT_PRESETS = [
  { label: '33%', ratio: 0.33 },
  { label: '50%', ratio: 0.50 },
  { label: '75%', ratio: 0.75 },
  { label: 'Pot', ratio: 1.00 },
  { label: '150%', ratio: 1.50 },
]

const BET_MULTIPLIERS = [
  { label: '2x', mult: 2 },
  { label: '2.5x', mult: 2.5 },
  { label: '3x', mult: 3 },
  { label: '4x', mult: 4 },
]

export function ActionBar() {
  const { canAct, toCall, currentBet, minRaise, humanPlayer, pots, act } = useGame()

  const minRaiseTotal = currentBet + minRaise
  const maxRaise = (humanPlayer?.chips ?? 0) + (humanPlayer?.currentBet ?? 0)

  const [raiseAmount, setRaiseAmount] = useState(minRaiseTotal)

  // Sync slider bounds whenever it becomes the player's turn
  useEffect(() => {
    if (canAct) setRaiseAmount(minRaiseTotal)
  }, [canAct, minRaiseTotal])

  if (!canAct || !humanPlayer) return null

  const canCheck = toCall === 0
  const canRaise = humanPlayer.chips > toCall && maxRaise > minRaiseTotal
  const raiseLabel = currentBet === 0 ? 'Bet' : 'Raise'

  const totalPot = pots.reduce((s, p) => s + p.amount, 0)

  function clamp(amount: number) {
    return Math.min(maxRaise, Math.max(minRaiseTotal, Math.round(amount)))
  }

  return (
    <div className="flex flex-col gap-1.5 p-3 bg-black/50 rounded-xl border border-white/10">
      {/* Preset buttons: pot% and bet multipliers */}
      {canRaise && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            {POT_PRESETS.map(({ label, ratio }) => (
              <button
                key={label}
                onClick={() => setRaiseAmount(clamp(totalPot * ratio))}
                className="flex-1 py-0.5 text-[10px] font-semibold text-white/70 bg-white/5 hover:bg-white/15 border border-white/10 rounded transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
          {currentBet > 0 && (
            <div className="flex gap-1">
              {BET_MULTIPLIERS.map(({ label, mult }) => (
                <button
                  key={label}
                  onClick={() => setRaiseAmount(clamp(currentBet * mult))}
                  className="flex-1 py-0.5 text-[10px] font-semibold text-white/70 bg-white/5 hover:bg-white/15 border border-white/10 rounded transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action buttons row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Fold */}
        <Button variant="danger" size="sm" onClick={() => act('fold')}>
          Fold
        </Button>

        {/* Check / Call */}
        {canCheck ? (
          <Button variant="ghost" size="sm" onClick={() => act('check')}>
            Check
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => act('call')}>
            Call&nbsp;{toCall}
          </Button>
        )}

        {/* Raise / Bet */}
        {canRaise && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="range"
              min={minRaiseTotal}
              max={maxRaise}
              step={minRaise}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
              className="flex-1 min-w-[60px] accent-green-500"
            />
            <input
              type="number"
              min={minRaiseTotal}
              max={maxRaise}
              value={raiseAmount}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!isNaN(v)) setRaiseAmount(Math.min(maxRaise, Math.max(minRaiseTotal, v)))
              }}
              className="w-20 px-1.5 py-0.5 text-xs text-white bg-black/60 border border-white/20 rounded text-right focus:outline-none focus:border-green-500"
            />
            <Button size="sm" onClick={() => act('raise', raiseAmount)}>
              {raiseLabel}&nbsp;{raiseAmount}
            </Button>
          </div>
        )}

        {/* All-in */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => act('all-in')}
          className="ml-auto"
        >
          All-In ({humanPlayer.chips})
        </Button>
      </div>
    </div>
  )
}
