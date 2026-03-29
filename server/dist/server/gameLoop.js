"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastState = broadcastState;
exports.processPlayerAction = processPlayerAction;
exports.startGame = startGame;
exports.handleDisconnect = handleDisconnect;
exports.handleReconnect = handleReconnect;
const config_1 = require("./config");
const claudeServer_1 = require("./claudeServer");
const roomManager_1 = require("./roomManager");
const aiPlayer_1 = require("../src/ai/aiPlayer");
const gameEngine_1 = require("../src/game/gameEngine");
// ──────────────────────────────────────────────────────────────────────────────
// Hole card filtering — opponents see only face-down placeholders
// ──────────────────────────────────────────────────────────────────────────────
const HIDDEN_CARD = { suit: 'spades', rank: '2', faceUp: false };
function filterPlayer(player, viewerId) {
    if (player.id === viewerId)
        return player;
    const cards = player.holeCards;
    // At showdown, all cards are faceUp = true → reveal them
    if (cards.length > 0 && cards.every((c) => c.faceUp))
        return player;
    return {
        ...player,
        holeCards: cards.map(() => ({ ...HIDDEN_CARD })),
    };
}
function filterState(state, viewerId) {
    return {
        ...state,
        players: state.players.map((p) => filterPlayer(p, viewerId)),
    };
}
// ──────────────────────────────────────────────────────────────────────────────
// Broadcasting helpers
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Send each connected human player their own filtered view of the game state.
 * Bots have no socket — skip them.
 */
