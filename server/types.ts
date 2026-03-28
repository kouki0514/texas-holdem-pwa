import type { ActionType, GameState } from '@/game/types'

// ──────────────────────────────────────────────────────────────────────────────
// Server-side player (auth + connection metadata, separate from GameState.Player)
// ──────────────────────────────────────────────────────────────────────────────

export interface ServerPlayer {
  /** Stable ID (UUID) — matches GameState.Player.id */
  id: string
  /** Current socket.id — changes on reconnect */
  socketId: string
  name: string
  /** One-time token used to re-authenticate after disconnect */
  reconnectToken: string
  connected: boolean
  isBot: boolean
  /** Timer to auto-fold / remove after grace period */
  disconnectTimer?: ReturnType<typeof setTimeout>
}

// ──────────────────────────────────────────────────────────────────────────────
// Room
// ──────────────────────────────────────────────────────────────────────────────

export type LobbyPhase = 'lobby' | 'playing' | 'ended'

export interface ServerRoom {
  code: string
  hostPlayerId: string
  players: ServerPlayer[]
  gameState: GameState | null
  phase: LobbyPhase
  claudeEnabled: boolean
  lastActivityAt: number
  /** Prevents concurrent AI turns on the same room */
  aiTurnInFlight: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// Socket event payloads  (client → server)
// ──────────────────────────────────────────────────────────────────────────────

export interface CreateRoomPayload {
  playerName: string
}

export interface JoinRoomPayload {
  roomCode: string
  playerName: string
}

export interface ReconnectPayload {
  roomCode: string
  reconnectToken: string
}

export interface StartGamePayload {
  roomCode: string
}

export interface PlayerActionPayload {
  roomCode: string
  action: ActionType
  amount?: number
}

export interface ToggleClaudePayload {
  roomCode: string
  enabled: boolean
}

export interface AddBotPayload {
  roomCode: string
  botName?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Socket event payloads  (server → client)
// ──────────────────────────────────────────────────────────────────────────────

export interface RoomCreatedPayload {
  roomCode: string
  playerId: string
  reconnectToken: string
  players: PublicPlayer[]
}

export interface RoomJoinedPayload {
  roomCode: string
  playerId: string
  reconnectToken: string
  players: PublicPlayer[]
}

export interface RoomRejoinedPayload {
  roomCode: string
  playerId: string
  players: PublicPlayer[]
  /** Filtered game state (opponent hole cards hidden) */
  gameState: GameState | null
  phase: LobbyPhase
}

export interface PlayerJoinedPayload {
  player: PublicPlayer
}

export interface PlayerLeftPayload {
  playerId: string
  permanent: boolean
}

export interface PlayerReconnectedPayload {
  playerId: string
}

export interface ClaudeReasoningPayload {
  playerId: string
  playerName: string
  action: ActionType
  amount?: number
  reasoning: string
  handNumber: number
}

/** Minimal public info about a player visible to all in the lobby */
export interface PublicPlayer {
  id: string
  name: string
  connected: boolean
  isBot: boolean
  isHost: boolean
}
