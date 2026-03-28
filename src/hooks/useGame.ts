import { useCallback } from 'react'
import { useGameStore } from '@/store/gameStore'
import type { ActionType } from '@/game/types'

/** Convenience hook for human player actions */
export function useGame() {
  const store = useGameStore()
  const humanPlayer = store.players.find((p) => p.isHuman) ?? null

  const canAct = humanPlayer?.isTurn ?? false
  const toCall = canAct
    ? store.currentBet - (humanPlayer?.currentBet ?? 0)
    : 0

  const act = useCallback(
    (action: ActionType, amount?: number) => {
      if (!canAct) return
      store.playerAction(action, amount)
    },
    [canAct, store],
  )

  return {
    phase: store.phase,
    communityCards: store.communityCards,
    players: store.players,
    pots: store.pots,
    humanPlayer,
    canAct,
    toCall,
    currentBet: store.currentBet,
    minRaise: store.minRaise,
    act,
    startNewHand: store.startNewHand,
  }
}
