import type { ActionType, GameState, Player, Card } from '@/game/types'
import { rankToValue } from '@/game/deck'
import { evaluateHand } from '@/game/handEvaluator'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ─────────────────────────────────────────────────────────────────────────────
// 6max プリフロップレンジ (R=raise/3bet, C=call, F=fold)
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_RANGES: Record<string, Record<string, string>> = {
  UTG: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',KQo:'R',KJo:'R',KTo:'R',
    QJs:'R',QTs:'R',Q9s:'R',QJo:'R',QTo:'R',
    JTs:'R',J9s:'R',JTo:'R',T9s:'R',T8s:'R',98s:'R',87s:'R',76s:'R',65s:'R',54s:'R' },
  HJ: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',KQo:'R',KJo:'R',KTo:'R',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',QJo:'R',QTo:'R',
    JTs:'R',J9s:'R',J8s:'R',JTo:'R',T9s:'R',T8s:'R',T7s:'R',98s:'R',97s:'R',87s:'R',86s:'R',76s:'R',75s:'R',65s:'R',64s:'R',54s:'R',53s:'R' },
  CO: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',K6s:'R',KQo:'R',KJo:'R',KTo:'R',K9o:'R',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',Q7s:'R',QJo:'R',QTo:'R',Q9o:'R',
    JTs:'R',J9s:'R',J8s:'R',J7s:'R',JTo:'R',J9o:'R',
    T9s:'R',T8s:'R',T7s:'R',T6s:'R',T9o:'R',98s:'R',97s:'R',96s:'R',87s:'R',86s:'R',76s:'R',75s:'R',65s:'R',64s:'R',54s:'R',53s:'R',43s:'R' },
  BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'R',A6o:'R',A5o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',K6s:'R',K5s:'R',KQo:'R',KJo:'R',KTo:'R',K9o:'R',K8o:'R',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',Q7s:'R',Q6s:'R',QJo:'R',QTo:'R',Q9o:'R',Q8o:'R',
    JTs:'R',J9s:'R',J8s:'R',J7s:'R',J6s:'R',JTo:'R',J9o:'R',J8o:'R',
    T9s:'R',T8s:'R',T7s:'R',T6s:'R',T5s:'R',T9o:'R',T8o:'R',
    98s:'R',97s:'R',96s:'R',95s:'R',87s:'R',86s:'R',85s:'R',76s:'R',75s:'R',74s:'R',65s:'R',64s:'R',54s:'R',53s:'R',43s:'R',42s:'R',32s:'R' },
  SB: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',KQo:'R',KJo:'R',KTo:'R',K9o:'R',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',QJo:'R',QTo:'R',Q9o:'R',
    JTs:'R',J9s:'R',J8s:'R',JTo:'R',J9o:'R',
    T9s:'R',T8s:'R',T7s:'R',T9o:'R',98s:'R',97s:'R',87s:'R',86s:'R',76s:'R',75s:'R',65s:'R',54s:'R' },
  BB: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R','99':'R','88':'R','77':'R','66':'R','55':'R','44':'R','33':'R','22':'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'R',A6o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',K6s:'R',KQo:'R',KJo:'R',KTo:'R',K9o:'R',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',Q7s:'R',QJo:'R',QTo:'R',Q9o:'R',
    JTs:'R',J9s:'R',J8s:'R',J7s:'R',JTo:'R',J9o:'R',
    T9s:'R',T8s:'R',T7s:'R',T6s:'R',T9o:'R',T8o:'R',
    98s:'R',97s:'R',96s:'R',87s:'R',86s:'R',76s:'R',75s:'R',65s:'R',64s:'R',54s:'R',53s:'R',43s:'R' },
}

