import { useGameStore } from '@/store/gameStore'

export function ClaudeToggle() {
  const claudeEnabled = useGameStore((s) => s.claudeEnabled)
  const setClaudeEnabled = useGameStore((s) => s.setClaudeEnabled)
  const hasApiKey = Boolean(import.meta.env.VITE_ANTHROPIC_API_KEY)

  return (
    <label
      className={`flex items-center gap-2 cursor-pointer select-none
        ${!hasApiKey ? 'opacity-40 pointer-events-none' : ''}`}
      title={!hasApiKey ? 'VITE_ANTHROPIC_API_KEY が未設定です' : undefined}
    >
      {/* Toggle track */}
      <div
        className={`relative h-6 w-11 rounded-full transition-colors duration-200
          ${claudeEnabled ? 'bg-purple-600' : 'bg-gray-600'}`}
        onClick={() => setClaudeEnabled(!claudeEnabled)}
      >
        <div
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200
            ${claudeEnabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </div>

      <span className="text-sm text-white/80">
        🤖 Claude AI
        {claudeEnabled && (
          <span className="ml-1 text-xs text-purple-400">(haiku-4.5)</span>
        )}
      </span>
    </label>
  )
}
