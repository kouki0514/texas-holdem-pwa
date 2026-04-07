import type { ActionType, GameState, Player, Card } from '@/game/types'
import { rankToValue } from '@/game/deck'
import { evaluateHand } from '@/game/handEvaluator'
import cfrStrategyRaw from './preflop_strategy.json'

const CFR_STRATEGY = cfrStrategyRaw as Record<string, { fold: number; call: number; raise: number }>

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ─────────────────────────────────────────────────────────────────────────────
// 6max プリフロップレンジ
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_RANGES: Record<string, Record<string, string>> = {
  'UTG': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','KQo':'R','KJo':'R','KTo':'R',
    'QJs':'R','QTs':'R','Q9s':'R','QJo':'R','QTo':'R',
    'JTs':'R','J9s':'R','JTo':'R','T9s':'R','T8s':'R','98s':'R','87s':'R','76s':'R','65s':'R','54s':'R' },
  'HJ': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R','A8o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','K7s':'R','KQo':'R','KJo':'R','KTo':'R',
    'QJs':'R','QTs':'R','Q9s':'R','Q8s':'R','QJo':'R','QTo':'R',
    'JTs':'R','J9s':'R','J8s':'R','JTo':'R','T9s':'R','T8s':'R','T7s':'R','98s':'R','97s':'R','87s':'R','86s':'R','76s':'R','75s':'R','65s':'R','64s':'R','54s':'R','53s':'R' },
  'CO': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R','A8o':'R','A7o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','K7s':'R','K6s':'R','KQo':'R','KJo':'R','KTo':'R','K9o':'R',
    'QJs':'R','QTs':'R','Q9s':'R','Q8s':'R','Q7s':'R','QJo':'R','QTo':'R','Q9o':'R',
    'JTs':'R','J9s':'R','J8s':'R','J7s':'R','JTo':'R','J9o':'R',
    'T9s':'R','T8s':'R','T7s':'R','T6s':'R','T9o':'R','98s':'R','97s':'R','96s':'R','87s':'R','86s':'R','76s':'R','75s':'R','65s':'R','64s':'R','54s':'R','53s':'R','43s':'R' },
  'BTN': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R','A8o':'R','A7o':'R','A6o':'R','A5o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','K7s':'R','K6s':'R','K5s':'R','KQo':'R','KJo':'R','KTo':'R','K9o':'R','K8o':'R',
    'QJs':'R','QTs':'R','Q9s':'R','Q8s':'R','Q7s':'R','Q6s':'R','QJo':'R','QTo':'R','Q9o':'R','Q8o':'R',
    'JTs':'R','J9s':'R','J8s':'R','J7s':'R','J6s':'R','JTo':'R','J9o':'R','J8o':'R',
    'T9s':'R','T8s':'R','T7s':'R','T6s':'R','T5s':'R','T9o':'R','T8o':'R',
    '98s':'R','97s':'R','96s':'R','95s':'R','87s':'R','86s':'R','85s':'R','76s':'R','75s':'R','74s':'R','65s':'R','64s':'R','54s':'R','53s':'R','43s':'R','42s':'R','32s':'R' },
  'SB': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R','A8o':'R','A7o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','K7s':'R','KQo':'R','KJo':'R','KTo':'R','K9o':'R',
    'QJs':'R','QTs':'R','Q9s':'R','Q8s':'R','QJo':'R','QTo':'R','Q9o':'R',
    'JTs':'R','J9s':'R','J8s':'R','JTo':'R','J9o':'R',
    'T9s':'R','T8s':'R','T7s':'R','T9o':'R','98s':'R','97s':'R','87s':'R','86s':'R','76s':'R','75s':'R','65s':'R','54s':'R' },
  'BB': { 'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A9s':'R','A8s':'R','A7s':'R','A6s':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'AKo':'R','AQo':'R','AJo':'R','ATo':'R','A9o':'R','A8o':'R','A7o':'R','A6o':'R',
    'KQs':'R','KJs':'R','KTs':'R','K9s':'R','K8s':'R','K7s':'R','K6s':'R','KQo':'R','KJo':'R','KTo':'R','K9o':'R',
    'QJs':'R','QTs':'R','Q9s':'R','Q8s':'R','Q7s':'R','QJo':'R','QTo':'R','Q9o':'R',
    'JTs':'R','J9s':'R','J8s':'R','J7s':'R','JTo':'R','J9o':'R',
    'T9s':'R','T8s':'R','T7s':'R','T6s':'R','T9o':'R','T8o':'R',
    '98s':'R','97s':'R','96s':'R','87s':'R','86s':'R','76s':'R','75s':'R','65s':'R','64s':'R','54s':'R','53s':'R','43s':'R' },
}

