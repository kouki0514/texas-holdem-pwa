"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const roomManager_1 = require("./roomManager");
const gameLoop_1 = require("./gameLoop");
// ──────────────────────────────────────────────────────────────────────────────
// HTTP server + Socket.io
// ──────────────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigin }));
app.use(express_1.default.json());
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: config_1.config.corsOrigin, methods: ['GET', 'POST'] },
    pingTimeout: 20_000,
    pingInterval: 10_000,
});
// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});
// ──────────────────────────────────────────────────────────────────────────────
// Socket.io connection handler
// ──────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Socket] connected: ${socket.id}`);
    // ── Create room ─────────────────────────────────────────────────────────────
    socket.on('create-room', (payload) => {
        const name = payload.playerName?.trim().slice(0, 20) || 'Player';
        const { room, host } = (0, roomManager_1.createRoom)(socket.id, name);
        socket.join(room.code);
        socket.emit('room-created', {
            roomCode: room.code,
            playerId: host.id,
            reconnectToken: host.reconnectToken,
            players: room.players.map((sp) => (0, roomManager_1.toPublicPlayer)(sp, room.hostPlayerId)),
        });
        console.log(`[Room ${room.code}] Created by ${name}`);
    });
    // ── Join room ────────────────────────────────────────────────────────────────
    socket.on('join-room', (payload) => {
        const name = payload.playerName?.trim().slice(0, 20) || 'Player';
        const result = (0, roomManager_1.joinRoom)(payload.roomCode, socket.id, name);
        if (!result.ok) {
            socket.emit('room-error', { message: result.error });
            return;
        }
        const { room, player } = result;
        socket.join(room.code);
        // Notify the joining player
        socket.emit('room-joined', {
            roomCode: room.code,
            playerId: player.id,
            reconnectToken: player.reconnectToken,
            players: room.players.map((sp) => (0, roomManager_1.toPublicPlayer)(sp, room.hostPlayerId)),
        });
        // Notify existing players
        socket.to(room.code).emit('player-joined', {
            player: (0, roomManager_1.toPublicPlayer)(player, room.hostPlayerId),
        });
        console.log(`[Room ${room.code}] ${name} joined`);
    });
    // ── Reconnect ────────────────────────────────────────────────────────────────
    socket.on('reconnect-room', (payload) => {
        const result = (0, roomManager_1.reconnectPlayer)(payload.roomCode, payload.reconnectToken, socket.id);
        if (!result.ok) {
            socket.emit('room-error', { message: result.error });
            return;
        }
        (0, gameLoop_1.handleReconnect)(io, result.room, result.player, socket);
    });
    // ── Add bot ──────────────────────────────────────────────────────────────────
    socket.on('add-bot', (payload) => {
        const room = (0, roomManager_1.getRoom)(payload.roomCode);
        if (!room)
            return;
        if (room.phase !== 'lobby')
            return;
        // Host only
        const host = room.players.find((p) => p.socketId === socket.id);
        if (!host || host.id !== room.hostPlayerId) {
            socket.emit('room-error', { message: 'ホストのみボットを追加できます' });
            return;
        }
        const bot = (0, roomManager_1.addBot)(payload.roomCode);
        if (!bot) {
            socket.emit('room-error', { message: 'ボットを追加できません（満員または開始済み）' });
            return;
        }
        io.to(room.code).emit('player-joined', {
            player: (0, roomManager_1.toPublicPlayer)(bot, room.hostPlayerId),
        });
        console.log(`[Room ${room.code}] Bot added: ${bot.name}`);
    });
    // ── Start game ───────────────────────────────────────────────────────────────
    socket.on('start-game', (payload) => {
        const room = (0, roomManager_1.getRoom)(payload.roomCode);
        if (!room)
            return;
        // Host only
        const requestor = room.players.find((p) => p.socketId === socket.id);
        if (!requestor || requestor.id !== room.hostPlayerId) {
            socket.emit('room-error', { message: 'ホストのみゲームを開始できます' });
            return;
        }
        if (room.players.length < config_1.config.minPlayersToStart) {
            socket.emit('room-error', { message: `最低${config_1.config.minPlayersToStart}人必要です` });
            return;
        }
        const ok = (0, gameLoop_1.startGame)(io, room);
        if (!ok) {
            socket.emit('room-error', { message: 'ゲームを開始できません' });
        }
        else {
            console.log(`[Room ${room.code}] Game started (${room.players.length} players)`);
        }
    });
    // ── Player action ────────────────────────────────────────────────────────────
    socket.on('player-action', (payload) => {
        const room = (0, roomManager_1.getRoom)(payload.roomCode);
        if (!room || room.phase !== 'playing' || !room.gameState)
            return;
        // Verify the socket belongs to a player in this room
        const sp = room.players.find((p) => p.socketId === socket.id);
        if (!sp)
            return;
        const ok = (0, gameLoop_1.processPlayerAction)(io, room, sp.id, payload.action, payload.amount);
        if (!ok) {
            socket.emit('action-error', { message: '無効なアクションです' });
        }
    });
    // ── Toggle Claude ─────────────────────────────────────────────────────────────
    socket.on('toggle-claude', (payload) => {
        const room = (0, roomManager_1.getRoom)(payload.roomCode);
        if (!room)
            return;
        const requestor = room.players.find((p) => p.socketId === socket.id);
        if (!requestor || requestor.id !== room.hostPlayerId) {
            socket.emit('room-error', { message: 'ホストのみ設定を変更できます' });
            return;
        }
        if (payload.enabled && !config_1.config.anthropicApiKey) {
            socket.emit('room-error', { message: 'サーバーにANTHROPIC_API_KEYが設定されていません' });
            return;
        }
        room.claudeEnabled = payload.enabled;
        io.to(room.code).emit('claude-toggled', { enabled: payload.enabled });
        console.log(`[Room ${room.code}] Claude ${payload.enabled ? 'enabled' : 'disabled'}`);
    });
    // ── Request current state (e.g. after UI refresh) ────────────────────────────
    socket.on('request-state', (payload) => {
        const room = (0, roomManager_1.getRoom)(payload.roomCode);
        if (!room || !room.gameState)
            return;
        const sp = room.players.find((p) => p.socketId === socket.id);
        if (!sp)
            return;
        socket.emit('game-state', {
            ...room.gameState,
            players: room.gameState.players.map((p) => {
                if (p.id === sp.id)
                    return p;
                const cards = p.holeCards;
                if (cards.length > 0 && cards.every((c) => c.faceUp))
                    return p;
                return { ...p, holeCards: cards.map(() => ({ suit: 'spades', rank: '2', faceUp: false })) };
            }),
        });
    });
    // ── Disconnect ───────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
        console.log(`[Socket] disconnected: ${socket.id} (${reason})`);
        (0, gameLoop_1.handleDisconnect)(io, socket.id);
    });
});
// ──────────────────────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────────────────────
httpServer.listen(config_1.config.port, () => {
    console.log(`✅ Texas Hold'em server listening on http://localhost:${config_1.config.port}`);
    console.log(`   CORS origin : ${config_1.config.corsOrigin}`);
    console.log(`   Claude AI   : ${config_1.config.anthropicApiKey ? 'available' : 'not configured (ANTHROPIC_API_KEY unset)'}`);
});
