import { useState } from 'react'
import type { Card, HandRank, Player, PotResult } from '@/game/types'
import { evaluateHand } from '@/game/handEvaluator'
import { CardView } from './CardView'
import { Button } from '@/components/ui/Button'
import { useGameStore } from '@/store/gameStore'

interface Props {
  players: Player[]
  winners: PotResult[]
  communityCards: Card[]
  onNextHand: () => void
  onClose: () => void
}

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

function cardKey(c: Card) { return `${c.rank}-${c.suit}` }

export function ShowdownResult({ players, winners, communityCards, onNextHand, onClose }: Props) {
  const initialStackMap = useGameStore((s) => s.initialStackMap)
  const addOnChips      = useGameStore((s) => s.addOnChips)

  const [showAddOn, setShowAddOn] = useState(false)
  const addOnEligible = players.filter((p) => {
    const initial = initialStackMap[p.id] ?? 0
    return initial > 0 && p.chips < initial
  })
  const [addOnSelected, setAddOnSelected] = useState<Set<string>>(
    () => new Set(addOnEligible.map((p) => p.id))
  )

  const handleOpenAddOn = () => {
    setAddOnSelected(new Set(addOnEligible.map((p) => p.id)))
    setShowAddOn(true)
  }

  const handleConfirmAddOn = () => {
    addOnChips([...addOnSelected])
    setShowAddOn(false)
  }

  const winnerIds     = new Set(winners.flatMap((w) => w.winners))
  const activePlayers = players.filter((p) => !p.isFolded)
  const totalPot      = winners.reduce((s, w) => s + w.amount, 0)
  const isUncontested = winners.some((w) => w.isUncontested)

  // Net profit per player: sum of pots won minus total amount invested this hand
  const netByPlayer = new Map<string, number>(
    players.map((p) => [p.id, -p.totalBetThisHand])
  )
  for (const w of winners) {
    const share = Math.floor(w.amount / w.winners.length)
    const remainder = w.amount % w.winners.length
    w.winners.forEach((id, i) => {
      netByPlayer.set(id, (netByPlayer.get(id) ?? 0) + share + (i === 0 ? remainder : 0))
    })
  }

  // Only evaluate hands when there is a real showdown (not uncontested)
  const evaluations = isUncontested ? activePlayers.map(() => null) : activePlayers.map((p) => {
    const hole = p.holeCards as [Card, Card]
    if (hole.length !== 2) return null
    try {
      const result = evaluateHand(hole, communityCards)
      return { playerId: p.id, rank: result.rank, bestFive: new Set(result.bestFive.map(cardKey)) }
    } catch {
      return null
    }
  })

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-4">
      <div className="bg-felt-dark border border-white/20 rounded-2xl p-5 w-full max-w-xl shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            {isUncontested ? '相手がフォールド' : 'Showdown'}
          </h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-2xl leading-none transition-colors"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* Winner announcement */}
        <div className="text-center">
          {players.map((p) => {
            const net = netByPlayer.get(p.id) ?? 0
            if (net === 0) return null
            const isWin = net > 0
            const sign  = isWin ? '+' : ''
            return (
              <p key={p.id} className={`font-semibold ${isWin ? 'text-yellow-400' : 'text-red-400'}`}>
                {isWin && '🏆 '}{p.name}
                <span className="text-sm font-normal ml-2">
                  {sign}{net.toLocaleString()} chips
                </span>
              </p>
            )
          })}
          <p className="text-white/50 text-xs mt-0.5">合計ポット: {totalPot.toLocaleString()} chips</p>
        </div>

        {/* Community cards — only shown in real showdowns */}
        {!isUncontested && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] text-white/40 uppercase tracking-widest">Board</span>
            <div className="flex gap-1 justify-center">
              {communityCards.map((card, i) => (
                <CardView key={i} card={{ ...card, faceUp: true }} size="sm" />
              ))}
            </div>
          </div>
        )}

        {/* Player hands — only shown in real showdowns */}
        <div className="flex flex-wrap justify-center gap-3">
          {activePlayers.map((player, pi) => {
            const isWinner = winnerIds.has(player.id)
            const hole     = player.holeCards as Card[]
            const ev       = evaluations[pi]

            return (
              <div
                key={player.id}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border
                  ${isWinner
                    ? 'border-yellow-400 bg-yellow-900/20 shadow-[0_0_16px_2px_rgba(250,204,21,0.3)]'
                    : 'border-white/10 bg-white/5'
                  }`}
              >
                {/* Name */}
                <p className={`text-sm font-bold ${isWinner ? 'text-yellow-300' : 'text-white/80'}`}>
                  {player.name}
                </p>

                {/* Hole cards — highlight if in best five; keep face-down when uncontested */}
                <div className="flex gap-1">
                  {hole.map((card, i) => {
                    const inBest = !isUncontested && (ev?.bestFive.has(cardKey(card)) ?? false)
                    return (
                      <div
                        key={i}
                        className={`rounded-lg ${inBest
                          ? 'ring-2 ring-yellow-400 shadow-[0_0_8px_2px_rgba(250,204,21,0.5)]'
                          : 'opacity-50'
                        }`}
                      >
                        <CardView card={{ ...card, faceUp: !isUncontested || isWinner }} size="sm" />
                      </div>
                    )
                  })}
                </div>

                {/* Hand rank — not shown when uncontested */}
                {!isUncontested && ev && (
                  <p className={`text-[11px] font-semibold ${isWinner ? 'text-yellow-300' : 'text-white/50'}`}>
                    {isWinner && '🏆 '}{HAND_RANK_JA[ev.rank]}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {addOnEligible.length > 0 && (
          <Button size="lg" onClick={handleOpenAddOn} className="mt-1 bg-green-600 hover:bg-green-500 border-green-500">
            アドオン
          </Button>
        )}
        <Button size="lg" onClick={onNextHand} className="mt-1">
          次のハンド →
        </Button>
      </div>

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
    </div>
  )
}