// ── BB defend (call) ranges ───────────────────────────────────────────────────
const BB_CALL_VS_BTN: Record<string, boolean> = {
  // Offsuit broadways & Ax
  'ATo':true,'A9o':true,'A8o':true,'A7o':true,'A6o':true,'A5o':true,'A4o':true,'A3o':true,'A2o':true,
  'KTo':true,'K9o':true,'K8o':true,'K7o':true,'K6o':true,
  'QTo':true,'Q9o':true,'Q8o':true,'Q7o':true,
  'JTo':true,'J9o':true,'J8o':true,'J7o':true,'J6o':true,
  'T9o':true,'T8o':true,'T7o':true,
  '98o':true,'97o':true,
  '87o':true,'76o':true,
  // Small suited
  'K4s':true,'K3s':true,'K2s':true,
  'Q6s':true,'Q5s':true,'Q4s':true,'Q3s':true,'Q2s':true,
  'J6s':true,'J5s':true,'J4s':true,'J3s':true,'J2s':true,
  'T5s':true,'T4s':true,'T3s':true,'T2s':true,
  '95s':true,'94s':true,'85s':true,'84s':true,'74s':true,'73s':true,'63s':true,'52s':true,'42s':true,'32s':true,
}

const BB_CALL_VS_CO: Record<string, boolean> = {
  'ATo':true,'A9o':true,'A8o':true,'A7o':true,'A6o':true,'A5o':true,'A4o':true,'A3o':true,'A2o':true,
  'KTo':true,'K9o':true,'K8o':true,'K7o':true,
  'QTo':true,'Q9o':true,'Q8o':true,
  'JTo':true,'J9o':true,'J8o':true,'J7o':true,
  'T9o':true,'T8o':true,'T7o':true,
  '98o':true,'97o':true,'87o':true,'76o':true,
  'Q5s':true,'Q4s':true,'Q3s':true,'J5s':true,'J4s':true,'T4s':true,'T3s':true,
  '95s':true,'85s':true,'84s':true,'74s':true,'63s':true,'53s':true,
}

const BB_CALL_VS_EP: Record<string, boolean> = {
  // vs UTG/HJ open — tighter
  'ATo':true,'A9o':true,'A8o':true,'A7o':true,'A6o':true,'A5o':true,'A4o':true,
  'KTo':true,'K9o':true,'K8o':true,
  'QTo':true,'Q9o':true,'Q8o':true,
  'JTo':true,'J9o':true,'J8o':true,
  'T9o':true,'T8o':true,'98o':true,'87o':true,
  'Q4s':true,'J4s':true,'T3s':true,'95s':true,'85s':true,'74s':true,
}

const SB_CALL_VS_BTN: Record<string, boolean> = {
  'ATo':true,'A9o':true,'A8o':true,
  'KTo':true,'K9o':true,
  'QTo':true,'Q9o':true,
  'JTo':true,'J9o':true,
  'T9o':true,'98o':true,
  'JTs':true,'T9s':true,'98s':true,'87s':true,'76s':true,
}

// ── Cold call ranges for non-BB/SB positions ──────────────────────────────────
// These cover IP cold calls (BTN/CO/HJ facing an open)
const COLD_CALL_VS_EP: Record<string, boolean> = {
  // IP positions can call with pocket pairs, suited broadways, suited connectors
  'TT':true,'99':true,'88':true,'77':true,'66':true,'55':true,
  'AJs':true,'ATs':true,'A9s':true,'A8s':true,'A7s':true,'A6s':true,'A5s':true,
  'KQs':true,'KJs':true,'KTs':true,'K9s':true,
  'QJs':true,'QTs':true,'Q9s':true,
  'JTs':true,'J9s':true,
  'T9s':true,'T8s':true,'98s':true,'87s':true,'76s':true,'65s':true,
  'AJo':true,'ATo':true,'A9o':true,
  'KQo':true,'KJo':true,'KTo':true,
  'QJo':true,'QTo':true,'JTo':true,
}

const COLD_CALL_VS_CO: Record<string, boolean> = {
  'TT':true,'99':true,'88':true,'77':true,'66':true,'55':true,'44':true,
  'AJs':true,'ATs':true,'A9s':true,'A8s':true,'A7s':true,'A6s':true,'A5s':true,'A4s':true,'A3s':true,
  'KQs':true,'KJs':true,'KTs':true,'K9s':true,'K8s':true,
  'QJs':true,'QTs':true,'Q9s':true,'Q8s':true,
  'JTs':true,'J9s':true,'J8s':true,
  'T9s':true,'T8s':true,'98s':true,'97s':true,'87s':true,'86s':true,'76s':true,'65s':true,'54s':true,
  'AJo':true,'ATo':true,'A9o':true,'A8o':true,
  'KQo':true,'KJo':true,'KTo':true,
  'QJo':true,'QTo':true,'JTo':true,
}

