import * as Ably from 'ably'
import { onBeforeUnmount, ref, shallowRef } from 'vue'

import { ApiError, fetchAblyToken } from '../api'
import { useAuthStore } from '../stores/auth'
import type { RoomPresenceMember, RoomSnapshotPayload, RoomSocketMessage, User } from '../types'

function normalizeAblyMessage(name: string, data: unknown): RoomSocketMessage | null {
  if (data == null) return null
  if (typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (name === 'room.sync') {
    const t = typeof d.type === 'string' ? d.type : 'sync'
    return { ...d, type: t } as RoomSocketMessage
  }
  if (name === 'room.event') {
    const t = typeof d.type === 'string' ? d.type : 'room_event'
    return { ...d, type: t } as RoomSocketMessage
  }
  if (name === 'room.snapshot') {
    return {
      type: 'room_snapshot',
      payload: d as unknown as RoomSnapshotPayload,
    }
  }
  return null
}

export function useRoomRealtime(options: {
  roomId: () => string
  accessToken: () => string
  currentUser: () => User | null
  channelName: () => string | undefined
  roomPassword?: () => string | undefined
  /** 房主或站点管理员：presence 与 token 均无需房间密码 */
  isOwnerOrAdmin?: () => boolean
}) {
  const authStore = useAuthStore()
  const connected = ref(false)
  const connecting = ref(false)
  const connectionState = ref<string>('initialized')
  const lastMessage = ref<RoomSocketMessage | null>(null)
  const events = ref<RoomSocketMessage[]>([])
  const members = ref<RoomPresenceMember[]>([])
  const error = ref<string | null>(null)

  const client = shallowRef<Ably.Realtime | null>(null)
  let channel: Ably.RealtimeChannel | null = null

  function mergeMembersFromPresence(presence: Ably.PresenceMessage) {
    const data = presence.data
    const parsed =
      typeof data === 'string'
        ? (JSON.parse(data) as {
            username?: string
            nickname?: string
            role?: string
            is_owner?: boolean
          })
        : (data as { username?: string; nickname?: string; role?: string; is_owner?: boolean }) ?? {}
    const username = parsed.username ?? presence.clientId ?? 'unknown'
    const id = presence.clientId ?? ''
    const connId = presence.connectionId ?? ''
    const entry: RoomPresenceMember = {
      id,
      username,
      nickname: parsed.nickname,
      role: parsed.role,
      is_owner: parsed.is_owner,
      connectionId: presence.connectionId,
    }
    if (presence.action === 'leave') {
      members.value = members.value.filter((m) => {
        if (connId) return m.connectionId !== connId
        return m.id !== id
      })
      return
    }
    const withoutSameConnection = connId
      ? members.value.filter((m) => m.connectionId !== connId)
      : members.value.filter((m) => m.id !== id || m.connectionId)
    members.value = [...withoutSameConnection, entry]
  }

  async function refreshPresenceMembers() {
    if (!channel) return
    try {
      const set = await channel.presence.get()
      members.value = []
      for (const m of set) {
        mergeMembersFromPresence(m)
      }
    } catch {
      // ignore
    }
  }

  function attachChannel(next: Ably.RealtimeChannel) {
    channel = next
    next.subscribe((message) => {
      const normalized = normalizeAblyMessage(message.name ?? '', message.data)
      if (!normalized) return
      lastMessage.value = normalized
      events.value = [normalized, ...events.value].slice(0, 30)
    })

    next.presence.subscribe((presence) => {
      mergeMembersFromPresence(presence)
    })

    next.presence
      .enter({
        username: options.currentUser()?.username ?? 'guest',
        nickname: options.currentUser()?.nickname,
        role: options.currentUser()?.role ?? 'user',
        is_owner: Boolean(options.isOwnerOrAdmin?.()),
      })
      .then(() => {
        void refreshPresenceMembers()
      })
      .catch((err: unknown) => {
        error.value = err instanceof Error ? err.message : String(err)
      })
  }

  function disconnect() {
    if (channel) {
      try {
        channel.presence.leave()
      } catch {
        // ignore
      }
      try {
        channel.unsubscribe()
      } catch {
        // ignore
      }
      channel = null
    }
    if (client.value) {
      client.value.close()
      client.value = null
    }
    connected.value = false
    connecting.value = false
    members.value = []
  }

  function connect() {
    disconnect()
    const channelName = options.channelName()?.trim()
    if (!channelName) {
      error.value = '缺少 Ably 频道名，请先加载房间快照'
      return
    }

    error.value = null
    connecting.value = true
    connectionState.value = 'connecting'

    const rt = new Ably.Realtime({
      authCallback: (_tokenParams, callback) => {
        const roomId = options.roomId()
        const pwd = options.roomPassword?.()
        const body = {
          room_id: roomId,
          purpose: 'room' as const,
          ...(pwd ? { password: pwd } : {}),
        }

        const run = (access: string) =>
          fetchAblyToken(access, body).then((res) => {
            void res.expires_at
            return res.token
          })

        void (async () => {
          try {
            const token = await run(options.accessToken())
            callback(null, token)
          } catch (e: unknown) {
            if (e instanceof ApiError && e.status === 401) {
              try {
                await authStore.refreshSession()
                const token = await run(options.accessToken())
                callback(null, token)
                return
              } catch (e2: unknown) {
                const msg2 = e2 instanceof Error ? e2.message : String(e2)
                error.value = msg2
                callback(msg2, null)
                return
              }
            }
            if (e instanceof ApiError && e.status === 403) {
              const msg =
                '房间鉴权失败：请确认私有房密码或重新加入房间。若问题持续，请返回大厅后重试。'
              error.value = msg
              callback(msg, null)
              return
            }
            const msg = e instanceof Error ? e.message : String(e)
            error.value = msg
            callback(msg, null)
          }
        })()
      },
    })

    client.value = rt

    rt.connection.on((stateChange) => {
      connectionState.value = stateChange.current
      if (stateChange.current === 'connected') {
        connected.value = true
        connecting.value = false
      }
      if (stateChange.current === 'failed' || stateChange.current === 'suspended') {
        connected.value = false
        connecting.value = false
      }
      if (stateChange.current === 'disconnected') {
        connected.value = false
      }
    })

    const ch = rt.channels.get(channelName)
    attachChannel(ch)

    void ch
      .attach()
      .then(() => {
        connected.value = true
        connecting.value = false
        void refreshPresenceMembers()
      })
      .catch((err: unknown) => {
        error.value = err instanceof Error ? err.message : String(err)
        connecting.value = false
      })
  }

  onBeforeUnmount(disconnect)

  return {
    connected,
    connecting,
    connectionState,
    lastMessage,
    events,
    members,
    error,
    connect,
    disconnect,
    refreshPresenceMembers,
  }
}
