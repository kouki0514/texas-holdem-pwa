import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { config } from './config'
import {
  addBot,
  createRoom,
  getRoom,
  joinRoom,
  reconnectPlayer,
  toPublicPlayer,
} from './roomManager'
import {
  handleDisconnect,
  handleReconnect,
  processPlayerAction,
  startGame,
} from './gameLoop'
import type {
  AddBotPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  PlayerActionPayload,
  ReconnectPayload,
  StartGamePayload,
  ToggleClaudePayload,
} from './types'

// ──────────────────────────────────────────────────────────────────────────────
// HTTP server + Socket.io
// ──────────────────────────────────────────────────────────────────────────────

const app = express()
app.use(cors({ origin: config.corsOrigin }))
app.use(express.json())

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
  pingTimeout: 20_000,
  pingInterval: 10_000,
})

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// ──────────────────────────────────────────────────────────────────────────────
// Socket.io connection handler
// ──────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] connected: ${socket.id}`)

  // ── Create room ─────────────────────────────────────────────────────────────
  socket.on('create-room', (payload: CreateRoomPayload) => {
    const name = payload.playerName?.trim().slice(0, 20) || 'Player'
    const { room, host } = createRoom(socket.id, name)
    socket.join(room.code)

    socket.emit('room-created', {
      roomCode: room.code,
      playerId: host.id,
      reconnectToken: host.reconnectToken,
      players: room.players.map((sp) => toPublicPlayer(sp, room.hostPlayerId)),
    })

    console.log(`[Room ${room.code}] Created by ${name}`)
  })

  // ── Join room ────────────────────────────────────────────────────────────────
  socket.on('join-room', (payload: JoinRoomPayload) => {
    const name = payload.playerName?.trim().slice(0, 20) || 'Player'
    const result = joinRoom(payload.roomCode, socket.id, name)

    if (!result.ok) {
      socket.emit('room-error', { message: result.error })
      return
    }

    const { room, player } = result
    socket.join(room.code)

    // Notify the joining player
    socket.emit('room-joined', {
      roomCode: room.code,
      playerId: player.id,
      reconnectToken: player.reconnectToken,
      players: room.players.map((sp) => toPublicPlayer(sp, room.hostPlayerId)),
    })

    // Notify existing players
    socket.to(room.code).emit('player-joined', {
      player: toPublicPlayer(player, room.hostPlayerId),
    })

    console.log(`[Room ${room.code}] ${name} joined`)
  })

  // ── Reconnect ────────────────────────────────────────────────────────────────
  socket.on('reconnect-room', (payload: ReconnectPayload) => {
    const result = reconnectPlayer(payload.roomCode, payload.reconnectToken, socket.id)

    if (!result.ok) {
      socket.emit('room-error', { message: result.error })
      return
    }

    handleReconnect(io, result.room, result.player, socket)
  })

  // ── Add bot ──────────────────────────────────────────────────────────────────
  socket.on('add-bot', (payload: AddBotPayload) => {
    const room = getRoom(payload.roomCode)
    if (!room) return
    if (room.phase !== 'lobby') return

    // Host only
    const host = room.players.find((p) => p.socketId === socket.id)
    if (!host || host.id !== room.hostPlayerId) {
      socket.emit('room-error', { message: 'ホストのみボットを追加できます' })
      return
    }

    const bot = addBot(payload.roomCode)
    if (!bot) {
      socket.emit('room-error', { message: 'ボットを追加できません（満員または開始済み）' })
      return
    }

    io.to(room.code).emit('player-joined', {
      player: toPublicPlayer(bot, room.hostPlayerId),
    })
    console.log(`[Room ${room.code}] Bot added: ${bot.name}`)
  })

  // ── Start game ───────────────────────────────────────────────────────────────
  socket.on('start-game', (payload: StartGamePayload) => {
    const room = getRoom(payload.roomCode)
    if (!room) return

    // Host only
    const requestor = room.players.find((p) => p.socketId === socket.id)
    if (!requestor || requestor.id !== room.hostPlayerId) {
      socket.emit('room-error', { message: 'ホストのみゲームを開始できます' })
      return
    }

    if (room.players.length < config.minPlayersToStart) {
      socket.emit('room-error', { message: `最低${config.minPlayersToStart}人必要です` })
      return
    }

    const ok = startGame(io, room)
    if (!ok) {
      socket.emit('room-error', { message: 'ゲームを開始できません' })
    } else {
      console.log(`[Room ${room.code}] Game started (${room.players.length} players)`)
    }
  })

  // ── Player action ────────────────────────────────────────────────────────────
  socket.on('player-action', (payload: PlayerActionPayload) => {
    const room = getRoom(payload.roomCode)
    if (!room || room.phase !== 'playing' || !room.gameState) return

    // Verify the socket belongs to a player in this room
    const sp = room.players.find((p) => p.socketId === socket.id)
    if (!sp) return

    const ok = processPlayerAction(io, room, sp.id, payload.action, payload.amount)
    if (!ok) {
      socket.emit('action-error', { message: '無効なアクションです' })
    }
  })

  // ── Toggle Claude ─────────────────────────────────────────────────────────────
  socket.on('toggle-claude', (payload: ToggleClaudePayload) => {
    const room = getRoom(payload.roomCode)
    if (!room) return

    const requestor = room.players.find((p) => p.socketId === socket.id)
    if (!requestor || requestor.id !== room.hostPlayerId) {
      socket.emit('room-error', { message: 'ホストのみ設定を変更できます' })
      return
    }

    if (payload.enabled && !config.anthropicApiKey) {
      socket.emit('room-error', { message: 'サーバーにANTHROPIC_API_KEYが設定されていません' })
      return
    }

    room.claudeEnabled = payload.enabled
    io.to(room.code).emit('claude-toggled', { enabled: payload.enabled })
    console.log(`[Room ${room.code}] Claude ${payload.enabled ? 'enabled' : 'disabled'}`)
  })

  // ── Request current state (e.g. after UI refresh) ────────────────────────────
  socket.on('request-state', (payload: { roomCode: string }) => {
    const room = getRoom(payload.roomCode)
    if (!room || !room.gameState) return

    const sp = room.players.find((p) => p.socketId === socket.id)
    if (!sp) return

    socket.emit('game-state', {
      ...room.gameState,
      players: room.gameState.players.map((p) => {
        if (p.id === sp.id) return p
        const cards = p.holeCards as import('@/game/types').Card[]
        if (cards.length > 0 && cards.every((c) => c.faceUp)) return p
        return { ...p, holeCards: cards.map(() => ({ suit: 'spades', rank: '2', faceUp: false })) }
      }),
    })
  })

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] disconnected: ${socket.id} (${reason})`)
    handleDisconnect(io, socket.id)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────────

httpServer.listen(config.port, () => {
  console.log(`✅ Texas Hold'em server listening on http://localhost:${config.port}`)
  console.log(`   CORS origin : ${config.corsOrigin}`)
  console.log(`   Claude AI   : ${config.anthropicApiKey ? 'available' : 'not configured (ANTHROPIC_API_KEY unset)'}`)
})