function broadcastState(io, room) {
    if (!room.gameState)
        return;
    for (const sp of room.players) {
        if (sp.isBot || !sp.connected)
            continue;
        const socket = io.sockets.sockets.get(sp.socketId);
        if (!socket)
            continue;
        socket.emit('game-state', filterState(room.gameState, sp.id));
    }
}
function broadcastToRoom(io, roomCode, event, data) {
    io.to(roomCode).emit(event, data);
}
// ──────────────────────────────────────────────────────────────────────────────
// Build GameState.Player[] from server room
// ──────────────────────────────────────────────────────────────────────────────
function makeGamePlayers(room) {
    return room.players.map((sp) => ({
        id: sp.id,
        name: sp.name,
        chips: config_1.config.startingChips,
        holeCards: [],
        position: null,
        isHuman: !sp.isBot,
        isFolded: false,
        isAllIn: false,
        currentBet: 0,
        totalBetThisHand: 0,
        isDealer: false,
        isTurn: false,
    }));
}
// ──────────────────────────────────────────────────────────────────────────────
// Action processing
// ──────────────────────────────────────────────────────────────────────────────
function applyAndAdvance(state) {
    // State has already had applyAction called — resolve transitions
    if ((0, gameEngine_1.isHandOver)(state))
        return (0, gameEngine_1.resolveShowdown)(state);
    if ((0, gameEngine_1.isStreetOver)(state))
        return (0, gameEngine_1.advanceToNextStreet)(state);
    return state;
}
function processPlayerAction(io, room, actorId, action, amount) {
    if (!room.gameState)
        return false;
    const idx = room.gameState.activePlayerIndex;
    if (idx === -1)
        return false;
    const actor = room.gameState.players[idx];
    if (actor.id !== actorId)
        return false;
    if (actor.isFolded || actor.isAllIn)
        return false;
    let next = (0, gameEngine_1.applyAction)(room.gameState, action, amount);
    next = applyAndAdvance(next);
    room.gameState = next;
    room.lastActivityAt = Date.now();
    broadcastState(io, room);
    // If showdown just happened, also broadcast winner info
    if (next.phase === 'showdown') {
        broadcastToRoom(io, room.code, 'showdown-result', {
            winners: next.winners,
            players: next.players.map((p) => ({ id: p.id, name: p.name, holeCards: p.holeCards, rank: undefined })),
        });
        // Schedule next hand
        setTimeout(() => startNextHand(io, room), 4_000);
        return true;
    }
    scheduleAiTurn(io, room);
    return true;
}
// ──────────────────────────────────────────────────────────────────────────────
// Game lifecycle
// ──────────────────────────────────────────────────────────────────────────────
function startGame(io, room) {
    if (room.phase !== 'lobby')
        return false;
    if (room.players.length < config_1.config.minPlayersToStart)
        return false;
    const gamePlayers = makeGamePlayers(room);
    const initial = (0, gameEngine_1.createInitialState)(gamePlayers, config_1.config.bigBlind);
    room.gameState = (0, gameEngine_1.startHand)(initial);
    room.phase = 'playing';
    room.lastActivityAt = Date.now();
    broadcastToRoom(io, room.code, 'game-started', {
        players: room.players.map((sp) => (0, roomManager_1.toPublicPlayer)(sp, room.hostPlayerId)),
    });
    broadcastState(io, room);
    scheduleAiTurn(io, room);
    return true;
}
function startNextHand(io, room) {
    if (!room.gameState)
        return;
    // Remove busted players (0 chips)
    const busted = room.gameState.players
        .filter((p) => p.chips <= 0)
        .map((p) => p.id);
    room.players = room.players.filter((sp) => !busted.includes(sp.id));
    if (room.players.filter((p) => !p.isBot || p.connected).length < 2) {
        // Not enough players to continue
        room.phase = 'ended';
        broadcastToRoom(io, room.code, 'game-ended', { reason: 'プレイヤーが不足しています' });
        return;
    }
    // Rebuild game players with updated chip counts
    const prevPlayers = room.gameState.players.filter((p) => !busted.includes(p.id));
    const gamePlayers = prevPlayers.map((p) => ({
        ...p,
        holeCards: [],
        isFolded: false,
        isAllIn: false,
        currentBet: 0,
        totalBetThisHand: 0,
        isTurn: false,
        isDealer: false,
    }));
    // Update server players to match (remove busted)
    const updated = (0, gameEngine_1.createInitialState)(gamePlayers, config_1.config.bigBlind);
    updated.dealerIndex = room.gameState.dealerIndex; // preserve dealer rotation
    room.gameState = (0, gameEngine_1.startHand)(updated);
    room.lastActivityAt = Date.now();
    broadcastState(io, room);
    scheduleAiTurn(io, room);
}
// ──────────────────────────────────────────────────────────────────────────────
// AI turn scheduler
// ──────────────────────────────────────────────────────────────────────────────
function scheduleAiTurn(io, room) {
    if (!room.gameState)
        return;
    if (room.aiTurnInFlight)
        return;
    const idx = room.gameState.activePlayerIndex;
    if (idx === -1)
        return;
    const gamePlayer = room.gameState.players[idx];
    if (!gamePlayer || gamePlayer.isFolded || gamePlayer.isAllIn)
        return;
    const sp = room.players.find((p) => p.id === gamePlayer.id);
    if (!sp?.isBot)
        return;
    const delay = room.claudeEnabled ? 300 : 600 + Math.random() * 800;
    setTimeout(() => runAiTurn(io, room, gamePlayer.id), delay);
}
async function runAiTurn(io, room, playerId) {
    if (!room.gameState || room.aiTurnInFlight)
        return;
    const idx = room.gameState.activePlayerIndex;
    if (idx === -1)
        return;
    const gamePlayer = room.gameState.players[idx];
    if (!gamePlayer || gamePlayer.id !== playerId)
        return;
    if (gamePlayer.isFolded || gamePlayer.isAllIn)
        return;
    const sp = room.players.find((p) => p.id === gamePlayer.id);
    if (!sp?.isBot)
        return;
    room.aiTurnInFlight = true;
    try {
        let action;
        let amount;
        let reasoning = null;
        if (room.claudeEnabled) {
            const decision = await (0, claudeServer_1.claudeDecideAction)(room.gameState, gamePlayer);
            action = decision.action;
            amount = decision.amount;
            reasoning = decision.reasoning;
        }
        else {
            const decision = (0, aiPlayer_1.decideAction)(room.gameState, gamePlayer, 'medium');
            action = decision.action;
            amount = decision.amount;
        }
        if (reasoning) {
            const payload = {
                playerId: gamePlayer.id,
                playerName: gamePlayer.name,
                action,
                amount,
                reasoning,
                handNumber: room.gameState.handNumber,
            };
            broadcastToRoom(io, room.code, 'claude-reasoning', payload);
        }
        room.aiTurnInFlight = false;
        processPlayerAction(io, room, gamePlayer.id, action, amount);
    }
    catch (err) {
        console.error(`[AI] Turn error for ${gamePlayer.name}:`, err);
        room.aiTurnInFlight = false;
        // Fallback to fold on any error
        processPlayerAction(io, room, gamePlayer.id, 'fold');
    }
}
// ──────────────────────────────────────────────────────────────────────────────
// Disconnect / reconnect handling
// ──────────────────────────────────────────────────────────────────────────────
const AUTO_FOLD_DELAY_MS = 10_000; // 10 s to auto-fold if it's their turn
function handleDisconnect(io, socketId) {
    const found = (0, roomManager_1.getRoomBySocket)(socketId);
    if (!found)
        return;
    const { room, player } = found;
    player.connected = false;
    broadcastToRoom(io, room.code, 'player-left', {
        playerId: player.id,
        permanent: false,
    });
    console.log(`[Room ${room.code}] ${player.name} disconnected`);
    // If it's this player's turn, auto-fold after a short grace
    const isTheirTurn = room.gameState?.players[room.gameState.activePlayerIndex]?.id === player.id;
    const autoFoldMs = isTheirTurn ? AUTO_FOLD_DELAY_MS : config_1.config.reconnectGracePeriod;
    player.disconnectTimer = setTimeout(() => {
        // Still disconnected after grace period
        if (player.connected)
            return;
        if (room.phase === 'playing' && room.gameState) {
            // Auto-fold if it's now their turn
            const curIdx = room.gameState.activePlayerIndex;
            if (room.gameState.players[curIdx]?.id === player.id) {
                console.log(`[Room ${room.code}] Auto-fold for ${player.name}`);
                processPlayerAction(io, room, player.id, 'fold');
            }
        }
        // Permanently remove player from room
        room.players = room.players.filter((p) => p.id !== player.id);
        broadcastToRoom(io, room.code, 'player-left', {
            playerId: player.id,
            permanent: true,
        });
        // Close room if no humans remain
        const humans = room.players.filter((p) => !p.isBot && p.connected);
        if (humans.length === 0) {
            console.log(`[Room ${room.code}] No humans left, closing room`);
            (0, roomManager_1.deleteRoom)(room.code);
        }
    }, autoFoldMs);
}
function handleReconnect(io, room, player, socket) {
    socket.join(room.code);
    // Send this player their personal game state
    if (room.gameState) {
        socket.emit('game-state', filterState(room.gameState, player.id));
    }
    socket.emit('room-rejoined', {
        roomCode: room.code,
        playerId: player.id,
        players: room.players.map((sp) => (0, roomManager_1.toPublicPlayer)(sp, room.hostPlayerId)),
        gameState: room.gameState ? filterState(room.gameState, player.id) : null,
        phase: room.phase,
    });
    broadcastToRoom(io, room.code, 'player-reconnected', { playerId: player.id });
    console.log(`[Room ${room.code}] ${player.name} reconnected`);
    // Kick off AI turn in case it was waiting on this player
    scheduleAiTurn(io, room);
}
