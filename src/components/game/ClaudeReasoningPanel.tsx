import { useGameStore, type ReasoningEntry } from '@/store/gameStore'
import type { Card } from '@/game/types'
import { evaluateHand } from '@/game/handEvaluator'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const ACTION_STYLE: { [key: string]: string } = {
  fold:   'bg-red-900/60   text-red-300   border-red-700',
  check:  'bg-gray-700/60  text-gray-300  border-gray-500',
  call:   'bg-blue-900/60  text-blue-300  border-blue-700',
  raise:  'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  'all-in':'bg-purple-900/60 text-purple-300 border-purple-700',
}

const SUIT_SYMBOL: { [key: string]: string } = { s: '♠', h: '♥', d: '♦', c: '♣' }
const SUIT_COLOR:  { [key: string]: string } = { s: 'text-white', h: 'text-red-400', d: 'text-red-400', c: 'text-white' }
const RANK_LABEL: { [key: string]: string } = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }

const HAND_RANK_JP: { [key: number]: string } = {
  8: 'ロイヤルフラッシュ',
  7: 'ストレートフラッシュ',
  6: 'フォーカード',
  5: 'フルハウス',
  4: 'フラッシュ',
  3: 'ストレート',
  2: 'スリーカード',
  1: 'ツーペア',
  0: 'ワンペア',
  // ハイカード = rank undefined or -1
}

function rankLabel(r: string) { return RANK_LABEL[r] ?? r }

function CardChip({ card }: { card: Card }) {
  const suit = card.suit as string
  return (
    <span className={`inline-flex items-center gap-0.5 bg-white/10 border border-white/20 rounded px-1 py-0.5 text-xs font-bold ${SUIT_COLOR[suit] ?? 'text-white'}`}>
      {rankLabel(card.rank)}{SUIT_SYMBOL[suit] ?? suit}
    </span>
  )
}

function getHandJp(holeCards: Card[], communityCards: Card[]): string {
  if (holeCards.length < 2 || communityCards.length < 3) return '—'
  try {
    const result = evaluateHand(holeCards as [Card, Card], communityCards)
    return HAND_RANK_JP[result.rank] ?? 'ハイカード'
  } catch {
    return '—'
  }
}

// ─────────────────────────────────────────────
// Single reasoning card
// ─────────────────────────────────────────────

