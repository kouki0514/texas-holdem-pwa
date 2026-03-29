"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
exports.config = {
    port: Number(process.env.PORT ?? 3001),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    /** Server-side Anthropic API key — never sent to clients */
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    reconnectGracePeriod: Number(process.env.RECONNECT_GRACE_MS ?? 30_000),
    roomInactivityTimeout: Number(process.env.ROOM_INACTIVITY_MS ?? 3_600_000),
    maxPlayersPerRoom: 6,
    minPlayersToStart: 2,
    startingChips: 1_000,
    bigBlind: 20,
};