// ── 3-bet ranges ──────────────────────────────────────────────────────────────
const THREBET_RANGES: Record<string, Record<string, string>> = {
  'BTN_VS_CO': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'KQs':'R','QJs':'R','JTs':'R',
    'AKo':'R','AQo':'R','AJo':'R','KQo':'R',
    '99':'C','88':'C','77':'C','66':'C',
    'KJs':'C','KTs':'C','QTs':'C','T9s':'C','98s':'C','87s':'C',
    'ATo':'C','KJo':'C','KTo':'C','QJo':'C',
  },
  'BTN_VS_EP': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','AJs':'R','A5s':'R','A4s':'R','KQs':'R',
    'AKo':'R','AQo':'R','AJo':'R',
    'TT':'C','99':'C','88':'C','77':'C',
    'ATs':'C','KJs':'C','KTs':'C','QJs':'C','QTs':'C','JTs':'C',
    'ATo':'C','KQo':'C','KJo':'C',
  },
  'CO_VS_EP': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','AJs':'R','A5s':'R','A4s':'R','KQs':'R',
    'AKo':'R','AQo':'R','AJo':'R',
    'TT':'C','99':'C','88':'C',
    'ATs':'C','KJs':'C','QJs':'C','JTs':'C',
    'KQo':'C','KJo':'C',
  },
  'HJ_VS_EP': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','A5s':'R','KQs':'R',
    'AKo':'R','AQo':'R',
    'TT':'C','99':'C','88':'C',
    'AJs':'C','ATs':'C','KJs':'C','QJs':'C',
    'AJo':'C','KQo':'C',
  },
  'SB_VS_BTN': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'KQs':'R','QJs':'R','JTs':'R','T9s':'R',
    'AKo':'R','AQo':'R','AJo':'R','KQo':'R',
    '99':'C','88':'C','77':'C','66':'C',
    'KJs':'C','KTs':'C','QTs':'C','98s':'C','87s':'C','76s':'C',
  },
  'SB_VS_CO': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','AJs':'R','A5s':'R','A4s':'R','KQs':'R',
    'AKo':'R','AQo':'R','AJo':'R',
    'TT':'C','99':'C','88':'C','77':'C',
    'ATs':'C','KJs':'C','KTs':'C','QJs':'C','QTs':'C','JTs':'C',
    'KQo':'C','KJo':'C',
  },
  'SB_VS_EP': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','A5s':'R','KQs':'R',
    'AKo':'R','AQo':'R',
    'TT':'C','99':'C','88':'C',
    'AJs':'C','ATs':'C','KJs':'C','QJs':'C',
    'AJo':'C','KQo':'C',
  },
  'BB_VS_BTN': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R','TT':'R',
    'AKs':'R','AQs':'R','AJs':'R','ATs':'R','A5s':'R','A4s':'R','A3s':'R','A2s':'R',
    'KQs':'R','QJs':'R','JTs':'R','T9s':'R','98s':'R',
    'AKo':'R','AQo':'R','AJo':'R','KQo':'R',
    '99':'C','88':'C','77':'C','66':'C','55':'C',
    'KJs':'C','KTs':'C','QTs':'C','87s':'C','76s':'C','65s':'C',
    'KJo':'C','KTo':'C','QJo':'C',
  },
  'BB_VS_CO': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','AJs':'R','A5s':'R','A4s':'R','A3s':'R','KQs':'R',
    'AKo':'R','AQo':'R','AJo':'R',
    'TT':'C','99':'C','88':'C','77':'C','66':'C',
    'ATs':'C','A9s':'C','KJs':'C','KTs':'C','QJs':'C','QTs':'C','JTs':'C','T9s':'C',
    'KQo':'C','KJo':'C','QJo':'C',
  },
  'BB_VS_EP': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','AJs':'R','A5s':'R','A4s':'R','KQs':'R',
    'AKo':'R','AQo':'R','AJo':'R',
    'TT':'C','99':'C','88':'C','77':'C',
    'ATs':'C','A9s':'C','KJs':'C','KTs':'C','QJs':'C','JTs':'C','T9s':'C',
    'KQo':'C','KJo':'C',
  },
  'DEFAULT': {
    'AA':'R','KK':'R','QQ':'R','JJ':'R',
    'AKs':'R','AQs':'R','KQs':'R',
    'AKo':'R','AQo':'R',
    'TT':'C','99':'C','88':'C',
    'AJs':'C','ATs':'C','KJs':'C','QJs':'C',
    'KQo':'C','AJo':'C',
  },
}

const FOURBET_RANGE: Record<string, string> = {
  'AA':'R','KK':'R','QQ':'R','JJ':'R','AKs':'R','AKo':'R',
  'A5s':'R','A4s':'R','A3s':'R','A2s':'R',
  'TT':'C','99':'C','AQs':'C','KQs':'C','AQo':'C',
}

// ─────────────────────────────────────────────────────────────────────────────
// ポストフロップ ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

const HAND_RANK_SCORE: Record<string, number> = {
  'royal-flush':9,'straight-flush':8,'four-of-a-kind':7,'full-house':6,
  'flush':5,'straight':4,'three-of-a-kind':3,'two-pair':2,'one-pair':1,'high-card':0,
}

function madeHandStrength(player: Player, community: Card[]): number {
  const hole = player.holeCards
  if (!hole || hole.length < 2 || community.length === 0) return 0
  const c1 = hole[0]; const c2 = hole[1]
  if (!c1 || !c2) return 0
  try {
    const result = evaluateHand([c1, c2], community)
    return HAND_RANK_SCORE[result.rank] ?? 0
  } catch { return 0 }
}

function flushDrawOuts(hole: Card[], community: Card[]): number {
  if (community.length === 0) return 0
  const all = [...hole, ...community]
  const suitCount: Record<string, number> = {}
  for (const c of all) suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1
  const max = Math.max(...Object.values(suitCount))
  return max >= 4 ? 9 : 0
}

