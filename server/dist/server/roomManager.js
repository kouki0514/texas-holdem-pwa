"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPublicPlayer = toPublicPlayer;
exports.createRoom = createRoom;
exports.joinRoom = joinRoom;
exports.reconnectPlayer = reconnectPlayer;
exports.addBot = addBot;
exports.getRoom = getRoom;
exports.getRoomBySocket = getRoomBySocket;
exports.deleteRoom = deleteRoom;
const uuid_1 = require("uuid");
const config_1 = require("./config");
// ──────────────────────────────────────────────────────────────────────────────
// In-memory store
// ──────────────────────────────────────────────────────────────────────────────
const rooms = new Map();
// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
/** Generate a 5-char alphanumeric room code (avoids confusable chars) */
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (rooms.has(code));
    return code;
}
function makeServerPlayer(socketId, name, isBot = false) {
    return {
        id: (0, uuid_1.v4)(),
        socketId,
        name,
        reconnectToken: (0, uuid_1.v4)(),
        connected: true,
        isBot,
    };
}
function toPublicPlayer(sp, hostId) {
    return {
        id: sp.id,
        name: sp.name,
        connected: sp.connected,
        isBot: sp.isBot,
        isHost: sp.id === hostId,
    };
}
// ──────────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────────
function createRoom(hostSocketId, hostName) {
    const host = makeServerPlayer(hostSocketId, hostName);
    const room = {
        code: generateCode(),
        hostPlayerId: host.id,
        players: [host],
        gameState: null,
        phase: 'lobby',
        claudeEnabled: false,
        lastActivityAt: Date.now(),
        aiTurnInFlight: false,
    };
    rooms.set(room.code, room);
    return { room, host };
}
function joinRoom(roomCode, socketId, playerName) {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room)
        return { ok: false, error: 'ルームが見つかりません' };
    if (room.phase !== 'lobby')
        return { ok: false, error: 'ゲームはすでに開始されています' };
    const humanCount = room.players.filter((p) => !p.isBot).length;
    if (humanCount >= config_1.config.maxPlayersPerRoom)
        return { ok: false, error: 'ルームが満員です（最大6人）' };
    const player = makeServerPlayer(socketId, playerName);
    room.players.push(player);
    room.lastActivityAt = Date.now();
    return { ok: true, room, player };
}
function reconnectPlayer(roomCode, reconnectToken, newSocketId) {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room)
        return { ok: false, error: 'ルームが見つかりません' };
    const player = room.players.find((p) => p.reconnectToken === reconnectToken);
    if (!player)
        return { ok: false, error: '再接続トークンが無効です' };
    // Cancel pending timers
    if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        delete player.disconnectTimer;
    }
    player.socketId = newSocketId;
    player.connected = true;
    room.lastActivityAt = Date.now();
    return { ok: true, room, player };
}
function addBot(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'lobby')
        return null;
    if (room.players.length >= config_1.config.maxPlayersPerRoom)
        return null;
    const botNum = room.players.filter((p) => p.isBot).length + 1;
    const bot = makeServerPlayer(`bot-${(0, uuid_1.v4)()}`, `Bot ${botNum}`, true);
    room.players.push(bot);
    return bot;
}
// ──────────────────────────────────────────────────────────────────────────────
// Lookups
// ──────────────────────────────────────────────────────────────────────────────
function getRoom(roomCode) {
    return rooms.get(roomCode.toUpperCase());
}
function getRoomBySocket(socketId) {
    for (const room of rooms.values()) {
        const player = room.players.find((p) => p.socketId === socketId);
        if (player)
            return { room, player };
    }
    return null;
}
function deleteRoom(roomCode) {
    rooms.delete(roomCode);
}
// ──────────────────────────────────────────────────────────────────────────────
// Inactive room cleanup (runs every minute)
// ──────────────────────────────────────────────────────────────────────────────
setInterval(() => {
    const cutoff = Date.now() - config_1.config.roomInactivityTimeout;
    for (const [code, room] of rooms) {
        if (room.lastActivityAt < cutoff) {
            rooms.delete(code);
            console.log(`[Rooms] Cleaned up inactive room ${code}`);
        }
    }
}, 60_000);
