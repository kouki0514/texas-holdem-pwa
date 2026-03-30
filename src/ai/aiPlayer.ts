import type { ActionType, GameState, Player, Card } from '@/game/types'
import { rankToValue } from '@/game/deck'
import { evaluateHand } from '@/game/handEvaluator'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ── オープンレンジ ─────────────────────────────────────────
const OPEN_RANGES: Record<string, Record<string, string>> = {
  BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M', KQo:'R',KJo:'R',KTo:'R',K9o:'M', QJs:'R',QTs:'R',Q9s:'R', QJo:'R',QTo:'R', JTs:'R',J9s:'R', JTo:'R', T9s:'R',T8s:'R', '98s':'R','87s':'R','76s':'R','65s':'R','54s':'M' },
  CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'M',A5s:'R',A4s:'M',A3s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'R', QJs:'R',QTs:'R',Q9s:'R', QJo:'R', JTs:'R',J9s:'R', T9s:'R','98s':'R','87s':'M','76s':'M' },
  HJ:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'M',55:'M',44:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'M', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  UTG: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'M',66:'M',55:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'M',A5s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'M', KQs:'R',KJs:'R',KTs:'M', KQo:'R',KJo:'M', QJs:'R',QTs:'M', JTs:'R' },
  SB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  BB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'M', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M','76s':'M','65s':'M','54s':'M' },
}

// ── オープンレイズへのコールレンジ（フラット）────────────────
// R=3bet, C=call, F=fold
const CALL_VS_OPEN: Record<string, Record<string, string>> = {
  // BTNオープンに対するBBのレスポンス
  BB_vs_BTN: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
    AKs:'R',AQs:'R',AJs:'R',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
    AKo:'R',AQo:'R',AJo:'C',ATo:'C',A9o:'C',A8o:'C',
    KQs:'C',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',K6s:'C',
    KQo:'C',KJo:'C',KTo:'C',K9o:'C',
    QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',
    QJo:'C',QTo:'C',
    JTs:'C',J9s:'C',J8s:'C',
    JTo:'C',
    T9s:'C',T8s:'C',T7s:'C',
    '98s':'C','97s':'C','87s':'C','86s':'C','76s':'C','75s':'C','65s':'C','64s':'C','54s':'C',
  },
  // COオープンに対するBTNのレスポンス
  BTN_vs_CO: {
    AA:'R',KK:'R',QQ:'R',JJ:'C',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
    AKs:'R',AQs:'R',AJs:'C',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
    AKo:'R',AQo:'C',AJo:'C',ATo:'C',
    KQs:'C',KJs:'C',KTs:'C',K9s:'C',K8s:'C',
    KQo:'C',KJo:'C',
    QJs:'C',QTs:'C',Q9s:'C',
    JTs:'C',J9s:'C',
    T9s:'C',T8s:'C',
    '98s':'C','87s':'C','76s':'C','65s':'C',
  },
  // デフォルト（その他ポジション）
  DEFAULT: {
    AA:'R',KK:'R',QQ:'R',JJ:'C',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
    AKs:'R',AQs:'R',AJs:'C',ATs:'C',A9s:'C',A5s:'C',A4s:'C',
    AKo:'R',AQo:'C',AJo:'C',
    KQs:'C',KJs:'C',KTs:'C',
    KQo:'C',
    QJs:'C',QTs:'C',
    JTs:'C',
    T9s:'C',
    '98s':'C','87s':'C','76s':'C',
  },
}

// ── 3betに対するコールレンジ ───────────────────────────────
const CALL_VS_3BET: Record<string, string> = {
  QQ:'C',JJ:'C',TT:'C',99:'C',
  AKs:'C',AQs:'C',AJs:'C',
  AKo:'C',
  KQs:'C',
}

// ── 3betレンジ ────────────────────────────────────────────

// ── 4betレンジ ────────────────────────────────────────────
const FOURBET_RANGES: Record<string, string> = {
  AA:'R',KK:'R',QQ:'M',
  AKs:'R',AKo:'R',
  A5s:'M',A4s:'M',
}

// ── ハンドランク → スコア ──────────────────────────────────
const HAND_RANK_SCORE: Record<string, number> = {
  'royal-flush':90,'straight-flush':80,'four-of-a-kind':70,
  'full-house':60,'flush':50,'straight':40,
  'three-of-a-kind':30,'two-pair':20,'one-pair':10,'high-card':0,
}

