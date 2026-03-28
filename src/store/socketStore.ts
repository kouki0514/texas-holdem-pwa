import { create } from 'zustand'
import { io, type Socket } from 'socket.io-client'

interface SocketStore {
  socket: Socket | null
  connected: boolean
  roomId: string | null
  connect: (serverUrl: string) => void
  disconnect: () => void
  joinRoom: (roomId: string, playerName: string) => void
  leaveRoom: () => void
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  connected: false,
  roomId: null,

  connect(serverUrl) {
    const socket = io(serverUrl, {
      autoConnect: true,
      transports: ['websocket'],
    })

    socket.on('connect', () => set({ connected: true }))
    socket.on('disconnect', () => set({ connected: false }))

    set({ socket })
  },

  disconnect() {
    get().socket?.disconnect()
    set({ socket: null, connected: false, roomId: null })
  },

  joinRoom(roomId, playerName) {
    get().socket?.emit('join-room', { roomId, playerName })
    set({ roomId })
  },

  leaveRoom() {
    const { socket, roomId } = get()
    if (socket && roomId) socket.emit('leave-room', { roomId })
    set({ roomId: null })
  },
}))
