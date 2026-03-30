import type { ActionType, GameState, Player, Card } from '@/game/types'
import { rankToValue } from '@/game/deck'
import { evaluateHand } from '@/game/handEvaluator'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ══════════════════════════════════════════════════════════
// 50BB レーキなし 6max プリフロップレンジ
// R=raise/open, C=call, M=mixed, F=fold
// ══════════════════════════════════════════════════════════

// ── オープンレンジ (RFI) ───────────────────────────────────
const OPEN_RANGES: Record<string, Record<string, string>> = {
  UTG: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'M',66:'M',55:'M',44:'M',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'M',A7s:'M',A6s:'M',A5s:'R',A4s:'M',A3s:'M',A2s:'M',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M',
    KQs:'R',KJs:'R',KTs:'R',K9s:'M',K8s:'M',K7s:'M',K6s:'M',
    KQo:'R',KJo:'R',KTo:'R',K9o:'M',
    QJs:'R',QTs:'R',Q9s:'M',Q8s:'M',
    QJo:'R',QTo:'M',
    JTs:'R',J9s:'M',J8s:'M',
    JTo:'M',
    T9s:'R',T8s:'M',
    '98s':'M','87s':'M','76s':'M',
  },
  HJ: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'M',55:'M',44:'M',33:'M',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'M',A6s:'M',A5s:'R',A4s:'M',A3s:'M',A2s:'M',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'M',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'M',K7s:'M',K6s:'M',
    KQo:'R',KJo:'R',KTo:'R',K9o:'M',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'M',
    QJo:'R',QTo:'M',
    JTs:'R',J9s:'R',J8s:'M',
    JTo:'M',
    T9s:'R',T8s:'M',T7s:'M',
    '98s':'R','97s':'M','87s':'M','76s':'M','65s':'M',
  },
  CO: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'M',A2s:'M',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'M',A7o:'M',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M',K6s:'M',K5s:'M',
    KQo:'R',KJo:'R',KTo:'R',K9o:'R',K8o:'M',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'M',Q7s:'M',
    QJo:'R',QTo:'R',Q9o:'M',
    JTs:'R',J9s:'R',J8s:'M',J7s:'M',
    JTo:'R',J9o:'M',
    T9s:'R',T8s:'R',T7s:'M',
    '98s':'R','97s':'M','96s':'M','87s':'R','86s':'M','76s':'R','75s':'M','65s':'M','54s':'M',
  },
  BTN: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'R',A6o:'M',A5o:'M',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'R',K6s:'R',K5s:'R',K4s:'M',K3s:'M',K2s:'M',
    KQo:'R',KJo:'R',KTo:'R',K9o:'R',K8o:'M',K7o:'M',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'R',Q7s:'M',Q6s:'M',
    QJo:'R',QTo:'R',Q9o:'R',Q8o:'M',
    JTs:'R',J9s:'R',J8s:'R',J7s:'M',J6s:'M',
    JTo:'R',J9o:'R',J8o:'M',
    T9s:'R',T8s:'R',T7s:'R',T6s:'M',
    T9o:'M',
    '98s':'R','97s':'R','96s':'M','87s':'R','86s':'R','85s':'M','76s':'R','75s':'M','65s':'R','64s':'M','54s':'R','53s':'M','43s':'M',
  },
  SB: {
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'M',22:'M',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'M',A2s:'M',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'M',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M',K6s:'M',
    KQo:'R',KJo:'R',KTo:'R',K9o:'M',
    QJs:'R',QTs:'R',Q9s:'R',Q8s:'M',
    QJo:'R',QTo:'M',
    JTs:'R',J9s:'R',J8s:'M',
    JTo:'M',
    T9s:'R',T8s:'M',
    '98s':'R','87s':'M','76s':'M','65s':'M',
  },
  BB: {
    // BBはオープンしない（他のポジションのオープンに対してdefend）
    AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R',
    AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R',
    AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',
    KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',
    KQo:'R',KJo:'R',KTo:'R',
    QJs:'R',QTs:'R',Q9s:'R',
    QJo:'R',
    JTs:'R',J9s:'R',
    T9s:'R','98s':'R','87s':'R','76s':'R',
  },
}

// ── vs オープンレイズ レスポンス ───────────────────────────
// 50BB レーキなし: コール頻度が高い
// R=3bet, C=call, F=fold

// BTN vs CO open
const BTN_VS_CO: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'C',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'R',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
  AKo:'R',AQo:'C',AJo:'C',ATo:'C',A9o:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',
  KQo:'C',KJo:'C',KTo:'C',
  QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',
  QJo:'C',QTo:'C',
  JTs:'C',J9s:'C',J8s:'C',
  JTo:'C',
  T9s:'C',T8s:'C',T7s:'C',
  '98s':'C','97s':'C','87s':'C','86s':'C','76s':'C','75s':'C','65s':'C','64s':'C','54s':'C',
}

// BTN vs HJ/UTG open (tighter)
const BTN_VS_EP: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'C',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'C',ATs:'C',A9s:'C',A8s:'C',A5s:'R',A4s:'C',A3s:'C',
  AKo:'R',AQo:'C',AJo:'C',ATo:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',
  KQo:'C',KJo:'C',
  QJs:'C',QTs:'C',Q9s:'C',
  JTs:'C',J9s:'C',
  T9s:'C',T8s:'C',
  '98s':'C','87s':'C','76s':'C','65s':'C',
}

// CO vs HJ/UTG open
const CO_VS_EP: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'C',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',
  AKs:'R',AQs:'R',AJs:'C',ATs:'C',A9s:'C',A5s:'R',A4s:'C',
  AKo:'R',AQo:'C',AJo:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',
  KQo:'C',KJo:'C',
  QJs:'C',QTs:'C',
  JTs:'C',J9s:'C',
  T9s:'C',
  '98s':'C','87s':'C','76s':'C',
}

