import { v4 as uuidv4 } from 'uuid'
import { config } from './config'
import type { ServerRoom, ServerPlayer, PublicPlayer } from './types'

// ──────────────────────────────────────────────────────────────────────────────
// In-memory store
// ──────────────────────────────────────────────────────────────────────────────

const rooms = new Map<string, ServerRoom>()

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Generate a 5-char alphanumeric room code (avoids confusable chars) */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code: string
  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join('')
  } while (rooms.has(code))
  return code
}

function makeServerPlayer(socketId: string, name: string, isBot = false): ServerPlayer {
  return {
    id: uuidv4(),
    socketId,
    name,
    reconnectToken: uuidv4(),
    connected: true,
    isBot,
  }
}

export function toPublicPlayer(sp: ServerPlayer, hostId: string): PublicPlayer {
  return {
    id: sp.id,
    name: sp.name,
    connected: sp.connected,
    isBot: sp.isBot,
    isHost: sp.id === hostId,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────

export function createRoom(
  hostSocketId: string,
  hostName: string,
): { room: ServerRoom; host: ServerPlayer } {
  const host = makeServerPlayer(hostSocketId, hostName)
  const room: ServerRoom = {
    code: generateCode(),
    hostPlayerId: host.id,
    players: [host],
    gameState: null,
    phase: 'lobby',
    claudeEnabled: false,
    lastActivityAt: Date.now(),
    aiTurnInFlight: false,
  }
  rooms.set(room.code, room)
  return { room, host }
}

export type JoinResult =
  | { ok: true; room: ServerRoom; player: ServerPlayer }
  | { ok: false; error: string }

export function joinRoom(
  roomCode: string,
  socketId: string,
  playerName: string,
): JoinResult {
  const room = rooms.get(roomCode.toUpperCase())
  if (!room) return { ok: false, error: 'ルームが見つかりません' }
  if (room.phase !== 'lobby') return { ok: false, error: 'ゲームはすでに開始されています' }

  const humanCount = room.players.filter((p) => !p.isBot).length
  if (humanCount >= config.maxPlayersPerRoom) return { ok: false, error: 'ルームが満員です（最大6人）' }

  const player = makeServerPlayer(socketId, playerName)
  room.players.push(player)
  room.lastActivityAt = Date.now()
  return { ok: true, room, player }
}

export type ReconnectResult =
  | { ok: true; room: ServerRoom; player: ServerPlayer }
  | { ok: false; error: string }

export function reconnectPlayer(
  roomCode: string,
  reconnectToken: string,
  newSocketId: string,
): ReconnectResult {
  const room = rooms.get(roomCode.toUpperCase())
  if (!room) return { ok: false, error: 'ルームが見つかりません' }

  const player = room.players.find((p) => p.reconnectToken === reconnectToken)
  if (!player) return { ok: false, error: '再接続トークンが無効です' }

  // Cancel pending timers
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer)
    delete player.disconnectTimer
  }

  player.socketId = newSocketId
  player.connected = true
  room.lastActivityAt = Date.now()
  return { ok: true, room, player }
}

export function addBot(roomCode: string): ServerPlayer | null {
  const room = rooms.get(roomCode)
  if (!room || room.phase !== 'lobby') return null
  if (room.players.length >= config.maxPlayersPerRoom) return null

  const botNum = room.players.filter((p) => p.isBot).length + 1
  const bot = makeServerPlayer(`bot-${uuidv4()}`, `Bot ${botNum}`, true)
  room.players.push(bot)
  return bot
}

// ──────────────────────────────────────────────────────────────────────────────
// Lookups
// ──────────────────────────────────────────────────────────────────────────────

export function getRoom(roomCode: string): ServerRoom | undefined {
  return rooms.get(roomCode.toUpperCase())
}

export function getRoomBySocket(
  socketId: string,
): { room: ServerRoom; player: ServerPlayer } | null {
  for (const room of rooms.values()) {
    const player = room.players.find((p) => p.socketId === socketId)
    if (player) return { room, player }
  }
  return null
}

export function deleteRoom(roomCode: string): void {
  rooms.delete(roomCode)
}

// ──────────────────────────────────────────────────────────────────────────────
// Inactive room cleanup (runs every minute)
// ──────────────────────────────────────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - config.roomInactivityTimeout
  for (const [code, room] of rooms) {
    if (room.lastActivityAt < cutoff) {
      rooms.delete(code)
      console.log(`[Rooms] Cleaned up inactive room ${code}`)
    }
  }
}, 60_000)