function ReasoningCard({ entry }: { entry: ReasoningEntry }) {
  const badgeStyle = ACTION_STYLE[entry.action] ?? ACTION_STYLE.check
  const amtLabel   = entry.amount != null ? ` ${entry.amount}` : ''
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-white">{entry.playerName}</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-mono uppercase tracking-wide ${badgeStyle}`}>
          {entry.action}{amtLabel}
        </span>
      </div>
      {entry.reasoning && (
        <p className="text-xs text-white/70 leading-relaxed">{entry.reasoning}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Hand summary card (grouped)
// ─────────────────────────────────────────────

function HandSummary({ handNumber, entries }: { handNumber: number; entries: ReasoningEntry[] }) {
  const first       = entries[0]
  const community   = first?.communityCards ?? []
  const flop        = community.slice(0, 3)
  const turn        = community[3]
  const river       = community[4]

  // collect unique players and their best hand at river
  const playerMap = new Map<string, ReasoningEntry[]>()
  for (const e of entries) {
    if (!playerMap.has(e.playerId)) playerMap.set(e.playerId, [])
    playerMap.get(e.playerId)!.push(e)
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/30 border-b border-white/10">
        <span className="text-xs font-bold text-purple-300 font-mono uppercase tracking-widest">
          Hand #{handNumber}
        </span>
        <span className="text-xs text-white/40">{entries.length} アクション</span>
      </div>

      {/* Community cards */}
      {community.length > 0 && (
        <div className="px-3 py-2 border-b border-white/10 space-y-1.5">
          <p className="text-[10px] text-white/40 uppercase tracking-widest">ボードカード</p>
          <div className="flex gap-2 flex-wrap items-center">
            {flop.length > 0 && (
              <div className="flex gap-1 items-center">
                <span className="text-[10px] text-white/30 mr-0.5">F</span>
                {flop.map((c, i) => <CardChip key={i} card={c} />)}
              </div>
            )}
            {turn && (
              <div className="flex gap-1 items-center">
                <span className="text-[10px] text-white/30 mr-0.5">T</span>
                <CardChip card={turn} />
              </div>
            )}
            {river && (
              <div className="flex gap-1 items-center">
                <span className="text-[10px] text-white/30 mr-0.5">R</span>
                <CardChip card={river} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-player hole cards + hand rank */}
      {[...playerMap.entries()].map(([playerId, pEntries]) => {
        const last       = pEntries[pEntries.length - 1]
        const holeCards  = last.holeCards ?? []
        const handJp     = getHandJp(holeCards, community)
        const lastAction = last.action
        const badge      = ACTION_STYLE[lastAction] ?? ACTION_STYLE.check
        return (
          <div key={playerId} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 last:border-0">
            <span className="text-xs text-white/80 font-semibold w-16 shrink-0 truncate">{last.playerName}</span>
            <div className="flex gap-1 items-center">
              {holeCards.length > 0
                ? holeCards.map((c, i) => <CardChip key={i} card={c} />)
                : <span className="text-xs text-white/20">—</span>
              }
            </div>
            {holeCards.length > 0 && community.length >= 3 && (
              <span className="text-[10px] text-yellow-300/80 bg-yellow-900/20 border border-yellow-700/30 rounded px-1.5 py-0.5 ml-1 whitespace-nowrap">
                {handJp}
              </span>
            )}
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase ${badge}`}>
              {lastAction}
            </span>
          </div>
        )
      })}

      {/* Action log */}
      <div className="px-3 py-2 space-y-1.5">
        {entries.map((e) => (
          <ReasoningCard key={`${e.playerId}-${e.timestamp}`} entry={e} />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Thinking spinner
// ─────────────────────────────────────────────

function ThinkingIndicator({ playerName }: { playerName: string }) {
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-900/20 p-3 flex items-center gap-3">
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
        <span className="font-semibold">{playerName}</span>&nbsp;が考えています…
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────

interface Props {
  focusPlayerId?: string
  maxEntries?: number
  className?: string
}

export function ClaudeReasoningPanel({
  focusPlayerId,
  className = '',
}: Props) {
  const claudeEnabled  = useGameStore((s) => s.claudeEnabled)
  const claudeThinking = useGameStore((s) => s.claudeThinking)
  const reasoningLog   = useGameStore((s) => s.reasoningLog)
  const players        = useGameStore((s) => s.players)
  const activeIdx      = useGameStore((s) => s.activePlayerIndex)

  if (!claudeEnabled) return null

  const thinkingPlayer =
    claudeThinking && activeIdx !== -1 ? players[activeIdx] : null

  // filter by player if focusPlayerId given
  const filtered = focusPlayerId
    ? reasoningLog.filter((e) => e.playerId === focusPlayerId)
    : reasoningLog

  // group by handNumber (newest hand first)
  const byHand = new Map<number, ReasoningEntry[]>()
  for (const e of filtered) {
    if (!byHand.has(e.handNumber)) byHand.set(e.handNumber, [])
    byHand.get(e.handNumber)!.push(e)
  }
  const sortedHands = [...byHand.entries()].sort((a, b) => b[0] - a[0])

  if (!claudeThinking && sortedHands.length === 0) return null

  return (
    <div className={`flex flex-col gap-3 p-3 ${className}`}>
      {/* Thinking indicator */}
      {claudeThinking && thinkingPlayer && (
        <ThinkingIndicator playerName={thinkingPlayer.name} />
      )}

      {/* Hand summaries */}
      {sortedHands.map(([handNumber, entries]) => (
        <HandSummary key={handNumber} handNumber={handNumber} entries={entries} />
      ))}
    </div>
  )
}
