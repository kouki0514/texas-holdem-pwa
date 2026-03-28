// ──────────────────────────────────────────────────────────────────────────────
// IndexedDB persistence for hand history & lifetime stats
// ──────────────────────────────────────────────────────────────────────────────

import type { HandRank, Card } from '@/game/types'

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
