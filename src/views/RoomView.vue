<script setup lang="ts">
import Hls from 'hls.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { API_BASE, fetchRoomSnapshot, fetchVideo, fetchVideos, kickRoomMember, sendRoomControl } from '../api'
import { useRoomRealtime } from '../composables/useRoomRealtime'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { Room, RoomSnapshotPayload, RoomState, RoomSocketMessage, Video } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'

const props = defineProps<{
  room: Room & { is_owner?: boolean }
  /** 仅运行期：普通成员进入私有房时由大厅传入，供 Ably 续签与 snapshot，不持久化 */
  joinPassword?: string
}>()
const emit = defineEmits<{ back: [] }>()
const auth = useAuthStore()
const state = ref<RoomState | null>(null)
const position = ref(0)
const currentVideo = ref(props.room.current_video_id || '')
const manualUrl = ref('')
const library = ref<Video[]>([])
const queue = ref<Video[]>([])
const videoElement = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
const currentUser = computed(() => auth.user.value)

/** 内存中的本次入房密码（私有房成员）；房主走大厅不设此项 */
const runtimeRoomPassword = ref(props.joinPassword ?? '')
const ablyChannelName = ref<string | undefined>(undefined)
const ablyTokenEndpoint = ref<string | undefined>(undefined)

const isSiteAdmin = computed(() => currentUser.value?.role === 'admin')
const isRoomOwnerOrAdmin = computed(
  () =>
    isSiteAdmin.value || props.room.is_owner === true || props.room.owner_id === currentUser.value?.id,
)

const canControl = computed(() => isRoomOwnerOrAdmin.value)

const {
  connected: rtConnected,
  connecting: rtConnecting,
  connectionState: rtConnectionState,
  lastMessage: rtLastMessage,
  events: rtEvents,
  members,
  error: rtError,
  connect: connectRealtime,
  disconnect: disconnectRealtime,
} = useRoomRealtime({
  roomId: () => props.room.id,
  accessToken: () => auth.accessToken.value,
  currentUser: () => currentUser.value,
  channelName: () => ablyChannelName.value,
  roomPassword: () => (isRoomOwnerOrAdmin.value ? undefined : runtimeRoomPassword.value || undefined),
  isOwnerOrAdmin: () => isRoomOwnerOrAdmin.value,
})

watch(
  () => props.joinPassword,
  (v) => {
    runtimeRoomPassword.value = v ?? ''
  },
)

const connectionStatusLabel = computed(() => {
  const s = rtConnectionState.value
  if (s === 'connected' && rtConnected.value) return '已连接'
  if (s === 'connecting' || rtConnecting.value) return '连接中'
  if (s === 'disconnected') return '已断开'
  if (s === 'suspended') return '挂起（重连中）'
  if (s === 'failed') return '失败'
  return s
})

const selectedVideo = computed(
  () => queue.value.find((item) => item.id === currentVideo.value) ?? library.value.find((item) => item.id === currentVideo.value),
)
const playbackUrl = computed(() => {
  if (!selectedVideo.value) return currentVideo.value
  const raw = selectedVideo.value.file_url || `/api/videos/${selectedVideo.value.id}/file`
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
    return raw
  }
  if (raw.startsWith('/')) {
    return `${API_BASE}${raw}`
  }
  return raw
})

const roomLoadError = ref('')
const sidebarOpen = ref(false)
const controlError = ref('')
const eventPreview = computed(() =>
  rtEvents.value.slice(0, 5).map((e) => JSON.stringify(e, null, 0)).join('\n'),
)

const isDev = import.meta.env.DEV

function isLikelyUrlQueueId(id: string) {
  return /^https?:\/\//i.test(id) || id.startsWith('//')
}

function isSnapshotPayload(p: unknown): p is RoomSnapshotPayload {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.room_id === 'string' && Array.isArray(o.queue)
}