// BBのコールレンジ（vs BTNスチール）
const BB_CALL_VS_BTN: Record<string, boolean> = {
  A9o:true,A8o:true,A7o:true,A6o:true,A5o:true,A4o:true,A3o:true,A2o:true,
  K9o:true,K8o:true,K7o:true,K6o:true,K5o:true,
  Q9o:true,Q8o:true,Q7o:true,Q6o:true,
  J9o:true,J8o:true,J7o:true,
  T8o:true,T7o:true,T6o:true,
  98o:true,97o:true,96o:true,
  87o:true,86o:true,76o:true,75o:true,65o:true,
  K4s:true,K3s:true,K2s:true,Q6s:true,Q5s:true,Q4s:true,Q3s:true,Q2s:true,
  J6s:true,J5s:true,J4s:true,J3s:true,J2s:true,
  T5s:true,T4s:true,T3s:true,T2s:true,
  95s:true,94s:true,85s:true,84s:true,74s:true,73s:true,63s:true,52s:true,42s:true,32s:true,
}

// BBのコールレンジ（vs CO/SB）
const BB_CALL_VS_OTHER: Record<string, boolean> = {
  A8o:true,A7o:true,A6o:true,A5o:true,A4o:true,A3o:true,A2o:true,
  K8o:true,K7o:true,K6o:true,K5o:true,
  Q8o:true,Q7o:true,Q6o:true,
  J8o:true,J7o:true,T7o:true,T6o:true,
  97o:true,87o:true,76o:true,65o:true,
}

// SBのコールレンジ（vs BTN）
const SB_CALL_VS_BTN: Record<string, boolean> = {
  JTs:true,T9s:true,98s:true,87s:true,
  ATo:true,KTo:true,QTo:true,JTo:true,
}

// 3betレンジ（ポジション別）
const THREBET_RANGES: Record<string, Record<string, string>> = {
  BTN_VS_CO: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',AKs:'R',AQs:'R',AJs:'R',ATs:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',KQs:'R',QJs:'R',JTs:'R',AKo:'R',AQo:'R',KQo:'R',
    '99':'C','88':'C','77':'C',AJo:'C',ATo:'C',KJs:'C',KTs:'C',QTs:'C',T9s:'C',98s:'C' },
  BTN_VS_EP: { AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AQs:'R',A5s:'R',A4s:'R',KQs:'R',AKo:'R',AQo:'R',
    TT:'C','99':'C',AJs:'C',ATs:'C',KJs:'C',QJs:'C',JTs:'C' },
  CO_VS_EP:  { AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AQs:'R',A5s:'R',A4s:'R',KQs:'R',AKo:'R',AQo:'R',
    TT:'C','99':'C',AJs:'C',KJs:'C',QJs:'C' },
  SB_VS_BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',AKs:'R',AQs:'R',AJs:'R',ATs:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',KQs:'R',QJs:'R',JTs:'R',AKo:'R',AQo:'R',AJo:'R',KQo:'R',
    '99':'C','88':'C','77':'C',KJs:'C',KTs:'C',QTs:'C',T9s:'C',98s:'C' },
  SB_VS_CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AQs:'R',AJs:'R',A5s:'R',A4s:'R',KQs:'R',AKo:'R',AQo:'R',
    TT:'C','99':'C',ATs:'C',KJs:'C',QJs:'C' },
  BB_VS_BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',AKs:'R',AQs:'R',AJs:'R',ATs:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',KQs:'R',QJs:'R',JTs:'R',T9s:'R',AKo:'R',AQo:'R',AJo:'R',KQo:'R',
    '99':'C','88':'C','77':'C','66':'C',KJs:'C',KTs:'C',QTs:'C',98s:'C',87s:'C' },
  BB_VS_CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AQs:'R',AJs:'R',A5s:'R',A4s:'R',KQs:'R',AKo:'R',AQo:'R',
    TT:'C','99':'C',ATs:'C',KJs:'C',QJs:'C' },
  BB_VS_EP:  { AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AQs:'R',A5s:'R',KQs:'R',AKo:'R',AQo:'R',
    TT:'C','99':'C',AJs:'C',KJs:'C' },
  DEFAULT:   { AA:'R',KK:'R',QQ:'R',AKs:'R',AKo:'R' },
}

