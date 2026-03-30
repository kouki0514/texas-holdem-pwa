import type { ActionType, GameState, Player } from '@/game/types'
import { rankToValue } from '@/game/deck'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// ── Open raise レンジ ──────────────────────────────────────
const OPEN_RANGES: Record<string, Record<string, string>> = {
  BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M', KQo:'R',KJo:'R',KTo:'R',K9o:'M', QJs:'R',QTs:'R',Q9s:'R', QJo:'R',QTo:'R', JTs:'R',J9s:'R', JTo:'R', T9s:'R',T8s:'R', '98s':'R','87s':'R','76s':'R','65s':'R','54s':'M' },
  CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'M',A5s:'R',A4s:'M',A3s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'R', QJs:'R',QTs:'R',Q9s:'R', QJo:'R', JTs:'R',J9s:'R', T9s:'R','98s':'R','87s':'M','76s':'M' },
  HJ:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'M',55:'M',44:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'M', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  UTG: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'M',66:'M',55:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'M',A5s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'M', KQs:'R',KJs:'R',KTs:'M', KQo:'R',KJo:'M', QJs:'R',QTs:'M', JTs:'R' },
  SB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M' },
  BB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'M', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M','76s':'M' },
}

// ── 3bet レンジ（open raiseに対してre-raise）────────────────
const THREEBET_RANGES: Record<string, string> = {
  AA:'R',KK:'R',QQ:'R',JJ:'M',TT:'M',
  AKs:'R',AQs:'R',AJs:'M',A5s:'M',A4s:'M',
  AKo:'R',AQo:'M',
  KQs:'M',
}

// ── 4bet レンジ（3betに対してre-raise）─────────────────────
const FOURBET_RANGES: Record<string, string> = {
  AA:'R',KK:'R',QQ:'M',
  AKs:'R',AKo:'R',
  A5s:'M',A4s:'M', // bluff 4bet
}

// ──────────────────────────────────────────────────────────

function getPosition(playerIndex: number, dealerIndex: number, totalPlayers: number): string {
  const n = totalPlayers
  const relative = (playerIndex - dealerIndex + n) % n
  if (n === 2) return relative === 0 ? 'BTN' : 'BB'
  if (n === 3) return (['BTN','SB','BB'][relative]) ?? 'BTN'
  if (n === 4) return (['BTN','SB','BB','UTG'][relative]) ?? 'BTN'
  if (n === 5) return (['BTN','SB','BB','UTG','HJ'][relative]) ?? 'BTN'
  return (['BTN','SB','BB','UTG','HJ','CO'][relative % 6]) ?? 'BTN'
}

function handToKey(player: Player): string | null {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return null
  const c1 = cards[0]
  const c2 = cards[1]
  if (!c1 || !c2) return null
  const v1 = rankToValue(c1.rank)
  const v2 = rankToValue(c2.rank)
  const high = v1 >= v2 ? c1 : c2
  const low  = v1 >= v2 ? c2 : c1
  if (high.rank === low.rank) return `${high.rank}${high.rank}`
  return high.suit === low.suit
    ? `${high.rank}${low.rank}s`
    : `${high.rank}${low.rank}o`
}

// プリフロップで何回raiseが入っているか数える
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
  const toCall  = state.currentBet - player.currentBet
  const canCheck = toCall === 0

  // レンジ選択
  let rangeMap: Record<string, string>
  if (raiseCount === 0) {
    // オープン: ポジション別レンジ
    const position = getPosition(playerIndex, state.dealerIndex, state.players.length)
    rangeMap = OPEN_RANGES[position] ?? {}
  } else if (raiseCount === 1) {
    // 3bet レンジ
    rangeMap = THREEBET_RANGES
  } else {
    // 4bet+ レンジ
    rangeMap = FOURBET_RANGES
  }

  const signal = rangeMap[key] ?? 'F'
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

function preflopStrength(player: Player): number {
  const cards = player.holeCards
  if (!cards || cards.length < 2) return 0
  const c1 = cards[0]
  const c2 = cards[1]
  if (!c1 || !c2) return 0
  const v1 = rankToValue(c1.rank)
  const v2 = rankToValue(c2.rank)
  const isPair   = c1.rank === c2.rank
  const isSuited = c1.suit === c2.suit
  const high = Math.max(v1, v2)
  const low  = Math.min(v1, v2)
  let score = high + low * 0.5
  if (isPair)   score += 10
  if (isSuited) score += 2
  if (high - low <= 2) score += 1
  return score
}

export function decideAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty = 'medium',
): { action: ActionType; amount?: number } {
  const toCall   = state.currentBet - player.currentBet
  const canCheck = toCall === 0

  if (state.phase === 'preflop') {
    const result = preflopAction(state, player, difficulty)
    if (result) return result
  }

  const strength = preflopStrength(player)
  const thresholds = {
    easy:   { raise: 28, call: 20 },
    medium: { raise: 24, call: 18 },
    hard:   { raise: 20, call: 15 },
  }[difficulty]

  const bluff = difficulty === 'hard' && Math.random() < 0.08

  if (bluff || strength >= thresholds.raise) {
    const raiseAmount = state.currentBet + state.minRaise * (1 + Math.floor(Math.random() * 3))
    if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
    return { action: 'all-in' }
  }
  if (strength >= thresholds.call || canCheck) {
    return canCheck ? { action: 'check' } : { action: 'call' }
  }
  return { action: 'fold' }
}
