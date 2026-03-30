import type { ActionType, GameState, Player, Card } from '@/game/types'
import { rankToValue } from '@/game/deck'
import { evaluateHand } from '@/game/handEvaluator'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ── Open raise レンジ ──────────────────────────────────────
const OPEN_RANGES: Record<string, Record<string, string>> = {
  BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M', KQo:'R',KJo:'R',KTo:'R',K9o:'M', QJs:'R',QTs:'R',Q9s:'R', QJo:'R',QTo:'R', JTs:'R',J9s:'R', JTo:'R', T9s:'R',T8s:'R', '98s':'R','87s':'R','76s':'R','65s':'R','54s':'M' },
  CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'M',A5s:'R',A4s:'M',A3s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'R', QJs:'R',QTs:'R',Q9s:'R', QJo:'R', JTs:'R',J9s:'R', T9s:'R','98s':'R','87s':'M','76s':'M' },
  HJ:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'M',55:'M',44:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'M', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  UTG: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'M',66:'M',55:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'M',A5s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'M', KQs:'R',KJs:'R',KTs:'M', KQo:'R',KJo:'M', QJs:'R',QTs:'M', JTs:'R' },
  SB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  BB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'M', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M','76s':'M','65s':'M','54s':'M' },
}

// ── 3bet レンジ ────────────────────────────────────────────
const THREEBET_RANGES: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'M',TT:'M',
  AKs:'R',AQs:'R',AJs:'M',A5s:'M',A4s:'M',
  AKo:'R',AQo:'M',
  KQs:'M',
}

// ── 4bet レンジ ────────────────────────────────────────────
const FOURBET_RANGES: Record<string, string> = {
  AA:'R',KK:'R',QQ:'M',
  AKs:'R',AKo:'R',
  A5s:'M',A4s:'M',
}

// ── ハンドランク → 数値スコア ──────────────────────────────
const HAND_RANK_SCORE: Record<string, number> = {
  'royal-flush':    100,
  'straight-flush':  90,
  'four-of-a-kind':  80,
  'full-house':      70,
  'flush':           60,
  'straight':        50,
  'three-of-a-kind': 40,
  'two-pair':        30,
  'one-pair':        20,
  'high-card':       10,
}

// ── ポストフロップ ハンド強度（0〜100）─────────────────────
function postflopStrength(player: Player, communityCards: Card[]): number {
  const hole = player.holeCards
  if (!hole || hole.length < 2) return 0
  const c1 = hole[0]
  const c2 = hole[1]
  if (!c1 || !c2) return 0
  if (communityCards.length === 0) return 0

  const result = evaluateHand([c1, c2], communityCards)
  const base = HAND_RANK_SCORE[result.rank] ?? 0

  // ナッツ度合いをkickersで微調整（最大10点）
  const kickerBonus = result.kickers.length > 0
    ? (result.kickers[0] ?? 0) / 14 * 10
    : 0

  return base + kickerBonus
}

// ── ポジション計算 ─────────────────────────────────────────
function getPosition(playerIndex: number, dealerIndex: number, n: number): string {
  const rel = (playerIndex - dealerIndex + n) % n
  if (n === 2) return rel === 0 ? 'BTN' : 'BB'
  if (n === 3) return (['BTN','SB','BB'][rel]) ?? 'BTN'
  if (n === 4) return (['BTN','SB','BB','UTG'][rel]) ?? 'BTN'
  if (n === 5) return (['BTN','SB','BB','UTG','HJ'][rel]) ?? 'BTN'
  return (['BTN','SB','BB','UTG','HJ','CO'][rel % 6]) ?? 'BTN'
}