// 4betレンジ（vs 3bet）
const FOURBET_RANGE: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'R',AKs:'R',AKo:'R',
  // ブラフ4bet（ブロッカー価値）
  A5s:'R',A4s:'R',A3s:'R',A2s:'R',
  // コール
  TT:'C','99':'C',AQs:'C',KQs:'C',AQo:'C',
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
  if (n === 2) return rel === 0 ? 'BTN' : 'BB'
  if (n === 3) return (['BTN','SB','BB'] as string[])[rel] ?? 'BTN'
  if (n === 4) return (['BTN','SB','BB','UTG'] as string[])[rel] ?? 'BTN'
  if (n === 5) return (['BTN','SB','BB','UTG','HJ'] as string[])[rel] ?? 'BTN'
  return (['BTN','SB','BB','UTG','HJ','CO'] as string[])[rel % 6] ?? 'BTN'
}

function handToKey(player: Player): string | null {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return null
  const c1 = cards[0]; const c2 = cards[1]
  if (!c1 || !c2) return null
  const v1 = rankToValue(c1.rank); const v2 = rankToValue(c2.rank)
  const hi = v1 >= v2 ? c1 : c2; const lo = v1 >= v2 ? c2 : c1
  const suited = hi.rank === lo.rank ? '' : (hi.suit === lo.suit ? 's' : 'o')
  if (hi.rank === lo.rank) return `${hi.rank}${lo.rank}`
  return `${hi.rank}${lo.rank}${suited}`
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
  // EP同士、HJ vs UTG等はDEFAULT
  const epPositions = ['UTG', 'HJ']
  if (epPositions.includes(raiserPos)) {
    return THREBET_RANGES[`${myPos}_VS_EP`] ?? THREBET_RANGES['DEFAULT']!
  }
  return THREBET_RANGES['DEFAULT']!
}

// ポジション別の適切なopenraiseサイズ（BB単位）
function getOpenRaiseSize(myPos: string, bbSize: number, stackDepth: number): number {
  // スタックが浅い場合は小さく
  const spFactor = stackDepth < 20 ? 0.8 : 1.0
  const sizes: Record<string, number> = {
    UTG: 2.5, HJ: 2.5, CO: 2.5, BTN: 2.2, SB: 3.0, BB: 3.0,
  }
  const mult = (sizes[myPos] ?? 2.5) * spFactor
  return Math.round(bbSize * mult)
}

// 3betサイズ（IPは小さく、OOPは大きく）
function get3betSize(myPos: string, raiseAmount: number, potSize: number, bbSize: number): number {
  const ipPositions = ['BTN', 'CO']
  const isIP = ipPositions.includes(myPos)
  // IP: 約2.5〜3x、OOP: 約3〜4x
  const mult = isIP ? 2.8 : 3.5
  return Math.round(Math.max(raiseAmount * mult, potSize * 0.75 + bbSize * 2))
}

// 4betサイズ
function get4betSize(raise3bet: number, potSize: number): number {
  return Math.round(Math.max(raise3bet * 2.2, potSize * 0.45))
}

