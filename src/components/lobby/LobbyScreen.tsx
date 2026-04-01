import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useGameStore } from '@/store/gameStore'
import type { Player } from '@/game/types'

function createPlayers(humanName: string, aiCount: number, startingStack: number): Player[] {
  const human: Player = {
    id: 'human-1',
    name: humanName || 'Player',
    chips: startingStack,
    holeCards: [],
    position: null,
    isHuman: true,
    isFolded: false,
    isAllIn: false,
    currentBet: 0,
    totalBetThisHand: 0,
    isDealer: false,
    isTurn: false,
  }

  const ais: Player[] = Array.from({ length: aiCount }, (_, i) => ({
    id: `ai-${i + 1}`,
    name: `AI ${i + 1}`,
    chips: startingStack,
    holeCards: [],
    position: null,
    isHuman: false,
    isFolded: false,
    isAllIn: false,
    currentBet: 0,
    totalBetThisHand: 0,
    isDealer: false,
    isTurn: false,
  }))

  return [human, ...ais]
}

export function LobbyScreen() {
  const [name, setName] = useState('')
  const [aiCount, setAiCount] = useState(3)
  const [startingStack, setStartingStack] = useState(1000)
  const { initGame, startNewHand } = useGameStore()
  const language    = useGameStore((s) => s.language)
  const setLanguage = useGameStore((s) => s.setLanguage)

  const handleStart = () => {
    const players = createPlayers(name, aiCount, startingStack)
    initGame(players)
    startNewHand()
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8 bg-felt-dark">
      <h1 className="text-5xl font-bold text-white tracking-wider">♠ Texas Hold'em ♠</h1>

      <div className="bg-black/30 rounded-2xl p-8 flex flex-col gap-4 w-88">
        <label className="text-white font-medium">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          className="rounded-lg px-3 py-2 bg-white/10 text-white border border-white/20 placeholder-white/40 focus:outline-none focus:border-green-400"
        />

        <label className="text-white font-medium">AI Opponents: {aiCount}</label>
        <input
          type="range"
          min={1}
          max={5}
          value={aiCount}
          onChange={(e) => setAiCount(Number(e.target.value))}
          className="accent-green-500"
        />

        <label className="text-white font-medium">Starting Stack</label>
        <div className="flex gap-2">
          {[1000, 2000, 4000].map((stack) => (
            <button
              key={stack}
              onClick={() => setStartingStack(stack)}
              className={`flex-1 py-2 rounded-lg font-bold border transition-all ${
                startingStack === stack
                  ? 'bg-green-500 border-green-400 text-white'
                  : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20'
              }`}
            >
              {stack.toLocaleString()}
            </button>
          ))}
        </div>

        {/* Language toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-white font-medium">AI Reasoning Language</label>
          <div className="flex rounded-lg overflow-hidden border border-white/20">
            {(['ja', 'en'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                  language === lang
                    ? 'bg-green-500 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {lang === 'ja' ? '日本語' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <Button size="lg" onClick={handleStart} className="mt-2">
          Start Game
        </Button>
      </div>
    </div>
  )
}
