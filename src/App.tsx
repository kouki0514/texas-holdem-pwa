import { useGameStore } from '@/store/gameStore'
import { LobbyScreen } from '@/components/lobby/LobbyScreen'
import { GameScreen } from '@/components/game/GameScreen'
import { ResultScreen } from '@/components/result/ResultScreen'

const GAME_PHASES = new Set(['preflop', 'flop', 'turn', 'river', 'showdown'])

export default function App() {
  const phase = useGameStore((s) => s.phase)

  if (phase === 'waiting') return <LobbyScreen />
  if (GAME_PHASES.has(phase)) return <GameScreen />
  if (phase === 'ended') return <ResultScreen />

  return <LobbyScreen />
}