function postflopStrength(player: Player, communityCards: Card[]): number {
  const hole = player.holeCards
  if (!hole || hole.length < 2 || communityCards.length === 0) return 0
  const c1 = hole[0]; const c2 = hole[1]
  if (!c1 || !c2) return 0
  const result = evaluateHand([c1, c2], communityCards)
  const base = HAND_RANK_SCORE[result.rank] ?? 0
  const kickerBonus = result.kickers.length > 0 ? (result.kickers[0] ?? 0) / 14 * 9 : 0
  return base + kickerBonus
}

function getPosition(playerIndex: number, dealerIndex: number, n: number): string {
  const rel = (playerIndex - dealerIndex + n) % n
  if (n === 2) return rel === 0 ? 'BTN' : 'BB'
  if (n === 3) return (['BTN','SB','BB'][rel]) ?? 'BTN'
  if (n === 4) return (['BTN','SB','BB','UTG'][rel]) ?? 'BTN'
  if (n === 5) return (['BTN','SB','BB','UTG','HJ'][rel]) ?? 'BTN'
  return (['BTN','SB','BB','UTG','HJ','CO'][rel % 6]) ?? 'BTN'
}

function handToKey(player: Player): string | null {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return null
  const c1 = cards[0]; const c2 = cards[1]
  if (!c1 || !c2) return null
  const v1 = rankToValue(c1.rank); const v2 = rankToValue(c2.rank)
  const high = v1 >= v2 ? c1 : c2; const low = v1 >= v2 ? c2 : c1
  if (high.rank === low.rank) return `${high.rank}${high.rank}`
  return high.suit === low.suit ? `${high.rank}${low.rank}s` : `${high.rank}${low.rank}o`
}

function countPreflopRaises(state: GameState): number {
  return state.actionHistory.filter(a => a.action === 'raise' || a.action === 'all-in').length
}

// レイザーのポジションを取得
function getRaiserPosition(state: GameState): string | null {
  const raises = state.actionHistory.filter(a => a.action === 'raise' || a.action === 'all-in')
  if (raises.length === 0) return null
  const lastRaise = raises[raises.length - 1]
  if (!lastRaise) return null
  const raiserIndex = state.players.findIndex(p => p.id === lastRaise.playerId)
  if (raiserIndex === -1) return null
  return getPosition(raiserIndex, state.dealerIndex, state.players.length)
}

function resolveSignal(signal: string, difficulty: AiDifficulty): string {
  if (signal !== 'M') return signal
  if (difficulty === 'easy') return 'F'
  return Math.random() < (difficulty === 'hard' ? 0.55 : 0.35) ? 'R' : 'C'
}

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
  const myPos    = getPosition(playerIndex, state.dealerIndex, state.players.length)

  let rangeMap: Record<string, string>

  if (raiseCount === 0) {
    // オープン
    rangeMap = OPEN_RANGES[myPos] ?? {}
  } else if (raiseCount === 1) {
    // オープンレイズへの対応: 3betかコールかフォールド
    const raiserPos = getRaiserPosition(state)
    const key2 = `${myPos}_vs_${raiserPos}`
    rangeMap = CALL_VS_OPEN[key2] ?? CALL_VS_OPEN['DEFAULT'] ?? {}
  } else {
    // 3betへの対応: 4betかコールかフォールド
    const combined: Record<string, string> = { ...CALL_VS_3BET, ...FOURBET_RANGES }
    rangeMap = combined
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
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

function postflopAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty
): { action: ActionType; amount?: number } {
  const toCall   = state.currentBet - player.currentBet
  const canCheck = toCall === 0
  const potSize  = state.pots.reduce((s, p) => s + p.amount, 0)
  const strength = postflopStrength(player, state.communityCards)

  const t = {
    easy:   { bet: 65, call: 35, checkRaise: 80 },
    medium: { bet: 55, call: 25, checkRaise: 75 },
    hard:   { bet: 45, call: 18, checkRaise: 70 },
  }[difficulty]

  const bluff = difficulty === 'hard' && Math.random() < 0.07

  if (bluff || strength >= t.bet) {
    if (canCheck) {
      if (strength >= t.checkRaise && Math.random() < 0.3) return { action: 'check' }
      const betAmount = Math.round(potSize * (0.5 + Math.random() * 0.3))
      const raiseAmount = state.currentBet + Math.max(betAmount, state.minRaise)
      if (player.chips >= raiseAmount) return { action: 'raise', amount: raiseAmount }
      return { action: 'all-in' }
    } else {
      const raiseAmount = Math.round(state.currentBet * 2.5 + state.minRaise)
      if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
      return { action: 'all-in' }
    }
  }
  if (strength >= t.call || canCheck) {
    return canCheck ? { action: 'check' } : { action: 'call' }
  }
  if (canCheck) return { action: 'check' }
  return { action: 'fold' }
}

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