// ── ホールカード → レンジキー ──────────────────────────────
function handToKey(player: Player): string | null {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return null
  const c1 = cards[0]; const c2 = cards[1]
  if (!c1 || !c2) return null
  const v1 = rankToValue(c1.rank); const v2 = rankToValue(c2.rank)
  const high = v1 >= v2 ? c1 : c2
  const low  = v1 >= v2 ? c2 : c1
  if (high.rank === low.rank) return `${high.rank}${high.rank}`
  return high.suit === low.suit
    ? `${high.rank}${low.rank}s`
    : `${high.rank}${low.rank}o`
}

// ── プリフロップ レイズ回数 ────────────────────────────────
function countPreflopRaises(state: GameState): number {
  return state.actionHistory.filter(
    a => a.action === 'raise' || a.action === 'all-in'
  ).length
}

function resolveSignal(signal: string, difficulty: AiDifficulty): string {
  if (signal !== 'M') return signal
  if (difficulty === 'easy') return 'F'
  return Math.random() < (difficulty === 'hard' ? 0.55 : 0.35) ? 'R' : 'F'
}

// ── プリフロップ判断 ───────────────────────────────────────
function preflopAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty
): { action: ActionType; amount?: number } | null {
  const playerIndex = state.players.findIndex(p => p.id === player.id)
  if (playerIndex === -1) return null
  const key = handToKey(player)
  if (!key) return null

  const raiseCount = countPreflopRaises(state)
  const toCall   = state.currentBet - player.currentBet
  const canCheck = toCall === 0

  let rangeMap: Record<string, string>
  if (raiseCount === 0) {
    const pos = getPosition(playerIndex, state.dealerIndex, state.players.length)
    rangeMap = OPEN_RANGES[pos] ?? {}
  } else if (raiseCount === 1) {
    rangeMap = THREEBET_RANGES
  } else {
    rangeMap = FOURBET_RANGES
  }

  const signal   = rangeMap[key] ?? 'F'
  const resolved = resolveSignal(signal, difficulty)

  if (resolved === 'R') {
    const mult = raiseCount === 0 ? 2.5 : 3
    const raiseAmount = Math.round(state.currentBet * mult + state.minRaise)
    if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
    return { action: 'all-in' }
  }
  if (resolved === 'C') {
    if (canCheck) return { action: 'check' }
    if (player.chips >= toCall) return { action: 'call' }
    return { action: 'all-in' }
  }
  // F
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

// ── ポストフロップ判断 ─────────────────────────────────────
function postflopAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty
): { action: ActionType; amount?: number } {
  const toCall   = state.currentBet - player.currentBet
  const canCheck = toCall === 0
  const potSize  = state.pots.reduce((s, p) => s + p.amount, 0)

  const strength = postflopStrength(player, state.communityCards)

  // 難易度別閾値
  const t = {
    easy:   { bet: 65, call: 40, checkRaise: 80 },
    medium: { bet: 55, call: 30, checkRaise: 75 },
    hard:   { bet: 45, call: 22, checkRaise: 70 },
  }[difficulty]

  // ブラフ（hardのみ）
  const bluff = difficulty === 'hard' && Math.random() < 0.07

  // ナッツ〜強いハンド: ベット/レイズ
  if (bluff || strength >= t.bet) {
    if (canCheck) {
      // チェックレイズ狙いでたまにチェック
      if (strength >= t.checkRaise && Math.random() < 0.3) {
        return { action: 'check' }
      }
      const betAmount = Math.round(potSize * (0.5 + Math.random() * 0.3))
      const raiseAmount = state.currentBet + Math.max(betAmount, state.minRaise)
      if (player.chips >= raiseAmount) return { action: 'raise', amount: raiseAmount }
      return { action: 'all-in' }
    } else {
      // レイズ
      const raiseAmount = Math.round(state.currentBet * 2.5 + state.minRaise)
      if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
      return { action: 'all-in' }
    }
  }

  // 中程度のハンド: コール/チェック
  if (strength >= t.call || canCheck) {
    return canCheck ? { action: 'check' } : { action: 'call' }
  }

  // 弱いハンド: フォールド
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

// ── メイン ────────────────────────────────────────────────
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