// difficultyによるミス率（レンジ外アクション頻度）
function applyDifficulty(signal: string, difficulty: AiDifficulty): string {
  if (difficulty === 'easy') {
    // easyはミスが多い：Rを20%の確率でF、Cを30%の確率でF
    if (signal === 'R' && Math.random() < 0.20) return 'F'
    if (signal === 'C' && Math.random() < 0.30) return 'F'
  } else if (difficulty === 'medium') {
    // mediumは少しミス：Rを8%でF、Cを12%でF
    if (signal === 'R' && Math.random() < 0.08) return 'F'
    if (signal === 'C' && Math.random() < 0.12) return 'F'
  }
  // hard: ミスなし（ほぼGTO通り）
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
  const stackDepth = player.chips / bbSize  // BB単位のスタック深さ
  const raiserPos = getRaiserPosition(state)

  // ── オープン（誰もレイズしていない）──────────────────────────
  if (raiseCount === 0) {
    const rangeMap = OPEN_RANGES[myPos] ?? {}
    const signal = rangeMap[key] ?? 'F'
    const resolved = applyDifficulty(signal, difficulty)
    if (resolved === 'R') {
      const raiseAmount = getOpenRaiseSize(myPos, bbSize, stackDepth)
      const totalBet = state.currentBet + raiseAmount
      if (player.chips >= totalBet - player.currentBet) {
        return { action: 'raise', amount: totalBet }
      }
      return { action: 'all-in' }
    }
    if (canCheck) return { action: 'check' }
    // BB以外はFoldのみ（limperはなし）
    if (myPos !== 'BB') return { action: 'fold' }
    // BBはBBを払っているので check か fold
    return { action: 'check' }
  }

  // ── 3bet（1回レイズ済み）────────────────────────────────────
  if (raiseCount === 1) {
    const threeRange = get3betRange(myPos, raiserPos)
    const signal = threeRange[key] ?? 'F'

    // BBのコールレンジ追加
    let callRange: Record<string, boolean> = {}
    if (myPos === 'BB') {
      callRange = raiserPos === 'BTN' ? BB_CALL_VS_BTN : BB_CALL_VS_OTHER
    } else if (myPos === 'SB' && raiserPos === 'BTN') {
      callRange = SB_CALL_VS_BTN
    }
    const canCallFromRange = callRange[key] ?? false

    const resolved = applyDifficulty(signal, difficulty)

    if (resolved === 'R') {
      const betSize = get3betSize(myPos, state.currentBet, potSize, bbSize)
      if (player.chips >= betSize - player.currentBet) {
        return { action: 'raise', amount: betSize }
      }
      return { action: 'all-in' }
    }
    if (resolved === 'C' || canCallFromRange) {
      if (player.chips >= toCall) return { action: 'call' }
      return { action: 'all-in' }
    }
    if (canCheck) return { action: 'check' }
    return { action: 'fold' }
  }

  // ── 4bet（2回レイズ済み）────────────────────────────────────
  if (raiseCount === 2) {
    const signal = FOURBET_RANGE[key] ?? 'F'
    const resolved = applyDifficulty(signal, difficulty)

    if (resolved === 'R') {
      const betSize = get4betSize(state.currentBet, potSize)
      // スタック < 4betサイズならオールイン
      if (player.chips <= betSize - player.currentBet || stackDepth < 25) {
        return { action: 'all-in' }
      }
      return { action: 'raise', amount: betSize }
    }
    if (resolved === 'C') {
      // スタックが浅い（<25BB）場合はコールよりオールイン推奨
      if (stackDepth < 25) return { action: 'all-in' }
      if (player.chips >= toCall) return { action: 'call' }
      return { action: 'all-in' }
    }
    if (canCheck) return { action: 'check' }
    return { action: 'fold' }
  }

  // ── 5bet以降（オールインスポット）─────────────────────────────
  const premiumKeys = ['AA','KK','QQ','AKs','AKo']
  if (premiumKeys.includes(key)) return { action: 'all-in' }
  // スタックが浅ければコール
  if (stackDepth < 15 && toCall <= player.chips) return { action: 'call' }
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

// ─────────────────────────────────────────────────────────────────────────────
// ポストフロップ メイン
// ─────────────────────────────────────────────────────────────────────────────

function postflopAction(
  state: GameState, player: Player, difficulty: AiDifficulty
): { action: ActionType; amount?: number } {
  const toCall   = Math.max(0, state.currentBet - player.currentBet)
  const canCheck = toCall === 0
  const potSize  = state.pots.reduce((s, p) => s + p.amount, 0)
  const community = state.communityCards
  const street   = state.phase // 'flop' | 'turn' | 'river'

  const eq       = effectiveStrength(player, community)
  const ip       = isInPosition(player, state)
  const aggressor = isPreflopAggressor(player, state)

  // difficulty別アグレッション係数
  const aggMult = { easy: 0.7, medium: 1.0, hard: 1.25 }[difficulty]

  // ── チェック判断 ────────────────────────────────────────────
  if (canCheck) {
    // Cbet: プリフロップアグレッサーがフロップでベット
    const isCbet = aggressor && street === 'flop' && canCheck
    const cbetFreq = ip ? 0.70 * aggMult : 0.50 * aggMult

    // ベット/チェック閾値（IP有利）
    const betThreshold = ip ? 0.30 * aggMult : 0.40 * aggMult
    const shouldBet = isCbet
      ? (eq > 0.20 && Math.random() < cbetFreq)
      : (eq > betThreshold)

    // ブラフ（低エクイティでもたまにベット）
    const bluffFreq = ip
      ? (difficulty === 'hard' ? 0.14 : difficulty === 'medium' ? 0.08 : 0.03)
      : (difficulty === 'hard' ? 0.08 : difficulty === 'medium' ? 0.04 : 0.01)
    const bluff = Math.random() < bluffFreq && eq < 0.25

    if (shouldBet || bluff) {
      // ベットサイズ: エクイティと状況に応じて変動
      const potFrac = eq > 0.7
        ? (0.65 + Math.random() * 0.35)   // ナッツ: 65-100% pot
        : eq > 0.45
        ? (0.45 + Math.random() * 0.25)   // 中強度: 45-70% pot
        : (0.25 + Math.random() * 0.20)   // ブラフ/弱: 25-45% pot

      // ストリートによりサイズ調整（ターン/リバーは大きく）
      const streetMult = street === 'flop' ? 1.0 : street === 'turn' ? 1.15 : 1.3
      const betAmount = Math.max(
        Math.round(potSize * potFrac * streetMult),
        state.minRaise
      )
      if (player.chips >= betAmount) return { action: 'raise', amount: state.currentBet + betAmount }
      return { action: 'all-in' }
    }
    return { action: 'check' }
  }

  // ── コール/レイズ/フォールド判断 ───────────────────────────
  const needed = requiredEquity(toCall, potSize)

  // エクイティがポットオッズを大幅に下回る場合フォールド
  if (eq < needed * 0.75) return { action: 'fold' }

  // レイズ/レイズ判断
  const raiseThreshold = ip ? 0.55 * aggMult : 0.65 * aggMult
  const bluffRaiseFreq = difficulty === 'hard' ? 0.10 : difficulty === 'medium' ? 0.05 : 0.02

  if (eq > raiseThreshold || (Math.random() < bluffRaiseFreq && eq < 0.25)) {
    const potFrac = eq > 0.70
      ? (0.65 + Math.random() * 0.35)
      : eq > 0.45
      ? (0.45 + Math.random() * 0.25)
      : (0.30 + Math.random() * 0.20)
    const streetMult = street === 'flop' ? 1.0 : street === 'turn' ? 1.15 : 1.3
    const raiseAmount = Math.round(state.currentBet * 2.5 + potSize * potFrac * streetMult)
    if (player.chips >= raiseAmount - player.currentBet) {
      return { action: 'raise', amount: raiseAmount }
    }
    return { action: 'all-in' }
  }

  // コール（ポットオッズが合う場合）
  if (eq >= needed) {
    if (player.chips >= toCall) return { action: 'call' }
    return { action: 'all-in' }
  }

  return { action: 'fold' }
}

// ─────────────────────────────────────────────────────────────────────────────
// エントリポイント
// ─────────────────────────────────────────────────────────────────────────────

export function decideAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty = 'medium',
): { action: ActionType; amount?: number } {
  if (state.phase === 'preflop') {
    const result = preflopAction(state, player, difficulty)
    if (result) return result
  }
  return postflopAction(state, player, difficulty)
}