function straightDrawType(hole: Card[], community: Card[]): 'oesd' | 'gutshot' | 'none' {
  if (community.length === 0) return 'none'
  const all = [...hole, ...community]
  const vals = all.map(c => rankToValue(c.rank))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b)
  for (let i = 0; i <= vals.length - 4; i++) {
    const v = vals.slice(i, i + 4)
    if (v[3]! - v[0]! === 3) return 'oesd'
  }
  for (let i = 0; i <= vals.length - 4; i++) {
    const v = vals.slice(i, i + 4)
    if (v[3]! - v[0]! === 4) return 'gutshot'
  }
  return 'none'
}

function effectiveStrength(player: Player, community: Card[]): number {
  const hole = player.holeCards
  if (!hole || hole.length < 2) return 0
  const c1 = hole[0]; const c2 = hole[1]
  if (!c1 || !c2) return 0
  const made = madeHandStrength(player, community) / 9
  if (community.length === 0) return made
  const fdOuts = flushDrawOuts([c1, c2], community)
  const sdType = straightDrawType([c1, c2], community)
  const remaining = 52 - 2 - community.length
  let drawEquity = 0
  if (fdOuts >= 4) drawEquity += 9 / remaining
  if (sdType === 'oesd') drawEquity += 8 / remaining
  if (sdType === 'gutshot') drawEquity += 4 / remaining
  return Math.min(1.0, made + drawEquity * 0.8)
}

function isInPosition(player: Player, state: GameState): boolean {
  const n = state.players.length
  const myIdx = state.players.findIndex(p => p.id === player.id)
  if (myIdx === -1) return false
  const activePlayers = state.players.filter(p => !p.isFolded && !p.isAllIn)
  const maxDist = Math.max(...activePlayers.map(p => {
    const idx = state.players.findIndex(x => x.id === p.id)
    return (idx - state.dealerIndex + n) % n
  }))
  const distFromDealer = (myIdx - state.dealerIndex + n) % n
  return distFromDealer === maxDist
}

function isPreflopAggressor(player: Player, state: GameState): boolean {
  const raises = state.actionHistory.filter(
    a => a.action === 'raise' || a.action === 'all-in'
  )
  if (raises.length === 0) return false
  return raises[raises.length - 1]?.playerId === player.id
}

function requiredEquity(toCall: number, potSize: number): number {
  if (toCall <= 0) return 0
  return toCall / (potSize + toCall)
}

// ─────────────────────────────────────────────────────────────────────────────
// プリフロップ ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

function getPosition(playerIndex: number, dealerIndex: number, n: number): string {
  const rel = (playerIndex - dealerIndex + n) % n
  // 人数に応じてOPEN_RANGESのキーにマッピング
  if (n === 2) return rel === 0 ? 'BTN' : 'BB'
  if (n === 3) return (['BTN','SB','BB'] as string[])[rel] ?? 'BTN'
  // 4人: UTG→CO扱い（EP/MPなし）
  if (n === 4) {
    const p4 = ['BTN','SB','BB','CO'] as string[]
    return p4[rel] ?? 'BTN'
  }
  // 5人: UTG→HJ、HJ→CO扱い
  if (n === 5) {
    const p5 = ['BTN','SB','BB','CO','HJ'] as string[]
    return p5[rel] ?? 'BTN'
  }
  // 6人: 標準6max
  const p6 = ['BTN','SB','BB','UTG','HJ','CO'] as string[]
  return p6[rel % 6] ?? 'BTN'
}

/** Normalize rank to poker hand notation: '10' → 'T', others unchanged */
function normalizeRank(rank: string): string {
  return rank === '10' ? 'T' : rank
}

function handToKey(player: Player): string | null {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return null
  const c1 = cards[0]; const c2 = cards[1]
  if (!c1 || !c2) return null
  const v1 = rankToValue(c1.rank); const v2 = rankToValue(c2.rank)
  const hi = v1 >= v2 ? c1 : c2; const lo = v1 >= v2 ? c2 : c1
  const hiR = normalizeRank(hi.rank)
  const loR = normalizeRank(lo.rank)
  const suited = v1 === v2 ? '' : (hi.suit === lo.suit ? 's' : 'o')
  if (v1 === v2) return `${hiR}${loR}`
  return `${hiR}${loR}${suited}`
}

function countPreflopRaises(state: GameState): number {
  return state.actionHistory.filter(a => a.action === 'raise' || a.action === 'all-in').length
}

function getRaiserPosition(state: GameState): string {
  const raises = state.actionHistory.filter(a => a.action === 'raise' || a.action === 'all-in')
  if (raises.length === 0) return 'UTG'
  const last = raises[raises.length - 1]
  if (!last) return 'UTG'
  const idx = state.players.findIndex(p => p.id === last.playerId)
  if (idx === -1) return 'UTG'
  return getPosition(idx, state.dealerIndex, state.players.length)
}

function get3betRange(myPos: string, raiserPos: string): Record<string, string> {
  const key = `${myPos}_VS_${raiserPos}`
  if (key in THREBET_RANGES) return THREBET_RANGES[key]!
  const epPositions = ['UTG', 'HJ']
  if (epPositions.includes(raiserPos)) {
    return THREBET_RANGES[`${myPos}_VS_EP`] ?? THREBET_RANGES['DEFAULT']!
  }
  return THREBET_RANGES['DEFAULT']!
}


