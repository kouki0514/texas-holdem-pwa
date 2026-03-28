import { useGameStore, type ReasoningEntry } from '@/store/gameStore'

// ──────────────────────────────────────────────────────────────────────────────
// Action badge colours
// ──────────────────────────────────────────────────────────────────────────────

const ACTION_STYLE: Record<string, string> = {
  fold:    'bg-red-900/60   text-red-300   border-red-700',
  check:   'bg-gray-700/60  text-gray-300   border-gray-500',
  call:    'bg-blue-900/60  text-blue-300   border-blue-700',
  raise:   'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  'all-in':'bg-purple-900/60 text-purple-300 border-purple-700',
}

// ──────────────────────────────────────────────────────────────────────────────
// Single reasoning card
// ──────────────────────────────────────────────────────────────────────────────

function ReasoningCard({ entry }: { entry: ReasoningEntry }) {
  const badgeStyle = ACTION_STYLE[entry.action] ?? ACTION_STYLE.check
  const amtLabel = entry.amount != null ? ` ${entry.amount}` : ''

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-white">{entry.playerName}</span>
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-mono uppercase tracking-wide ${badgeStyle}`}
        >
          {entry.action}{amtLabel}
        </span>
        <span className="ml-auto text-xs text-white/40">Hand #{entry.handNumber}</span>
      </div>

      {/* Reasoning text */}
      <p className="text-sm text-white/80 leading-relaxed">{entry.reasoning}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Thinking spinner
// ──────────────────────────────────────────────────────────────────────────────

function ThinkingIndicator({ playerName }: { playerName: string }) {
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-900/20 p-3 flex items-center gap-3">
      {/* Animated dots */}
      <div className="flex gap-1 shrink-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      <p className="text-sm text-purple-300">
        <span className="font-semibold">{playerName}</span>
        &nbsp;が考えています…
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  /** If provided, show only reasoning for this player */
  focusPlayerId?: string
  /** Maximum number of recent entries to show (default 5) */
  maxEntries?: number
  className?: string
}

export function ClaudeReasoningPanel({
  focusPlayerId,
  maxEntries = 5,
  className = '',
}: Props) {
  const claudeEnabled = useGameStore((s) => s.claudeEnabled)
  const claudeThinking = useGameStore((s) => s.claudeThinking)
  const reasoningLog = useGameStore((s) => s.reasoningLog)
  const players = useGameStore((s) => s.players)
  const activeIdx = useGameStore((s) => s.activePlayerIndex)

  if (!claudeEnabled) return null

  // Which player is currently thinking?
  const thinkingPlayer =
    claudeThinking && activeIdx !== -1 ? players[activeIdx] : null

  // Recent entries (focused or all), newest first
  const entries = [...reasoningLog]
    .filter((e) => !focusPlayerId || e.playerId === focusPlayerId)
    .reverse()
    .slice(0, maxEntries)

  if (!claudeThinking && entries.length === 0) return null

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Section header */}
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-purple-400">
        <span>🧠</span>
        <span>AIの思考</span>
      </h3>

      {/* Thinking spinner */}
      {claudeThinking && thinkingPlayer && (
        <ThinkingIndicator playerName={thinkingPlayer.name} />
      )}

      {/* Reasoning cards — latest at top */}
      {entries.map((entry) => (
        <ReasoningCard
          key={`${entry.playerId}-${entry.timestamp}`}
          entry={entry}
        />
      ))}
    </div>
  )
}