// SB vs 各ポジション（BTNまで全員fold）
const SB_VS_BTN: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
  AKo:'R',AQo:'R',AJo:'C',ATo:'C',A9o:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',
  KQo:'C',KJo:'C',KTo:'C',
  QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',
  QJo:'C',QTo:'C',
  JTs:'C',J9s:'C',J8s:'C',
  T9s:'C',T8s:'C',
  '98s':'C','87s':'C','76s':'C','65s':'C',
}

// BB vs 各ポジション（最広のdefendレンジ）
const BB_VS_BTN: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'R',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
  AKo:'R',AQo:'R',AJo:'C',ATo:'C',A9o:'C',A8o:'C',A7o:'C',A6o:'C',A5o:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',K6s:'C',K5s:'C',K4s:'C',K3s:'C',K2s:'C',
  KQo:'C',KJo:'C',KTo:'C',K9o:'C',K8o:'C',K7o:'C',
  QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',Q7s:'C',Q6s:'C',
  QJo:'C',QTo:'C',Q9o:'C',Q8o:'C',
  JTs:'C',J9s:'C',J8s:'C',J7s:'C',J6s:'C',
  JTo:'C',J9o:'C',J8o:'C',
  T9s:'C',T8s:'C',T7s:'C',T6s:'C',
  T9o:'C',T8o:'C',
  '98s':'C','97s':'C','96s':'C','87s':'C','86s':'C','85s':'C',
  '76s':'C','75s':'C','65s':'C','64s':'C','54s':'C','53s':'C','43s':'C',
}

const BB_VS_CO: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'R',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A6s:'C',A5s:'R',A4s:'C',A3s:'C',A2s:'C',
  AKo:'R',AQo:'R',AJo:'C',ATo:'C',A9o:'C',A8o:'C',A7o:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',K6s:'C',K5s:'C',
  KQo:'C',KJo:'C',KTo:'C',K9o:'C',K8o:'C',
  QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',Q7s:'C',
  QJo:'C',QTo:'C',Q9o:'C',
  JTs:'C',J9s:'C',J8s:'C',J7s:'C',
  JTo:'C',J9o:'C',
  T9s:'C',T8s:'C',T7s:'C',
  T9o:'C',
  '98s':'C','97s':'C','87s':'C','86s':'C','76s':'C','75s':'C','65s':'C','54s':'C',
}

const BB_VS_EP: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'C',99:'C',88:'C',77:'C',66:'C',55:'C',44:'C',33:'C',22:'C',
  AKs:'R',AQs:'R',AJs:'R',ATs:'C',A9s:'C',A8s:'C',A7s:'C',A5s:'R',A4s:'C',A3s:'C',
  AKo:'R',AQo:'R',AJo:'C',ATo:'C',A9o:'C',A8o:'C',
  KQs:'R',KJs:'C',KTs:'C',K9s:'C',K8s:'C',K7s:'C',
  KQo:'C',KJo:'C',KTo:'C',K9o:'C',
  QJs:'C',QTs:'C',Q9s:'C',Q8s:'C',
  QJo:'C',QTo:'C',
  JTs:'C',J9s:'C',J8s:'C',
  JTo:'C',
  T9s:'C',T8s:'C',
  '98s':'C','87s':'C','76s':'C','65s':'C','54s':'C',
}

// vs 3bet レスポンス（4betかコールかフォールド）
const VS_3BET: Record<string, string> = {
  AA:'R',KK:'R',QQ:'C',JJ:'C',TT:'C',99:'C',
  AKs:'R',AQs:'C',AJs:'C',ATs:'C',A5s:'R',A4s:'R',
  AKo:'R',AQo:'C',
  KQs:'C',KJs:'C',
  QJs:'C',
}

// ──────────────────────────────────────────────────────────

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

function getRaiserPosition(state: GameState): string {
  const raises = state.actionHistory.filter(a => a.action === 'raise' || a.action === 'all-in')
  if (raises.length === 0) return 'UTG'
  const last = raises[raises.length - 1]
  if (!last) return 'UTG'
  const idx = state.players.findIndex(p => p.id === last.playerId)
  if (idx === -1) return 'UTG'
  return getPosition(idx, state.dealerIndex, state.players.length)
}

function resolveSignal(signal: string, difficulty: AiDifficulty): string {
  if (signal !== 'M') return signal
  if (difficulty === 'easy') return 'F'
  return Math.random() < (difficulty === 'hard' ? 0.6 : 0.4) ? 'R' : 'F'
}

function getResponseRange(myPos: string, raiserPos: string): Record<string, string> {
  if (myPos === 'BB') {
    if (raiserPos === 'BTN' || raiserPos === 'SB') return BB_VS_BTN
    if (raiserPos === 'CO') return BB_VS_CO
    return BB_VS_EP
  }
  if (myPos === 'SB') return SB_VS_BTN
  if (myPos === 'BTN') {
    if (raiserPos === 'CO') return BTN_VS_CO
    return BTN_VS_EP
  }
  if (myPos === 'CO') return CO_VS_EP
  return CO_VS_EP
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
    rangeMap = OPEN_RANGES[myPos] ?? {}
  } else if (raiseCount === 1) {
    const raiserPos = getRaiserPosition(state)
    rangeMap = getResponseRange(myPos, raiserPos)
  } else {
    rangeMap = VS_3BET
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
    }
    const raiseAmount = Math.round(state.currentBet * 2.5 + state.minRaise)
    if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
    return { action: 'all-in' }
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
