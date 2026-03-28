import type { Server, Socket } from 'socket.io'
import { config } from './config'
import { claudeDecideAction } from './claudeServer'
import {
  deleteRoom,
  getRoomBySocket,
  toPublicPlayer,
} from './roomManager'
import type {
  ClaudeReasoningPayload,
  PlayerLeftPayload,
  ServerPlayer,
  ServerRoom,
} from './types'
import { decideAction } from '@/ai/aiPlayer'
import {
  advanceToNextStreet,
  applyAction,
  createInitialState,
  isHandOver,
  isStreetOver,
  resolveShowdown,
  startHand,
} from '@/game/gameEngine'
import type { ActionType, Card, GameState, Player } from '@/game/types'

// ──────────────────────────────────────────────────────────────────────────────
// Hole card filtering — opponents see only face-down placeholders
// ──────────────────────────────────────────────────────────────────────────────

const HIDDEN_CARD: Card = { suit: 'spades', rank: '2', faceUp: false }

function filterPlayer(player: Player, viewerId: string): Player {
  if (player.id === viewerId) return player

  const cards = player.holeCards as Card[]
  // At showdown, all cards are faceUp = true → reveal them
  if (cards.length > 0 && cards.every((c) => c.faceUp)) return player

  return {
    ...player,
    holeCards: cards.map(() => ({ ...HIDDEN_CARD })) as [Card, Card] | [],
  }
}

function filterState(state: GameState, viewerId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) => filterPlayer(p, viewerId)),
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Broadcasting helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Send each connected human player their own filtered view of the game state.
 * Bots have no socket — skip them.
 */
export function broadcastState(io: Server, room: ServerRoom): void {
  if (!room.gameState) return

  for (const sp of room.players) {
    if (sp.isBot || !sp.connected) continue
    const socket = io.sockets.sockets.get(sp.socketId)
    if (!socket) continue
    socket.emit('game-state', filterState(room.gameState, sp.id))
  }
}

function broadcastToRoom(io: Server, roomCode: string, event: string, data: unknown): void {
  io.to(roomCode).emit(event, data)
}

// ──────────────────────────────────────────────────────────────────────────────
// Build GameState.Player[] from server room
// ──────────────────────────────────────────────────────────────────────────────

function makeGamePlayers(room: ServerRoom): Player[] {
  return room.players.map((sp): Player => ({
    id: sp.id,
    name: sp.name,
    chips: config.startingChips,
    holeCards: [] as unknown as [Card, Card],
    position: null,
    isHuman: !sp.isBot,
    isFolded: false,
    isAllIn: false,
    currentBet: 0,
    totalBetThisHand: 0,
    isDealer: false,
    isTurn: false,
  }))
}

// ──────────────────────────────────────────────────────────────────────────────
// Action processing
// ──────────────────────────────────────────────────────────────────────────────

function applyAndAdvance(state: GameState): GameState {
  // State has already had applyAction called — resolve transitions
  if (isHandOver(state)) return resolveShowdown(state)
  if (isStreetOver(state)) return advanceToNextStreet(state)
  return state
}

export function processPlayerAction(
  io: Server,
  room: ServerRoom,
  actorId: string,
  action: ActionType,
  amount?: number,
): boolean {
  if (!room.gameState) return false

  const idx = room.gameState.activePlayerIndex
  if (idx === -1) return false

  const actor = room.gameState.players[idx]
  if (actor.id !== actorId) return false
  if (actor.isFolded || actor.isAllIn) return false

  let next = applyAction(room.gameState, action, amount)
  next = applyAndAdvance(next)

  room.gameState = next
  room.lastActivityAt = Date.now()

  broadcastState(io, room)

  // If showdown just happened, also broadcast winner info
  if (next.phase === 'showdown') {
    broadcastToRoom(io, room.code, 'showdown-result', {
      winners: next.winners,
      players: next.players.map((p) => ({ id: p.id, name: p.name, holeCards: p.holeCards, rank: undefined })),
    })
    // Schedule next hand
    setTimeout(() => startNextHand(io, room), 4_000)
    return true
  }

  scheduleAiTurn(io, room)
  return true
}

// ──────────────────────────────────────────────────────────────────────────────
// Game lifecycle
// ──────────────────────────────────────────────────────────────────────────────

export function startGame(io: Server, room: ServerRoom): boolean {
  if (room.phase !== 'lobby') return false
  if (room.players.length < config.minPlayersToStart) return false

  const gamePlayers = makeGamePlayers(room)
  const initial = createInitialState(gamePlayers, config.bigBlind)
  room.gameState = startHand(initial)
  room.phase = 'playing'
  room.lastActivityAt = Date.now()

  broadcastToRoom(io, room.code, 'game-started', {
    players: room.players.map((sp) => toPublicPlayer(sp, room.hostPlayerId)),
  })
  broadcastState(io, room)
  scheduleAiTurn(io, room)
  return true
}

function startNextHand(io: Server, room: ServerRoom): void {
  if (!room.gameState) return

  // Remove busted players (0 chips)
  const busted = room.gameState.players
    .filter((p) => p.chips <= 0)
    .map((p) => p.id)

  room.players = room.players.filter((sp) => !busted.includes(sp.id))

  if (room.players.filter((p) => !p.isBot || p.connected).length < 2) {
    // Not enough players to continue
    room.phase = 'ended'
    broadcastToRoom(io, room.code, 'game-ended', { reason: 'プレイヤーが不足しています' })
    return
  }

  // Rebuild game players with updated chip counts
  const prevPlayers = room.gameState.players.filter((p) => !busted.includes(p.id))
  const gamePlayers = prevPlayers.map((p): Player => ({
    ...p,
    holeCards: [] as unknown as [Card, Card],
    isFolded: false,
    isAllIn: false,
    currentBet: 0,
    totalBetThisHand: 0,
    isTurn: false,
    isDealer: false,
  }))

  // Update server players to match (remove busted)
  const updated = createInitialState(gamePlayers, config.bigBlind)
  updated.dealerIndex = room.gameState.dealerIndex // preserve dealer rotation

  room.gameState = startHand(updated)
  room.lastActivityAt = Date.now()

  broadcastState(io, room)
  scheduleAiTurn(io, room)
}

