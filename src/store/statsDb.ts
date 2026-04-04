// ──────────────────────────────────────────────────────────────────────────────
// IndexedDB persistence for hand history & lifetime stats
// ──────────────────────────────────────────────────────────────────────────────

import type { HandRank, Card } from '@/game/types'

// SessionStats is defined here (canonical) and re-exported from gameStore.ts
export interface SessionStats {
  initialChips: number
  handsPlayed: number
  handsWon: number
  vpipHands: number
  stealOpps: number
  steals: number
  checkRaiseOpps: number
  checkRaises: number
  threeBetOpps: number
  threeBets: number
  foldTo3betOpps: number
  foldTo3bets: number
  cbetOpps: number
  cbets: number
  foldToCbetOpps: number
  foldToCbets: number
  sawFlopHands: number
  wtsdHands: number
  wsdHands: number
  wsdWins: number
  totalInvested: number
}

// ──────────────────────────────────────────────────────────────────────────────
// localStorage persistence for cumulative SessionStats
// ──────────────────────────────────────────────────────────────────────────────

const LIFETIME_KEY = 'texas-holdem-lifetime-stats'

/** Zero-value SessionStats used as fallback when nothing is stored yet */
const ZERO_STATS: SessionStats = {
  initialChips: 0, handsPlayed: 0, handsWon: 0, vpipHands: 0,
  stealOpps: 0, steals: 0,
  checkRaiseOpps: 0, checkRaises: 0,
  threeBetOpps: 0, threeBets: 0,
  foldTo3betOpps: 0, foldTo3bets: 0,
  cbetOpps: 0, cbets: 0,
  foldToCbetOpps: 0, foldToCbets: 0,
  sawFlopHands: 0, wtsdHands: 0,
  wsdHands: 0, wsdWins: 0,
  totalInvested: 0,
}

/** Load the cumulative lifetime stats from localStorage. Returns zero stats if nothing stored. */
export function loadLifetimeStats(): SessionStats {
  try {
    const raw = localStorage.getItem(LIFETIME_KEY)
    if (!raw) return { ...ZERO_STATS }
    const parsed = JSON.parse(raw) as Partial<SessionStats>
    // Merge with ZERO_STATS to handle missing keys from older versions
    return { ...ZERO_STATS, ...parsed }
  } catch {
    return { ...ZERO_STATS }
  }
}

/** Save cumulative lifetime stats to localStorage. */
export function saveLifetimeStats(stats: SessionStats): void {
  try {
    localStorage.setItem(LIFETIME_KEY, JSON.stringify(stats))
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/** Erase all cumulative lifetime stats from localStorage. */
export function clearLifetimeStats(): void {
  try {
    localStorage.removeItem(LIFETIME_KEY)
  } catch {
    // ignore
  }
}

export interface HandRecord {
  id?: number            // auto-incremented PK
  handNumber: number
  timestamp: number
  holeCards: [Card, Card]
  handRank: HandRank | null   // null if folded preflop (no showdown eval)
  netChips: number       // positive = won, negative = lost
  vpip: boolean          // voluntarily put chips in preflop
  pfr: boolean           // preflop raise
}

const DB_NAME    = 'texas-holdem-stats'
const DB_VERSION = 1
const STORE_NAME = 'hands'

let _db: IDBDatabase | null = null

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror   = () => reject(req.error)
  })
}

export async function saveHand(record: Omit<HandRecord, 'id'>): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).add(record)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

export async function loadAllHands(): Promise<HandRecord[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result as HandRecord[])
    req.onerror   = () => reject(req.error)
  })
}

export async function clearAllHands(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).clear()
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}
