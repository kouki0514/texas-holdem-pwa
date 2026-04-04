import { useState } from 'react'
import { useGameStore, type ReasoningEntry } from '@/store/gameStore'
import type { Card } from '@/game/types'
import { evaluateHand } from '@/game/handEvaluator'
import { PokerChip } from '@/components/ui/PokerChip'

const ACTION_STYLE: { [key: string]: string } = {
  fold:    'bg-red-900/60   text-red-300   border-red-700',
  check:   'bg-gray-700/60  text-gray-300  border-gray-500',
  call:    'bg-blue-900/60  text-blue-300  border-blue-700',
  raise:   'bg-yellow-900/60 text-yellow-300 border-yellow-700',
  bet:     'bg-orange-900/60 text-orange-300 border-orange-700',
  'all-in':'bg-purple-900/60 text-purple-300 border-purple-700',
  sb:      'bg-gray-700/60  text-gray-200  border-gray-400',
  bb:      'bg-blue-900/60  text-blue-200  border-blue-600',
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
  // sm: 白背景でスートの色が見やすいように統一
  return (
    <span className={`inline-flex items-center gap-0.5 bg-white rounded px-1 py-0.5 text-xs font-bold border border-gray-300 shadow-sm ${color}`}>
      <span>{rank}</span><span>{symbol}</span>
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

// タイムラインカード（AI・人間共通）
// reasoning==='' はhuman(playerAction)またはルールベースAIプリフロップ。
// どちらもreasoningブロックを非表示にするため、同じ判定で問題ない。
function isHumanEntry(e: ReasoningEntry) { return e.reasoning === '' }

function TimelineCard({ entry }: { entry: ReasoningEntry }) {
  const human   = isHumanEntry(entry)
  const badgeStyle = ACTION_STYLE[entry.action] ?? ACTION_STYLE.check
  const amtLabel   = entry.amount != null ? ` ${entry.amount}` : ''
  const showChip   = entry.amount != null && entry.amount > 0 &&
    (entry.action === 'raise' || entry.action === 'bet' || entry.action === 'all-in' || entry.action === 'call' ||
     (entry.action as string) === 'sb' || (entry.action as string) === 'bb')

  const containerCls = human
    ? 'rounded-lg border border-green-700/30 bg-green-900/10 p-2.5'
    : 'rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-1.5'
  const nameCls = human ? 'text-sm font-semibold text-green-300' : 'text-sm font-semibold text-white'

  return (
    <div className={containerCls}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={nameCls}>{entry.playerName}</span>
        {entry.position && (
          <span className="text-[10px] text-orange-300/80 bg-orange-900/20 border border-orange-700/30 rounded px-1.5 py-0.5 font-mono">
            {entry.position}
          </span>
        )}
        {showChip && <PokerChip amount={entry.amount!} />}
        <span className={`rounded-md border px-2 py-0.5 text-xs font-mono uppercase tracking-wide ${badgeStyle}`}>
          {entry.action}{amtLabel}
        </span>
        {entry.phase && (
          <span className="text-[10px] text-cyan-400/80 bg-cyan-900/20 border border-cyan-700/30 rounded px-1.5 py-0.5 font-mono uppercase">
            {entry.phase}
          </span>
        )}
        {entry.pot > 0 && (
          <span className="text-[10px] text-white/40 font-mono">
            Pot: {entry.pot}
          </span>
        )}
        {entry.holeCards.length > 0 && (
          <div className="flex gap-1 ml-1">
            {entry.holeCards.map((c, i) => <CardChip key={i} card={c} size="sm" />)}
          </div>
        )}
      </div>
      {!human && entry.reasoning && (
        <p className="text-xs text-white/70 leading-relaxed">{entry.reasoning}</p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// 折りたたみ可能なハンドまとめ
// ──────────────────────────────────────────────────────────────────────────────

interface HandSummaryProps {
  handNumber: number
  entries: ReasoningEntry[]
  humanPlayerId: string
  /** Net chips for the human player this hand (undefined = unknown) */
  netChips?: number
  /** Default expanded state */
  defaultExpanded?: boolean
}

function HandSummary({ handNumber, entries, humanPlayerId, netChips, defaultExpanded = false }: HandSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const community = entries.reduce<Card[]>(
    (best, e) => (e.communityCards ?? []).length > best.length ? (e.communityCards ?? []) : best,
    []
  )

  // Human エントリを取得（フォールバック3段階）
  // 1) reasoning==='' のエントリ（playerAction で記録した人間アクション）
  // 2) なければ humanPlayerId に一致するエントリで holeCards が空でないもの
  // 3) それもなければ humanPlayerId に一致する任意のエントリ
  const humanEntriesByReasoning = entries.filter((e) => e.playerId === humanPlayerId && isHumanEntry(e))
  const humanEntriesById = entries.filter((e) => e.playerId === humanPlayerId)

  const humanWithCards =
    humanEntriesByReasoning.find((e) => e.holeCards.length > 0) ??
    humanEntriesById.find((e) => e.holeCards.length > 0)

  const humanFirst = humanWithCards ?? humanEntriesByReasoning[0] ?? humanEntriesById[0]

  const humanHoleCards: Card[] = humanFirst?.holeCards?.length
    ? humanFirst.holeCards
    : []

  const humanPosition: string | null = humanFirst?.position ?? null
  const handJp = getHandJp(humanHoleCards, community)

  // タイムラインはtimestamp順
  const timeline = [...entries].sort((a, b) => a.timestamp - b.timestamp)

  // ネット損益は undefined でも常にラベル表示（±0含む）
  const netLabel = netChips != null
    ? netChips > 0
      ? <span className="text-green-400 font-mono text-xs font-bold">+{netChips}</span>
      : netChips < 0
        ? <span className="text-red-400 font-mono text-xs font-bold">{netChips}</span>
        : <span className="text-white/50 font-mono text-xs">±0</span>
    : null

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 overflow-hidden">
      {/* ヘッダー（常時表示・クリックで折りたたみ） */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-black/30 border-b border-white/10 hover:bg-black/40 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-purple-300 font-mono uppercase tracking-widest">
            Hand #{handNumber}
          </span>
          {humanPosition && (
            <span className="text-[10px] text-orange-300/80 bg-orange-900/20 border border-orange-700/30 rounded px-1.5 py-0.5 font-mono">
              {humanPosition}
            </span>
          )}
          {/* 最小化時: ホールカード + ネット損益 */}
          {!expanded && humanHoleCards.length > 0 && (
            <div className="flex gap-1 items-center ml-1">
              {humanHoleCards.map((c, i) => <CardChip key={i} card={c} size="sm" />)}
              {community.length >= 3 && (
                <span className="text-[10px] text-yellow-300/70 ml-1">{handJp}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {netLabel}
          <span className="text-white/30 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* 展開時のみ表示 */}
      {expanded && (
        <>
          {/* ボードカード */}
          <BoardCards community={community} />

          {/* タイムライン */}
          <div className="px-3 py-2 space-y-1.5">
            {timeline.map((entry) => (
              <TimelineCard
                key={`${entry.playerId}-${entry.timestamp}`}
                entry={entry}
              />
            ))}
          </div>
        </>
      )}
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
  className?: string
}

export function ClaudeReasoningPanel({ focusPlayerId, className = '' }: Props) {
  const claudeThinking    = useGameStore((s) => s.claudeThinking)
  const reasoningLog      = useGameStore((s) => s.reasoningLog)
  const players           = useGameStore((s) => s.players)
  const activeIdx         = useGameStore((s) => s.activePlayerIndex)
  const handNumber        = useGameStore((s) => s.handNumber)
  const chipsAtHandStart  = useGameStore((s) => s._chipsAtHandStart)
  const handNetChipsMap   = useGameStore((s) => s.handNetChipsMap)

  const thinkingPlayer = claudeThinking && activeIdx !== -1 ? players[activeIdx] : null
  const humanPlayer    = players.find((p) => p.isHuman)

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
      {sortedHands.map(([hn, entries], i) => {
        // 過去ハンドは handNetChipsMap から、現在進行中のハンドは chipsAtHandStart から計算
        let netChips: number | undefined
        if (hn in handNetChipsMap) {
          netChips = handNetChipsMap[hn]
        } else if (hn === handNumber && humanPlayer != null && chipsAtHandStart > 0) {
          netChips = humanPlayer.chips - chipsAtHandStart
        }
        return (
          <HandSummary
            key={hn}
            handNumber={hn}
            entries={entries}
            humanPlayerId={humanPlayer?.id ?? ''}
            netChips={netChips}
            defaultExpanded={i === 0}
          />
        )
      })}
    </div>
  )
}