async function videoFromQueueId(id: string, token: string): Promise<Video | null> {
  if (isLikelyUrlQueueId(id)) {
    return {
      id,
      title: id.split('/').pop() || id,
      file_path: id,
      file_url: id,
      duration: 0,
      format: id.split('.').pop() || '',
      size: 0,
      status: 'ready',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }
  const inLib = library.value.find((v) => v.id === id)
  if (inLib) return inLib
  try {
    const v = await fetchVideo(token, id)
    if (!library.value.some((x) => x.id === v.id)) {
      library.value = [...library.value, v]
    }
    return v
  } catch {
    const rel = `/api/videos/${id}/file`
    return {
      id,
      title: `未知视频 (${id.slice(0, 8)}…)`,
      file_path: '',
      file_url: `${API_BASE}${rel}`,
      duration: 0,
      format: '',
      size: 0,
      status: 'ready',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }
}

async function buildQueueFromIds(ids: string[], token: string): Promise<Video[]> {
  const out: Video[] = []
  for (const id of ids) {
    const v = await videoFromQueueId(id, token)
    if (v) out.push(v)
  }
  return out
}

function applyStateFromSyncMessage(message: RoomSocketMessage) {
  const ts = message.timestamp ?? Date.now() / 1000
  state.value = {
    room_id: props.room.id,
    action: message.action ?? 'pause',
    position: message.position ?? 0,
    video_id: message.video_id ?? '',
    queue: message.queue,
    updated_at: new Date(ts * 1000).toISOString(),
  }
  position.value = state.value.position
  currentVideo.value = state.value.video_id ?? ''
  syncPlayer(message.action ?? 'pause', state.value.position)
}

async function applyRoomSnapshot(payload: RoomSnapshotPayload) {
  if (payload.ably?.channel) {
    ablyChannelName.value = payload.ably.channel
  }
  if (payload.ably?.token_endpoint) {
    ablyTokenEndpoint.value = payload.ably.token_endpoint
  }

  if (payload.state) {
    const s = payload.state
    state.value = { ...s, room_id: payload.room_id }
    position.value = s.position
    currentVideo.value = s.video_id || ''
  }
  const queueIds = payload.queue.length ? payload.queue : (payload.state?.queue ?? [])
  if (queueIds.length) {
    queue.value = await buildQueueFromIds(queueIds, auth.accessToken.value)
  }
  await nextTick()
  loadPlaybackSource()
  if (state.value) {
    syncPlayer(state.value.action, state.value.position)
  }
}

onMounted(async () => {
  roomLoadError.value = ''
  try {
    const pwd =
      isRoomOwnerOrAdmin.value || props.room.visibility === 'public' ? undefined : runtimeRoomPassword.value
    const [snapshot, videos] = await Promise.all([
      fetchRoomSnapshot(auth.accessToken.value, props.room.id, pwd),
      fetchVideos(auth.accessToken.value, { status: 'ready' }),
    ])
    library.value = videos.items
    await applyRoomSnapshot(snapshot)
    if (!ablyChannelName.value) {
      roomLoadError.value = '房间快照未返回 Ably 频道名，无法建立实时连接'
      return
    }
    connectRealtime()
    await nextTick()
    loadPlaybackSource()
  } catch (err) {
    roomLoadError.value = formatApiError(err, '加载房间失败')
  }
})

onBeforeUnmount(() => {
  hls?.destroy()
  disconnectRealtime()
  runtimeRoomPassword.value = ''
})

watch(rtLastMessage, (message) => {
  if (!message) return
  if (message.type === 'room_snapshot' && isSnapshotPayload(message.payload)) {
    void applyRoomSnapshot(message.payload)
    return
  }
  if (message.type === 'sync') {
    applyStateFromSyncMessage(message)
    const q = message.queue
    if (q?.length) {
      void buildQueueFromIds(q, auth.accessToken.value).then((built) => {
        queue.value = built
      })
    }
    return
  }
  if (message.type === 'room_event' && message.user) {
    const u = message.user
    if (message.event === 'user_kicked' && currentUser.value && u.id === currentUser.value.id) {
      window.alert('你已被移出该房间')
      emit('back')
    }
  }
  if (message.type === 'room_event' && message.event === 'room_deleted') {
    window.alert('房间已删除')
    emit('back')
  }
})

async function send(action: RoomSocketMessage['action']) {
  if (!canControl.value) return
  controlError.value = ''
  position.value = videoElement.value?.currentTime ?? Number(position.value)
  const queueIds = queue.value.map((v) => v.id)
  try {
    const msg = await sendRoomControl(auth.accessToken.value, props.room.id, {
      action: action!,
      position: Number(position.value),
      video_id: currentVideo.value,
      queue: queueIds,
    })
    if (msg.type === 'sync' || msg.action) {
      applyStateFromSyncMessage(msg)
    } else {
      syncPlayer(action ?? 'pause', Number(position.value))
    }
  } catch (err) {
    controlError.value = formatApiError(err, '同步失败')
  }
}

watch(playbackUrl, () => loadPlaybackSource())

function loadPlaybackSource() {
  const video = videoElement.value
  if (!video || !playbackUrl.value) return
  hls?.destroy()
  hls = null
  const url = playbackUrl.value
  if (url.endsWith('.m3u8') && Hls.isSupported()) {
    hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(video)
    return
  }
  video.src = url
  video.load()
}

function syncPlayer(action: RoomSocketMessage['action'], nextPosition: number) {
  const video = videoElement.value
  if (!video) return
  if (Number.isFinite(nextPosition)) {
    video.currentTime = nextPosition
  }
  if (action === 'play') {
    video.play().catch(() => undefined)
  }
  if (action === 'pause') {
    video.pause()
  }
}

function addManualUrl() {
  if (!canControl.value || !manualUrl.value.trim()) return
  const url = manualUrl.value.trim()
  queue.value.push({
    id: url,
    title: url.split('/').pop() || url,
    file_path: url,
    file_url: url,
    duration: 0,
    format: url.split('.').pop() || '',
    size: 0,
    status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  manualUrl.value = ''
}

function addLibraryVideo(video: Video) {
  if (!canControl.value || queue.value.some((item) => item.id === video.id)) return
  queue.value.push(video)
}

function moveQueue(index: number, delta: number) {
  if (!canControl.value) return
  const target = index + delta
  if (target < 0 || target >= queue.value.length) return
  const items = [...queue.value]
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item)
  queue.value = items
}

function removeQueue(index: number) {
  if (!canControl.value) return
  queue.value.splice(index, 1)
}

async function kick(member: { id: string; username: string }) {
  if (!canControl.value) return
  try {
    await kickRoomMember(auth.accessToken.value, props.room.id, member.id)
  } catch (err) {
    window.alert(formatApiError(err, '踢出失败'))
  }
}

function reconnectRealtime() {
  disconnectRealtime()
  connectRealtime()
}

function closeSidebar() {
  sidebarOpen.value = false
}
</script>

<template>
  <section v-if="roomLoadError" class="room-layout">
    <AppCard>
      <p class="error" role="alert">{{ roomLoadError }}</p>
      <AppButton variant="secondary" @click="emit('back')">返回大厅</AppButton>
    </AppCard>
  </section>

  <section v-else class="room-layout">
    <div class="room-main">
      <AppCard padding="compact">
        <AppButton variant="ghost" size="sm" @click="emit('back')">← 返回大厅</AppButton>

        <div class="realtime-bar muted" style="margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center">
          <span>
            实时同步：<strong>{{ connectionStatusLabel }}</strong>
          </span>
          <span v-if="members.length">在线 {{ members.length }} 人</span>
          <span v-if="ablyChannelName" class="channel-hint" title="Ably 频道">频道 {{ ablyChannelName }}</span>
          <span v-if="ablyTokenEndpoint">{{ ablyTokenEndpoint }}</span>
          <AppButton v-if="rtConnectionState === 'failed'" size="sm" variant="secondary" @click="reconnectRealtime">
            重新连接
          </AppButton>
        </div>
        <p v-if="rtError" class="error" role="status">{{ rtError }}</p>
        <p
          v-if="rtConnectionState === 'suspended' || rtConnectionState === 'connecting'"
          class="muted"
          role="status"
        >
          正在重连实时同步…
        </p>

        <div class="video-frame">
          <video ref="videoElement" controls playsinline @timeupdate="position = videoElement?.currentTime ?? 0"></video>
        </div>
        <p class="muted">当前视频：{{ selectedVideo?.title || currentVideo || '尚未选择视频' }}</p>
        <div class="controls" :class="{ disabled: !canControl }">
          <AppButton size="sm" :disabled="!canControl" @click="send('play')">播放</AppButton>
          <AppButton size="sm" variant="secondary" :disabled="!canControl" @click="send('pause')">暂停</AppButton>
          <AppButton size="sm" variant="secondary" :disabled="!canControl" @click="send('seek')">同步进度</AppButton>
          <label>
            进度
            <input v-model.number="position" class="ui-input" type="range" min="0" max="7200" :disabled="!canControl" />
          </label>
        </div>
        <p v-if="controlError" class="error" role="alert">{{ controlError }}</p>
        <p v-if="!canControl" class="hint">普通成员为只读模式，等待房主或管理员同步播放。</p>
        <p v-else class="hint">你拥有播放控制权限；指令通过 HTTP 接口提交，由服务端经 Ably 广播。</p>
      </AppCard>

      <div class="room-sidebar-toggle">
        <AppButton variant="primary" @click="sidebarOpen = true">队列与成员</AppButton>
      </div>
    </div>

    <div class="room-drawer-backdrop" :class="{ 'is-visible': sidebarOpen }" @click="closeSidebar" />
    <aside class="room-sidebar" :class="{ 'is-open': sidebarOpen }">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem">
        <h3 class="sidebar-heading" style="border: 0; padding: 0; margin: 0">侧栏</h3>
        <AppButton class="room-sidebar-close" variant="ghost" size="sm" @click="closeSidebar">关闭</AppButton>
      </div>

      <AppCard padding="compact">
        <h3 class="sidebar-heading">视频队列</h3>
        <form class="inline-form" @submit.prevent="addManualUrl">
          <input v-model="manualUrl" class="ui-input" placeholder="添加 mp4 / m3u8 URL" :disabled="!canControl" />
          <AppButton type="submit" size="sm" :disabled="!canControl">添加</AppButton>
        </form>
        <div class="queue-item" v-for="(item, index) in queue" :key="item.id">
          <div>
            <strong>{{ item.title }}</strong>
            <small>{{ item.file_url || item.file_path }}</small>
          </div>
          <div class="queue-actions">
            <AppButton size="sm" variant="secondary" :disabled="!canControl || index === 0" @click="moveQueue(index, -1)">
              上移
            </AppButton>
            <AppButton
              size="sm"
              variant="secondary"
              :disabled="!canControl || index === queue.length - 1"
              @click="moveQueue(index, 1)"
            >
              下移
            </AppButton>
            <AppButton size="sm" :disabled="!canControl" @click=";(currentVideo = item.id), send('switch')">切换</AppButton>
            <AppButton size="sm" variant="danger" :disabled="!canControl" @click="removeQueue(index)">删除</AppButton>
          </div>
        </div>
      </AppCard>

      <AppCard padding="compact">
        <h3 class="sidebar-heading">视频库</h3>
        <div class="queue-item" v-for="video in library" :key="video.id">
          <div>
            <strong>{{ video.title }}</strong>
            <small>{{ Math.round(video.duration || 0) }} 秒 · {{ video.format || 'unknown' }}</small>
          </div>
          <AppButton size="sm" variant="secondary" :disabled="!canControl" @click="addLibraryVideo(video)">加入队列</AppButton>
        </div>
      </AppCard>

      <AppCard padding="compact">
        <h3 class="sidebar-heading">在线成员（Ably Presence）</h3>
        <div class="member" v-for="member in members" :key="member.connectionId || member.id">
          <span class="avatar">{{ member.username.slice(0, 1).toUpperCase() }}</span>
          <span>
            {{ member.username }}
            <small v-if="member.is_owner" class="muted">房主</small>
            <small v-else-if="member.role === 'admin'" class="muted">管理员</small>
          </span>
          <AppButton
            v-if="canControl && member.id !== currentUser?.id"
            size="sm"
            variant="danger"
            @click="kick(member)"
          >
            踢出
          </AppButton>
        </div>
        <p v-if="!members.length" class="muted">暂无 presence 成员（连接建立后将显示）</p>
      </AppCard>

      <AppCard v-if="isDev" padding="compact">
        <h3 class="sidebar-heading">实时事件（开发）</h3>
        <pre class="events-pre">{{ eventPreview || '—' }}</pre>
      </AppCard>
    </aside>
  </section>
</template>

<style scoped>
.channel-hint {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (min-width: 961px) {
  .room-sidebar-close {
    display: none;
  }
}
</style>
