import { useGameStore, type ReasoningEntry } from '@/store/gameStore'
import type { Card } from '@/game/types'
import { evaluateHand } from '@/game/handEvaluator'

const ACTION_STYLE: { [key: string]: string } = {
  fold:    'bg-red-900/60   text-red-300   border-red-700',
  check:   'bg-gray-700/60  text-gray-300  border-gray-500',
  call:    'bg-blue-900/60  text-blue-300  border-blue-700',
  raise:   'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  'all-in':'bg-purple-900/60 text-purple-300 border-purple-700',
}

const SUIT_SYMBOL: { [key: string]: string } = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
const SUIT_COLOR:  { [key: string]: string } = {
  spades: 'text-gray-800', hearts: 'text-red-500', diamonds: 'text-red-500', clubs: 'text-gray-800'
}
const RANK_DISPLAY: { [key: string]: string } = {
  '2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9',
  '10':'10', T:'10', J:'J', Q:'Q', K:'K', A:'A'
}
const HAND_RANK_JP: { [key: string]: string } = {
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

function rankDisplay(rank: string) { return RANK_DISPLAY[rank] ?? rank }

function CardChip({ card, size = 'sm' }: { card: Card; size?: 'sm' | 'md' }) {
  const suit   = card.suit as string
  const symbol = SUIT_SYMBOL[suit] ?? suit
  const color  = SUIT_COLOR[suit]  ?? 'text-gray-800'
  const rank   = rankDisplay(card.rank as string)
  if (size === 'md') {
    return (
      <span className={`inline-flex flex-col items-center justify-center bg-white rounded w-8 h-11 border border-gray-300 shadow-sm ${color} font-bold leading-none`}>
        <span className="text-xs">{rank}</span>
        <span className="text-sm">{symbol}</span>
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-0.5 bg-white/10 border border-white/20 rounded px-1 py-0.5 text-xs font-bold text-white`}>
      <span>{rank}</span><span className={color}>{symbol}</span>
    </span>
  )
}

function getHandJp(holeCards: Card[], communityCards: Card[]): string {
  if (holeCards.length < 2 || communityCards.length < 3) return '—'
  try {
    const result = evaluateHand(holeCards as [Card, Card], communityCards)
    return HAND_RANK_JP[result.rank as string] ?? 'ハイカード'
  } catch {
    return '—'
  }
}

// ボードカード（Flop/Turn/River）
function BoardCards({ community }: { community: Card[] }) {
  if (community.length === 0) return null
  const flop  = community.slice(0, 3)
  const turn  = community[3]
  const river = community[4]
  return (
    <div className="px-3 py-2.5 bg-black/20 border-b border-white/10">
      <p className="text-[10px] text-white/40 uppercase tracking-widest mb-2">ボードカード</p>
      <div className="flex gap-3 flex-wrap items-end">
        {flop.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">Flop</span>
            <div className="flex gap-1">
              {flop.map((c, i) => <CardChip key={i} card={c} size="md" />)}
            </div>
          </div>
        )}
        {turn && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">Turn</span>
            <CardChip card={turn} size="md" />
          </div>
        )}
        {river && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-white/30 uppercase tracking-widest">River</span>
            <CardChip card={river} size="md" />
          </div>
        )}
      </div>
    </div>
  )
}

// プレイヤーごとのホールカード行
function PlayerRow({ entries, community }: { entries: ReasoningEntry[]; community: Card[] }) {
  const last      = entries[entries.length - 1]
  const holeCards = last.holeCards ?? []
  const handJp    = getHandJp(holeCards, community)
  const badge     = ACTION_STYLE[last.action] ?? ACTION_STYLE.check
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 last:border-0">
      {/* 名前 */}
      <span className="text-xs text-white/80 font-semibold w-10 shrink-0 truncate">{last.playerName}</span>
      {/* ホールカード 2枚 固定幅で確保 */}
      <div className="flex gap-1 shrink-0">
        {holeCards.length > 0
          ? holeCards.map((c, i) => <CardChip key={i} card={c} size="md" />)
          : <span className="text-xs text-white/20 w-[4.5rem]">—</span>
        }
      </div>
      {/* 役名 */}
      {holeCards.length > 0 && community.length >= 3 && (
        <span className="text-[10px] text-yellow-300/80 bg-yellow-900/20 border border-yellow-700/30 rounded px-1.5 py-0.5 whitespace-nowrap">
          {handJp}
        </span>
      )}
      {/* 最終アクション */}
      <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase shrink-0 ${badge}`}>
        {last.action}
      </span>
    </div>
  )
}

// アクション詳細カード
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

// ハンドまとめ
function HandSummary({ handNumber, entries }: { handNumber: number; entries: ReasoningEntry[] }) {
  const first     = entries[0]
  const community = first?.communityCards ?? []

  const playerMap = new Map<string, ReasoningEntry[]>()
  for (const e of entries) {
    if (!playerMap.has(e.playerId)) playerMap.set(e.playerId, [])
    playerMap.get(e.playerId)!.push(e)
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 overflow-hidden">
      {/* 1. ヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/30 border-b border-white/10">
        <span className="text-xs font-bold text-purple-300 font-mono uppercase tracking-widest">
          Hand #{handNumber}
        </span>
        <span className="text-xs text-white/40">{entries.length} アクション</span>
      </div>

      {/* 2. ボードカード（一番上） */}
      <BoardCards community={community} />

      {/* 3. プレイヤーホールカード */}
      <div className="border-b border-white/10">
        {[...playerMap.entries()].map(([playerId, pEntries]) => (
          <PlayerRow key={playerId} entries={pEntries} community={community} />
        ))}
      </div>

      {/* 4. アクション詳細 */}
      <div className="px-3 py-2 space-y-1.5">
        {entries.map((e) => (
          <ReasoningCard key={`${e.playerId}-${e.timestamp}`} entry={e} />
        ))}
      </div>
    </div>
  )
}

function ThinkingIndicator({ playerName }: { playerName: string }) {
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-900/20 p-3 flex items-center gap-3">
      <div className="flex gap-1 shrink-0">
        {[0, 1, 2].map((i) => (
          <span key={i} className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <p className="text-sm text-purple-300">
        <span className="font-semibold">{playerName}</span>&nbsp;が考えています…
      </p>
    </div>
  )
}

interface Props {
  focusPlayerId?: string
  maxEntries?: number
  className?: string
}

export function ClaudeReasoningPanel({ focusPlayerId, className = '' }: Props) {
  const claudeEnabled  = useGameStore((s) => s.claudeEnabled)
  const claudeThinking = useGameStore((s) => s.claudeThinking)
  const reasoningLog   = useGameStore((s) => s.reasoningLog)
  const players        = useGameStore((s) => s.players)
  const activeIdx      = useGameStore((s) => s.activePlayerIndex)

  if (!claudeEnabled) return null

  const thinkingPlayer = claudeThinking && activeIdx !== -1 ? players[activeIdx] : null

  const filtered = focusPlayerId
    ? reasoningLog.filter((e) => e.playerId === focusPlayerId)
    : reasoningLog

  const byHand = new Map<number, ReasoningEntry[]>()
  for (const e of filtered) {
    if (!byHand.has(e.handNumber)) byHand.set(e.handNumber, [])
    byHand.get(e.handNumber)!.push(e)
  }
  const sortedHands = [...byHand.entries()].sort((a, b) => b[0] - a[0])

  if (!claudeThinking && sortedHands.length === 0) return null

  return (
    <div className={`flex flex-col gap-3 p-3 ${className}`}>
      {claudeThinking && thinkingPlayer && (
        <ThinkingIndicator playerName={thinkingPlayer.name} />
      )}
      {sortedHands.map(([handNumber, entries]) => (
        <HandSummary key={handNumber} handNumber={handNumber} entries={entries} />
      ))}
    </div>
  )
}
