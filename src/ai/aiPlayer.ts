import type { ActionType, GameState, Player } from '@/game/types'
import { rankToValue } from '@/game/deck'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

const PREFLOP_RANGES: Record<string, Record<string, string>> = {
  BTN: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R',A7o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R',K8s:'R',K7s:'M', KQo:'R',KJo:'R',KTo:'R',K9o:'M', QJs:'R',QTs:'R',Q9s:'R', QJo:'R',QTo:'R', JTs:'R',J9s:'R', JTo:'R', T9s:'R',T8s:'R', '98s':'R','87s':'R','76s':'R','65s':'R','54s':'M' },
  CO:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'M',A5s:'R',A4s:'M',A3s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'R', QJs:'R',QTs:'R',Q9s:'R', QJo:'R', JTs:'R',J9s:'R', T9s:'R','98s':'R','87s':'M','76s':'M','65s':'M' },
  HJ:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'M',55:'M',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'M', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M' },
  UTG: { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'M',66:'M',55:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'M',A5s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'M', KQs:'R',KJs:'R',KTs:'M', KQo:'R',KJo:'M', QJs:'R',QTs:'M', JTs:'R', T9s:'M' },
  SB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'M',33:'M',22:'M', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'M',A5s:'R',A4s:'M', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'M', KQs:'R',KJs:'R',KTs:'R', KQo:'R',KJo:'R', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M','76s':'M' },
  BB:  { AA:'R',KK:'R',QQ:'R',JJ:'R',TT:'R',99:'R',88:'R',77:'R',66:'R',55:'R',44:'R',33:'R',22:'R', AKs:'R',AQs:'R',AJs:'R',ATs:'R',A9s:'R',A8s:'R',A7s:'R',A6s:'R',A5s:'R',A4s:'R',A3s:'R',A2s:'R', AKo:'R',AQo:'R',AJo:'R',ATo:'R',A9o:'R',A8o:'R', KQs:'R',KJs:'R',KTs:'R',K9s:'R', KQo:'R',KJo:'R',KTo:'M', QJs:'R',QTs:'R', JTs:'R', T9s:'R','98s':'M','87s':'M','76s':'M','65s':'M','54s':'M' },
}

// ディーラーインデックスとプレイヤーインデックスからポジション名を計算
function getPosition(playerIndex: number, dealerIndex: number, totalPlayers: number): string {
  const n = totalPlayers
  const relative = (playerIndex - dealerIndex + n) % n
  if (n === 2) return relative === 0 ? 'BTN' : 'BB'
  if (n === 3) { return ['BTN','SB','BB'][relative] ?? 'BTN' }
  if (n === 4) { return ['BTN','SB','BB','UTG'][relative] ?? 'BTN' }
  if (n === 5) { return ['BTN','SB','BB','UTG','HJ'][relative] ?? 'BTN' }
  // 6人以上
  const map = ['BTN','SB','BB','UTG','HJ','CO']
  return map[relative % map.length] ?? 'BTN'
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
  const isPair   = high.rank === low.rank
  const isSuited = high.suit === low.suit
  if (isPair) return `${high.rank}${high.rank}`
  return isSuited ? `${high.rank}${low.rank}s` : `${high.rank}${low.rank}o`
}

function preflopAction(
  state: GameState,
  player: Player,
  difficulty: AiDifficulty
): { action: ActionType; amount?: number } | null {
  const playerIndex = state.players.findIndex(p => p.id === player.id)
  if (playerIndex === -1) return null
  const position = getPosition(playerIndex, state.dealerIndex, state.players.length)
  const range = PREFLOP_RANGES[position]
  if (!range) return null
  const key = handToKey(player)
  if (!key) return null
  const signal = range[key] ?? 'F'
  const toCall   = state.currentBet - player.currentBet
  const canCheck = toCall === 0

  const resolvedSignal = signal === 'M'
    ? (difficulty === 'easy' ? 'F' : Math.random() < (difficulty === 'hard' ? 0.6 : 0.4) ? 'R' : 'C')
    : signal

  if (resolvedSignal === 'R') {
    const raiseAmount = state.currentBet + state.minRaise * (1 + Math.floor(Math.random() * 2))
    if (player.chips >= raiseAmount - player.currentBet) return { action: 'raise', amount: raiseAmount }
    return { action: 'all-in' }
  }
  if (resolvedSignal === 'C') {
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