// リンパー数を検出（コールのみのアクション）
function countLimpers(state: GameState): number {
  return state.actionHistory.filter(
    a => a.action === 'call' && a.amount != null && a.amount <= state.bigBlind
  ).length
}

// リンパーが居るかどうか
function hasLimper(state: GameState): boolean {
  return countLimpers(state) > 0
}

function getOpenRaiseSize(myPos: string, bbSize: number, stackDepth: number, limperCount: number = 0): number {
  const spFactor = stackDepth < 20 ? 0.8 : 1.0
  const sizes: Record<string, number> = {
    'UTG': 2.5, 'HJ': 2.5, 'CO': 2.5, 'BTN': 2.2, 'SB': 3.0, 'BB': 3.0,
  }
  const baseMult = (sizes[myPos] ?? 2.5) * spFactor
  // ISOレイズ: 通常サイズ + リンパー数×1BB
  const isoBonus = limperCount * bbSize
  return Math.round(bbSize * baseMult + isoBonus)
}

function get3betSize(myPos: string, raiseAmount: number, potSize: number, bbSize: number): number {
  const ipPositions = ['BTN', 'CO']
  const isIP = ipPositions.includes(myPos)
  const mult = isIP ? 2.8 : 3.5
  return Math.round(Math.max(raiseAmount * mult, potSize * 0.75 + bbSize * 2))
}

function get4betSize(raise3bet: number, potSize: number): number {
  return Math.round(Math.max(raise3bet * 2.2, potSize * 0.45))
}

// ─────────────────────────────────────────────────────────────────────────────
// CFR戦略参照
// ─────────────────────────────────────────────────────────────────────────────

/** ホールカードを "AKs" / "72o" / "AA" 形式に変換 */
function toHandKey(c1: Card, c2: Card): string {
  const v1 = rankToValue(c1.rank)
  const v2 = rankToValue(c2.rank)
  const hi = v1 >= v2 ? c1 : c2
  const lo = v1 >= v2 ? c2 : c1
  const hiR = normalizeRank(hi.rank)
  const loR = normalizeRank(lo.rank)
  if (v1 === v2) return `${hiR}${loR}`
  return `${hiR}${loR}${hi.suit === lo.suit ? 's' : 'o'}`
}

/**
 * アクション履歴を "UTG_raise_HJ_fold_CO_call" 形式に変換する。
 * - SB/BBのポスト(blind post)はアクションとして含めない。
 * - playerIndex を渡すと、自分より前にアクションすべきプレイヤーで
 *   actionHistory に登場しないプレイヤーは fold として補完する。
 *   これにより、アクション履歴が空の HJ は "UTG_fold" を返す。
 */
function buildActionHistory(state: GameState, playerIndex?: number): string {
  const n = state.players.length

  // 実際のアクション履歴からsb/bbポストを除いたマップ (playerId → act) を構築
  const actedMap = new Map<string, string>()
  for (const a of state.actionHistory) {
    if ((a.action as string) === 'sb' || (a.action as string) === 'bb') continue
    const act = a.action === 'all-in' ? 'raise' : a.action
    // 同一プレイヤーの最後のアクションで上書き（raise後callなどは起きないがガード）
    actedMap.set(a.playerId, act)
  }

  if (playerIndex === undefined) {
    // playerIndex 未指定時: 従来通りアクション順に列挙
    const parts: string[] = []
    for (const a of state.actionHistory) {
      if ((a.action as string) === 'sb' || (a.action as string) === 'bb') continue
      const idx = state.players.findIndex(p => p.id === a.playerId)
      if (idx === -1) continue
      const pos = getPosition(idx, state.dealerIndex, n)
      const act = a.action === 'all-in' ? 'raise' : a.action
      parts.push(`${pos}_${act}`)
    }
    return parts.join('_')
  }

  // プリフロップの行動順: dealerの次(UTG相当)から時計回りに playerIndex の手前まで
  // rel=0はBTN、rel=3がUTG(6人卓)。行動順はrel=3→4→5→1→2→0(BTN最後)だが、
  // プリフロップはUTG(rel=3)が最初で BB(rel=2)が最後。
  // 行動順インデックス: seat i の行動順 = (i - dealerIndex - 1 + n) % n
  //   BTN(rel=0) → 行動順 n-1(最後), UTG(rel=3) → 行動順 2 など
  // 自分(playerIndex)より行動順が早いプレイヤーを列挙する
  const myOrder = (playerIndex - state.dealerIndex - 1 + n) % n

  // (seat_index, action_order) のペアを行動順でソート
  const seated = state.players.map((p, idx) => ({
    idx,
    id: p.id,
    order: (idx - state.dealerIndex - 1 + n) % n,
  })).filter(s => s.order < myOrder)
    .sort((a, b) => a.order - b.order)

  const parts: string[] = []
  for (const s of seated) {
    const pos = getPosition(s.idx, state.dealerIndex, n)
    const act = actedMap.get(s.id) ?? 'fold'
    parts.push(`${pos}_${act}`)
  }

  // UTG_NONE (自分がUTGで誰も行動していない) の場合は空文字列を返す → NONE扱い
  return parts.join('_')
}