// ──────────────────────────────────────────────────────────────────────────────
// AI turn scheduler
// ──────────────────────────────────────────────────────────────────────────────

function scheduleAiTurn(io: Server, room: ServerRoom): void {
  if (!room.gameState) return
  if (room.aiTurnInFlight) return

  const idx = room.gameState.activePlayerIndex
  if (idx === -1) return

  const gamePlayer = room.gameState.players[idx]
  if (!gamePlayer || gamePlayer.isFolded || gamePlayer.isAllIn) return

  const sp = room.players.find((p) => p.id === gamePlayer.id)
  if (!sp?.isBot) return

  const delay = room.claudeEnabled ? 300 : 600 + Math.random() * 800
  setTimeout(() => runAiTurn(io, room, gamePlayer.id), delay)
}

async function runAiTurn(io: Server, room: ServerRoom, playerId: string): Promise<void> {
  if (!room.gameState || room.aiTurnInFlight) return

  const idx = room.gameState.activePlayerIndex
  if (idx === -1) return

  const gamePlayer = room.gameState.players[idx]
  if (!gamePlayer || gamePlayer.id !== playerId) return
  if (gamePlayer.isFolded || gamePlayer.isAllIn) return

  const sp = room.players.find((p) => p.id === gamePlayer.id)
  if (!sp?.isBot) return

  room.aiTurnInFlight = true

  try {
    let action: ActionType
    let amount: number | undefined
    let reasoning: string | null = null

    if (room.claudeEnabled) {
      const decision = await claudeDecideAction(room.gameState, gamePlayer)
      action = decision.action
      amount = decision.amount
      reasoning = decision.reasoning
    } else {
      const decision = decideAction(room.gameState, gamePlayer, 'medium')
      action = decision.action
      amount = decision.amount
    }

    if (reasoning) {
      const payload: ClaudeReasoningPayload = {
        playerId: gamePlayer.id,
        playerName: gamePlayer.name,
        action,
        amount,
        reasoning,
        handNumber: room.gameState.handNumber,
      }
      broadcastToRoom(io, room.code, 'claude-reasoning', payload)
    }

    room.aiTurnInFlight = false
    processPlayerAction(io, room, gamePlayer.id, action, amount)
  } catch (err) {
    console.error(`[AI] Turn error for ${gamePlayer.name}:`, err)
    room.aiTurnInFlight = false
    // Fallback to fold on any error
    processPlayerAction(io, room, gamePlayer.id, 'fold')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Disconnect / reconnect handling
// ──────────────────────────────────────────────────────────────────────────────

const AUTO_FOLD_DELAY_MS = 10_000 // 10 s to auto-fold if it's their turn

export function handleDisconnect(io: Server, socketId: string): void {
  const found = getRoomBySocket(socketId)
  if (!found) return
  const { room, player } = found

  player.connected = false
  broadcastToRoom(io, room.code, 'player-left', {
    playerId: player.id,
    permanent: false,
  } satisfies PlayerLeftPayload)

  console.log(`[Room ${room.code}] ${player.name} disconnected`)

  // If it's this player's turn, auto-fold after a short grace
  const isTheirTurn =
    room.gameState?.players[room.gameState.activePlayerIndex]?.id === player.id

  const autoFoldMs = isTheirTurn ? AUTO_FOLD_DELAY_MS : config.reconnectGracePeriod

  player.disconnectTimer = setTimeout(() => {
    // Still disconnected after grace period
    if (player.connected) return

    if (room.phase === 'playing' && room.gameState) {
      // Auto-fold if it's now their turn
      const curIdx = room.gameState.activePlayerIndex
      if (room.gameState.players[curIdx]?.id === player.id) {
        console.log(`[Room ${room.code}] Auto-fold for ${player.name}`)
        processPlayerAction(io, room, player.id, 'fold')
      }
    }

    // Permanently remove player from room
    room.players = room.players.filter((p) => p.id !== player.id)
    broadcastToRoom(io, room.code, 'player-left', {
      playerId: player.id,
      permanent: true,
    } satisfies PlayerLeftPayload)

    // Close room if no humans remain
    const humans = room.players.filter((p) => !p.isBot && p.connected)
    if (humans.length === 0) {
      console.log(`[Room ${room.code}] No humans left, closing room`)
      deleteRoom(room.code)
    }
  }, autoFoldMs)
}

export function handleReconnect(
  io: Server,
  room: ServerRoom,
  player: ServerPlayer,
  socket: Socket,
): void {
  socket.join(room.code)

  // Send this player their personal game state
  if (room.gameState) {
    socket.emit('game-state', filterState(room.gameState, player.id))
  }

  socket.emit('room-rejoined', {
    roomCode: room.code,
    playerId: player.id,
    players: room.players.map((sp) => toPublicPlayer(sp, room.hostPlayerId)),
    gameState: room.gameState ? filterState(room.gameState, player.id) : null,
    phase: room.phase,
  })

  broadcastToRoom(io, room.code, 'player-reconnected', { playerId: player.id })
  console.log(`[Room ${room.code}] ${player.name} reconnected`)

  // Kick off AI turn in case it was waiting on this player
  scheduleAiTurn(io, room)
}
