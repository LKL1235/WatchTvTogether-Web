import { onBeforeUnmount, ref } from 'vue'

import type { RoomSnapshotPayload } from '../types'

export interface RoomSocketMessage {
  type: string
  action?: 'play' | 'pause' | 'seek' | 'next' | 'switch'
  event?: string
  position?: number
  video_id?: string
  /** 服务端广播的当前队列（视频 ID 列表） */
  queue?: string[]
  timestamp?: number
  payload?: RoomSnapshotPayload | Record<string, unknown>
  user?: {
    id: string
    username: string
    role: string
    is_owner: boolean
  }
}

export function useRoomSocket(roomId: () => string, token: () => string) {
  const connected = ref(false)
  const lastMessage = ref<RoomSocketMessage | null>(null)
  const events = ref<RoomSocketMessage[]>([])
  let socket: WebSocket | null = null

  function connect() {
    close()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/room/${roomId()}?token=${encodeURIComponent(token())}`
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      connected.value = true
    })
    socket.addEventListener('close', () => {
      connected.value = false
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as RoomSocketMessage
      lastMessage.value = message
      events.value = [message, ...events.value].slice(0, 30)
    })
  }

  function sendControl(
    action: RoomSocketMessage['action'],
    position = 0,
    videoId = '',
    queueIds?: string[],
  ) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }
    const body: Record<string, unknown> = {
      type: 'play_control',
      action,
      position,
      video_id: videoId,
    }
    if (queueIds !== undefined) {
      body.queue = queueIds
    }
    socket.send(JSON.stringify(body))
  }

  function close() {
    if (socket) {
      socket.close()
      socket = null
    }
    connected.value = false
  }

  onBeforeUnmount(close)

  return { connected, lastMessage, events, connect, sendControl, close }
}