/** CFR戦略テーブルを参照して混合戦略を返す。キー未発見時は null。*/
function getCFRStrategy(
  pos: string,
  actionHistory: string,
  handKey: string,
): { fold: number; call: number; raise: number } | null {
  const histPart = actionHistory.length > 0 ? actionHistory : 'NONE'
  const key = `${pos}_${histPart}_${handKey}`
  return CFR_STRATEGY[key] ?? null
}

/** CFR混合戦略からアクションをサンプリングする */
function sampleCFRAction(
  strat: { fold: number; call: number; raise: number },
  canCheck: boolean,
  canRaise: boolean,
): 'fold' | 'call' | 'raise' {
  let f = strat.fold
  let c = strat.call
  let r = strat.raise
  // raiseが不可能な場合: raise確率をfold:callの比率で按分してから再正規化
  if (!canRaise && r > 0) {
    const fc = f + c
    if (fc > 0) {
      f += r * (f / fc)
      c += r * (c / fc)
    } else {
      c += r  // fold=call=0 の極端なケース
    }
    r = 0
  }
  const total = f + c + r
  if (total <= 0) return canCheck ? 'call' : 'fold'
  const rnd = Math.random() * total
  if (rnd < f) return 'fold'
  if (rnd < f + c) return 'call'
  return 'raise'
}

function applyDifficulty(signal: string, difficulty: AiDifficulty): string {
  if (difficulty === 'easy') {
    if (signal === 'R' && Math.random() < 0.20) return 'F'
    if (signal === 'C' && Math.random() < 0.30) return 'F'
  } else if (difficulty === 'medium') {
    if (signal === 'R' && Math.random() < 0.08) return 'F'
    if (signal === 'C' && Math.random() < 0.12) return 'F'
  }
  return signal
}

function preflopAction(
  state: GameState, player: Player, difficulty: AiDifficulty
): { action: ActionType; amount?: number } | null {
  const playerIndex = state.players.findIndex(p => p.id === player.id)
  if (playerIndex === -1) return null
  const key = handToKey(player)
  if (!key) return null

  const raiseCount = countPreflopRaises(state)
  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const myPos = getPosition(playerIndex, state.dealerIndex, state.players.length)
  const potSize = state.pots.reduce((s, p) => s + p.amount, 0)
  const bbSize = state.bigBlind
  const stackDepth = player.chips / bbSize
  const raiserPos = getRaiserPosition(state)

  // ── CFR戦略テーブル参照 ──────────────────────────────────────────────────
  const cards = player.holeCards
  if (cards && cards.length >= 2 && cards[0] && cards[1]) {
    const handKey = toHandKey(cards[0], cards[1])
    const actionHist = buildActionHistory(state, playerIndex)
    const cfrStrat = getCFRStrategy(myPos, actionHist, handKey)
    if (cfrStrat !== null) {
      // difficultyによるノイズ: easy/mediumは少しランダム性を加える
      const noiseLevel = difficulty === 'easy' ? 0.25 : difficulty === 'medium' ? 0.10 : 0.0
      const noisedStrat = noiseLevel > 0
        ? {
            fold:  cfrStrat.fold  * (1 - noiseLevel) + noiseLevel / 3,
            call:  cfrStrat.call  * (1 - noiseLevel) + noiseLevel / 3,
            raise: cfrStrat.raise * (1 - noiseLevel) + noiseLevel / 3,
          }
        : cfrStrat
      const canRaise = raiseCount < 4
      const sampled = sampleCFRAction(noisedStrat, canCheck, canRaise)

      if (sampled === 'raise') {
        // raiseサイズはルールベースのサイジングを流用
        if (raiseCount === 0) {
          const limperCount = countLimpers(state)
          const raiseAmount = getOpenRaiseSize(myPos, bbSize, stackDepth, limperCount)
          const totalBet = state.currentBet + raiseAmount
          if (player.chips >= totalBet - player.currentBet) return { action: 'raise', amount: totalBet }
          return { action: 'all-in' }
        } else if (raiseCount === 1) {
          const betSize = get3betSize(myPos, state.currentBet, potSize, bbSize)
          if (player.chips >= betSize - player.currentBet) return { action: 'raise', amount: betSize }
          return { action: 'all-in' }
        } else if (raiseCount === 2) {
          const betSize = get4betSize(state.currentBet, potSize)
          if (player.chips <= betSize - player.currentBet || stackDepth < 25) return { action: 'all-in' }
          return { action: 'raise', amount: betSize }
        } else {
          // 4bet以上 → オールイン
          return { action: 'all-in' }
        }
      }
      if (sampled === 'call') {
        if (canCheck) return { action: 'check' }
        if (player.chips >= toCall) return { action: 'call' }
        return { action: 'all-in' }
      }
      // fold
      if (canCheck) return { action: 'check' }
      return { action: 'fold' }
    }
    // CFRキー未発見時はルールベースにフォールバック（以下処理）
  }

  const limperCount = countLimpers(state)
  const isLimpedPot = hasLimper(state) && raiseCount === 0

  if (raiseCount === 0) {
    const rangeMap = OPEN_RANGES[myPos] ?? {}
    const signal = rangeMap[key] ?? 'F'
    const resolved = applyDifficulty(signal, difficulty)
    if (resolved === 'R') {
      // リンパーがいる場合はISOサイズ（+1BB×リンパー数）
      const raiseAmount = getOpenRaiseSize(myPos, bbSize, stackDepth, limperCount)
      const totalBet = state.currentBet + raiseAmount
      if (player.chips >= totalBet - player.currentBet) return { action: 'raise', amount: totalBet }
      return { action: 'all-in' }
    }
    // リンパーポットでBBはチェック可能
    if (canCheck) return { action: 'check' }
    // リンパーポットでコール可能（コールレンジ: レンジ内またはBBディフェンス）
    if (isLimpedPot && myPos === 'BB' && toCall === 0) return { action: 'check' }
    if (myPos !== 'BB') return { action: 'fold' }
    return { action: 'check' }
  }

  if (raiseCount === 1) {
    const threeRange = get3betRange(myPos, raiserPos)
    const signal = threeRange[key] ?? 'F'

    // Select call range by position and raiser position
    const epPositions = ['UTG', 'HJ']
    const isRaiserEP = epPositions.includes(raiserPos)
    let callRange: Record<string, boolean> = {}
    if (myPos === 'BB') {
      if (raiserPos === 'BTN') callRange = BB_CALL_VS_BTN
      else if (raiserPos === 'CO') callRange = BB_CALL_VS_CO
      else callRange = BB_CALL_VS_EP
    } else if (myPos === 'SB') {
      if (raiserPos === 'BTN') callRange = SB_CALL_VS_BTN
      else callRange = {}  // SB vs EP/CO: mostly 3-bet or fold
    } else {
      // IP positions (CO, BTN, HJ): cold call range
      callRange = isRaiserEP ? COLD_CALL_VS_EP : COLD_CALL_VS_CO
    }

    const canCallFromRange = callRange[key] ?? false
    const resolved = applyDifficulty(signal, difficulty)
    if (resolved === 'R') {
      const betSize = get3betSize(myPos, state.currentBet, potSize, bbSize)
      if (player.chips >= betSize - player.currentBet) return { action: 'raise', amount: betSize }
      return { action: 'all-in' }
    }
    // ポットオッズ連動: openサイズが大きいほどコールレンジを絞る
    // 標準2.5BB openに対してコールレンジ係数1.0、5BB openなら0.6に絞る
    const openSizeInBB = state.currentBet / bbSize
    const callRangeFactor = Math.max(0.4, 1.0 - (openSizeInBB - 2.5) * 0.15)
    const shouldCall = (resolved === 'C' || canCallFromRange) && Math.random() < callRangeFactor
    if (shouldCall) {
      if (player.chips >= toCall) return { action: 'call' }
      return { action: 'all-in' }
    }
    if (canCheck) return { action: 'check' }
    return { action: 'fold' }
  }

  if (raiseCount === 2) {
    const signal = FOURBET_RANGE[key] ?? 'F'
    const resolved = applyDifficulty(signal, difficulty)
    if (resolved === 'R') {
      const betSize = get4betSize(state.currentBet, potSize)
      if (player.chips <= betSize - player.currentBet || stackDepth < 25) return { action: 'all-in' }
      return { action: 'raise', amount: betSize }
    }
    if (resolved === 'C') {
      if (stackDepth < 25) return { action: 'all-in' }
      if (player.chips >= toCall) return { action: 'call' }
      return { action: 'all-in' }
    }
    if (canCheck) return { action: 'check' }
    return { action: 'fold' }
  }

  const premiumKeys = ['AA','KK','QQ','AKs','AKo']
  if (premiumKeys.includes(key)) return { action: 'all-in' }
  if (stackDepth < 15 && toCall <= player.chips) return { action: 'call' }
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

// ─────────────────────────────────────────────────────────────────────────────
// ポストフロップ メイン
// ─────────────────────────────────────────────────────────────────────────────

// ── Postflop reasoning generator ─────────────────────────────────────────────

function handTierLabel(eq: number): string {
  if (eq > 0.75) return '強いメイドハンド'
  if (eq > 0.55) return 'トップペア以上'
  if (eq > 0.40) return 'ミドル〜ボトムペア'
  if (eq > 0.25) return 'ドロー/弱いハンド'
  return 'ブラフ域のウィークハンド'
}

function streetLabel(street: string): string {
  if (street === 'flop') return 'フロップ'
  if (street === 'turn') return 'ターン'
  if (street === 'river') return 'リバー'
  return street
}

function buildPostflopReasoning(
  action: ActionType,
  amount: number | undefined,
  eq: number,
  potSize: number,
  toCall: number,
  ip: boolean,
  aggressor: boolean,
  street: string,
  isBluff: boolean,
): string {
  const sl = streetLabel(street)
  const tierLabel = handTierLabel(eq)
  const eqPct = `${(eq * 100).toFixed(0)}%`
  const posLabel = ip ? 'IP(有利ポジション)' : 'OOP(不利ポジション)'
  const needed = toCall > 0 ? requiredEquity(toCall, potSize) : 0
  const neededPct = `${(needed * 100).toFixed(0)}%`

  switch (action) {
    case 'raise': {
      if (isBluff) {
        return `${sl}で${posLabel}からブラフベット。エクイティ${eqPct}でウィークハンドだが、フォールドエクイティを利用して攻める。ポットを取れる可能性がある。`
      }
      if (aggressor && street === 'flop') {
        return `${sl}でコンティニュエーションベット。プリフロップアグレッサーとして${eqPct}のエクイティを持ち${posLabel}からCベットで圧力をかける。`
      }
      return `${sl}で${tierLabel}(エクイティ${eqPct})。${posLabel}からバリューベット${amount != null ? `(${amount})` : ''}でポットを構築する。`
    }
    case 'all-in':
      return `${sl}で${tierLabel}(エクイティ${eqPct})。スタックを考慮してオールインで最大バリューを取る。`
    case 'call':
      return `${sl}で${tierLabel}(エクイティ${eqPct})。ポットオッズ必要エクイティ${neededPct}に対してエクイティが上回るためコール。`
    case 'check':
      return `${sl}で${tierLabel}(エクイティ${eqPct})。${posLabel}からチェックしてフリーカードを取るかチェックレイズを狙う。`
    case 'fold':
      return `${sl}で${tierLabel}(エクイティ${eqPct})。ポットオッズ必要エクイティ${neededPct}を下回るためフォールド。`
    default:
      return `${sl}でエクイティ${eqPct}を元に判断。`
  }
}

function postflopAction(
  state: GameState, player: Player, difficulty: AiDifficulty
): { action: ActionType; amount?: number; reasoning: string } {
  const toCall   = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const potSize  = state.pots.reduce((s, p) => s + p.amount, 0)
  const community = state.communityCards
  const street   = state.phase

  const eq        = effectiveStrength(player, community)
  const ip        = isInPosition(player, state)
  const aggressor = isPreflopAggressor(player, state)

  const aggMult = { 'easy': 0.7, 'medium': 1.0, 'hard': 1.25 }[difficulty]

  const makeResult = (action: ActionType, amount?: number, isBluff = false) => ({
    action,
    ...(amount != null ? { amount } : {}),
    reasoning: buildPostflopReasoning(action, amount, eq, potSize, toCall, ip, aggressor, street, isBluff),
  })

  if (canCheck) {
    const isCbet = aggressor && street === 'flop' && canCheck
    const cbetFreq = ip ? 0.70 * aggMult : 0.50 * aggMult
    const betThreshold = ip ? 0.30 * aggMult : 0.40 * aggMult
    const shouldBet = isCbet
      ? (eq > 0.20 && Math.random() < cbetFreq)
      : (eq > betThreshold)
    const bluffFreq = ip
      ? (difficulty === 'hard' ? 0.14 : difficulty === 'medium' ? 0.08 : 0.03)
      : (difficulty === 'hard' ? 0.08 : difficulty === 'medium' ? 0.04 : 0.01)
    const bluff = Math.random() < bluffFreq && eq < 0.25

    if (shouldBet || bluff) {
      const potFrac = eq > 0.7
        ? (0.65 + Math.random() * 0.35)
        : eq > 0.45
        ? (0.45 + Math.random() * 0.25)
        : (0.25 + Math.random() * 0.20)
      const streetMult = street === 'flop' ? 1.0 : street === 'turn' ? 1.15 : 1.3
      const betAmount = Math.max(Math.round(potSize * potFrac * streetMult), state.minRaise)
      if (player.chips >= betAmount) return makeResult('raise', state.currentBet + betAmount, bluff && !shouldBet)
      return makeResult('all-in')
    }
    return makeResult('check')
  }

  const needed = requiredEquity(toCall, potSize)
  if (eq < needed * 0.75) return makeResult('fold')

  const raiseThreshold = ip ? 0.55 * aggMult : 0.65 * aggMult
  const bluffRaiseFreq = difficulty === 'hard' ? 0.10 : difficulty === 'medium' ? 0.05 : 0.02
  const isBluffRaise = Math.random() < bluffRaiseFreq && eq < 0.25

  if (eq > raiseThreshold || isBluffRaise) {
    const potFrac = eq > 0.70
      ? (0.65 + Math.random() * 0.35)
      : eq > 0.45
      ? (0.45 + Math.random() * 0.25)
      : (0.30 + Math.random() * 0.20)
    const streetMult = street === 'flop' ? 1.0 : street === 'turn' ? 1.15 : 1.3
    const raiseAmount = Math.round(state.currentBet * 2.5 + potSize * potFrac * streetMult)
    if (player.chips >= raiseAmount - player.currentBet) return makeResult('raise', raiseAmount, isBluffRaise)
    return makeResult('all-in')
  }

  if (eq >= needed) {
    if (player.chips >= toCall) return makeResult('call')
    return makeResult('all-in')
  }

  return makeResult('fold')
}

// ─────────────────────────────────────────────────────────────────────────────
// エントリポイント
// ─────────────────────────────────────────────────────────────────────────────

export function decideAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty = 'medium',
): { action: ActionType; amount?: number; reasoning: string } {
  if (state.phase === 'preflop') {
    const result = preflopAction(state, player, difficulty)
    if (result) return { ...result, reasoning: '' }
  }
  return postflopAction(state, player, difficulty)
}
