<script setup lang="ts">
import Hls from 'hls.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  API_BASE,
  ApiError,
  fetchRoomSnapshot,
  fetchRoomState,
  fetchVideo,
  fetchVideos,
  kickRoomMember,
  sendRoomControl,
} from '../api'
import { useRoomRealtime } from '../composables/useRoomRealtime'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import { nextInQueueForControl, nextVideoAfterEnd } from '../utils/roomPlayback'
import { refineRoomStateWithProjection } from '../utils/roomStateProjection'
import { waitForVideoReady } from '../utils/waitForVideo'
import type { PlaybackMode, Room, RoomSnapshotPayload, RoomState, RoomSocketMessage, Video } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'

const props = defineProps<{
  room: Room & { is_owner?: boolean }
  /** 仅运行期：普通成员进入私有房时由大厅传入，供 Ably 续签与 snapshot，不持久化 */
  joinPassword?: string
}>()
const emit = defineEmits<{ back: []; 'admin-rooms-changed': [] }>()
const auth = useAuthStore()
const state = ref<RoomState | null>(null)
const playbackMode = ref<PlaybackMode>('sequential')
const serverControlVersion = ref(0)
/** 正在应用远端同步（Ably / HTTP 响应），避免触发房主控制回环 */
const applyingRemoteSync = ref(false)
let remoteSyncClearTimer: ReturnType<typeof setTimeout> | null = null
const pendingQueueSubmit = ref(0)
const autoplayDeniedCount = ref(0)
const autoplayOverlayHint = ref('')
/** 观看者本地暂停：与房主状态无关，不参与服务端控制 */
const viewerLocalPause = ref(false)
const roomActivityMessage = ref('')
let roomActivityClearTimer: ReturnType<typeof setTimeout> | null = null

function showRoomActivity(text: string) {
  roomActivityMessage.value = text
  if (roomActivityClearTimer) clearTimeout(roomActivityClearTimer)
  roomActivityClearTimer = setTimeout(() => {
    roomActivityMessage.value = ''
    roomActivityClearTimer = null
  }, 5000)
}

const currentVideo = ref(props.room.current_video_id || '')
const manualUrl = ref('')
const library = ref<Video[]>([])
const queue = ref<Video[]>([])
const videoElement = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
const currentUser = computed(() => auth.user.value)

const runtimeRoomPassword = ref(props.joinPassword ?? '')
const ablyChannelName = ref<string | undefined>(undefined)
const ablyTokenEndpoint = ref<string | undefined>(undefined)

const isSiteAdmin = computed(() => currentUser.value?.role === 'admin')
const isRoomOwnerOrAdmin = computed(
  () =>
    isSiteAdmin.value || props.room.is_owner === true || props.room.owner_id === currentUser.value?.id,
)

const canControl = computed(() => isRoomOwnerOrAdmin.value)

const ownerVideoListeners = computed(() =>
  canControl.value ? { play: onOwnerPlay, pause: onOwnerPause, seeked: onOwnerSeeked } : {},
)

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

watch(
  () => autoplayDeniedCount.value,
  (n) => {
    if (!canControl.value && n > 0) {
      autoplayOverlayHint.value =
        n > 1 ? '请先点击播放器区域或尝试取消静音，再点「同步进度」。' : ''
    } else {
      autoplayOverlayHint.value = ''
    }
  },
)

watch(rtConnectionState, (s, prev) => {
  if (s === 'connected' && prev && prev !== 'connected' && !rtConnecting.value) {
    void resyncPlaybackFromServer()
  }
})

const showAutoplayBlockedOverlay = computed(
  () => !canControl.value && autoplayDeniedCount.value > 0 && state.value?.action === 'play',
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
  () =>
    queue.value.find((item) => item.id === currentVideo.value) ??
    library.value.find((item) => item.id === currentVideo.value),
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
const queueSyncPending = computed(() => pendingQueueSubmit.value > 0)

function isLikelyUrlQueueId(id: string) {
  return /^https?:\/\//i.test(id) || id.startsWith('//')
}

function isSnapshotPayload(p: unknown): p is RoomSnapshotPayload {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  const q = o.queue
  return typeof o.room_id === 'string' && (q == null || Array.isArray(q))
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

function mergePlaybackFieldsFromRoomState(s: RoomState) {
  if (s.playback_mode === 'loop' || s.playback_mode === 'sequential') {
    playbackMode.value = s.playback_mode
  }
  if (typeof s.control_version === 'number' && s.control_version > 0) {
    serverControlVersion.value = s.control_version
  }
}

function runWithRemoteSync(fn: () => void | Promise<void>) {
  applyingRemoteSync.value = true
  if (remoteSyncClearTimer) {
    clearTimeout(remoteSyncClearTimer)
    remoteSyncClearTimer = null
  }
  void Promise.resolve(fn()).finally(() => {
    remoteSyncClearTimer = setTimeout(() => {
      applyingRemoteSync.value = false
      remoteSyncClearTimer = null
    }, 320)
  })
}

function getVideoTime(): number {
  const v = videoElement.value
  if (v && Number.isFinite(v.currentTime)) return v.currentTime
  return Number(state.value?.position ?? 0)
}

function snapshotPassword(): string | undefined {
  if (isRoomOwnerOrAdmin.value || props.room.visibility === 'public') return undefined
  const p = runtimeRoomPassword.value.trim()
  return p || undefined
}

async function refreshAuthoritativeState() {
  const s = await fetchRoomState(auth.accessToken.value, props.room.id)
  const prevVideoId = currentVideo.value
  mergePlaybackFieldsFromRoomState(s)
  state.value = { ...s, room_id: props.room.id }
  currentVideo.value = s.video_id || ''
  if (!canControl.value && prevVideoId !== (s.video_id || '')) {
    viewerLocalPause.value = false
  }
  runWithRemoteSync(() => syncPlayerFromState(s.action, s.position))
}

async function submitOwnerControl(input: {
  action: RoomSocketMessage['action']
  position: number
  video_id?: string
  queue?: string[]
  playback_mode?: PlaybackMode
}): Promise<boolean> {
  if (!canControl.value) return false
  controlError.value = ''
  const queueIds = input.queue ?? queue.value.map((v) => v.id)
  const body = {
    action: input.action!,
    position: input.position,
    video_id: input.video_id ?? currentVideo.value,
    queue: queueIds,
    playback_mode: input.playback_mode ?? playbackMode.value,
    ...(serverControlVersion.value > 0 ? { control_version: serverControlVersion.value } : {}),
  }
  try {
    const msg = await sendRoomControl(auth.accessToken.value, props.room.id, body)
    if (msg.type === 'sync' || msg.action) {
      applyStateFromSyncMessage(msg)
    }
    await refreshAuthoritativeState()
    return true
  } catch (err) {
    controlError.value = formatApiError(err, '同步失败')
    try {
      const snap = await fetchRoomSnapshot(auth.accessToken.value, props.room.id, snapshotPassword())
      await applyRoomSnapshot(snap)
    } catch {
      // ignore secondary failure
    }
    return false
  }
}

function refineForNow(s: RoomState): RoomState {
  return refineRoomStateWithProjection(s, Date.now(), playbackMode.value)
}

function applyStateFromSyncMessage(message: RoomSocketMessage) {
  const ts = message.timestamp ?? Date.now() / 1000
  const nextMode =
    message.playback_mode === 'loop' || message.playback_mode === 'sequential'
      ? message.playback_mode
      : playbackMode.value
  const prevVideoId = currentVideo.value
  let nextState: RoomState = {
    room_id: props.room.id,
    action: message.action ?? 'pause',
    position: message.position ?? 0,
    video_id: message.video_id ?? '',
    queue: message.queue,
    playback_mode: nextMode,
    control_version: message.control_version,
    updated_at: new Date(ts * 1000).toISOString(),
  }
  playbackMode.value = nextMode
  currentVideo.value = nextState.video_id ?? ''
  if (!canControl.value && prevVideoId !== (nextState.video_id ?? '')) {
    viewerLocalPause.value = false
  }
  nextState = refineForNow(nextState)
  state.value = nextState
  mergePlaybackFieldsFromRoomState(nextState)
  runWithRemoteSync(() => syncPlayerFromState(nextState.action, nextState.position))
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
    const prevVideoId = currentVideo.value
    state.value = { ...s, room_id: payload.room_id }
    mergePlaybackFieldsFromRoomState(state.value)
    currentVideo.value = s.video_id || ''
    if (!canControl.value && prevVideoId !== (s.video_id || '')) {
      viewerLocalPause.value = false
    }
  }
  const topQueue = Array.isArray(payload.queue) ? payload.queue : []
  const stateQ = payload.state?.queue
  const fromState = Array.isArray(stateQ) ? stateQ : []
  const queueIds = topQueue.length ? topQueue : fromState
  if (queueIds.length) {
    queue.value = await buildQueueFromIds(queueIds, auth.accessToken.value)
  } else if (!queueIds.length && payload.state?.video_id) {
    queue.value = await buildQueueFromIds([payload.state.video_id], auth.accessToken.value)
  }
  await nextTick()
  loadPlaybackSource()
  await nextTick()
  if (state.value) {
    const refined = refineForNow(state.value)
    state.value = refined
    runWithRemoteSync(() => syncPlayerFromState(refined.action, refined.position))
  }
}

onMounted(async () => {
  roomLoadError.value = ''
  try {
    const [snapshot, videos] = await Promise.all([
      fetchRoomSnapshot(auth.accessToken.value, props.room.id, snapshotPassword()),
      fetchVideos(auth.accessToken.value, { status: 'ready' }),
    ])
    library.value = videos.items
    await applyRoomSnapshot(snapshot)
    if (!ablyChannelName.value) {
      roomLoadError.value = '房间快照未返回 Ably 频道名，无法建立实时连接'
      return
    }
    connectRealtime()
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      roomLoadError.value = '房间已关闭或不存在'
      emit('admin-rooms-changed')
    } else {
      roomLoadError.value = formatApiError(err, '加载房间失败')
    }
  }
})

onBeforeUnmount(() => {
  if (remoteSyncClearTimer) {
    clearTimeout(remoteSyncClearTimer)
    remoteSyncClearTimer = null
  }
  if (roomActivityClearTimer) {
    clearTimeout(roomActivityClearTimer)
    roomActivityClearTimer = null
  }
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
    const selfId = currentUser.value?.id
    const isSelf = Boolean(selfId && u.id === selfId)
    const name = u.username || '某用户'

    if (message.event === 'user_joined' && !isSelf) {
      showRoomActivity(`${name} 已加入房间`)
    }
    if (message.event === 'user_left' && !isSelf) {
      showRoomActivity(`${name} 已离开房间`)
    }
    if (message.event === 'user_left' && isSelf) {
      window.alert('你已加入其他房间，当前房间已退出。')
      emit('back')
      return
    }

    if (message.event === 'user_kicked' && currentUser.value && u.id === currentUser.value.id) {
      window.alert('你已被移出该房间')
      emit('back')
    }
  }
  if (message.type === 'room_event' && message.event === 'room_deleted') {
    window.alert('房间已删除')
    emit('admin-rooms-changed')
    emit('back')
  }
  if (message.type === 'room_event' && message.event === 'room_closed') {
    onRoomClosed()
  }
})

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

async function syncPlayerFromState(action: RoomSocketMessage['action'], nextPosition: number) {
  const video = videoElement.value
  if (!video) return
  await waitForVideoReady(video)
  if (Number.isFinite(nextPosition)) {
    video.currentTime = nextPosition
  }
  if (action === 'pause') {
    autoplayDeniedCount.value = 0
    video.pause()
    return
  }
  // 房主仍在播放，但观看者选择了本地暂停：只对齐进度，不自动播放
  if (!canControl.value && viewerLocalPause.value) {
    video.pause()
    return
  }
  if (action === 'seek') {
    if (canControl.value) {
      void video.play().catch(() => undefined)
    } else {
      try {
        await video.play()
        autoplayDeniedCount.value = 0
      } catch {
        autoplayDeniedCount.value++
      }
    }
    return
  }
  if (action === 'play' || action === 'next' || action === 'switch') {
    if (canControl.value) {
      autoplayDeniedCount.value = 0
      void video.play().catch(() => undefined)
      return
    }
    try {
      await video.play()
      autoplayDeniedCount.value = 0
    } catch {
      autoplayDeniedCount.value++
    }
  }
}

async function resyncPlaybackFromServer() {
  if (!canControl.value) {
    try {
      const snap = await fetchRoomSnapshot(auth.accessToken.value, props.room.id, snapshotPassword())
      await applyRoomSnapshot(snap)
    } catch {
      await refreshAuthoritativeState()
    }
  } else {
    await refreshAuthoritativeState()
  }
}

function onRoomClosed() {
  window.alert('房间已关闭')
  emit('admin-rooms-changed')
  emit('back')
}

async function onSyncProgressClick() {
  viewerLocalPause.value = false
  await resyncPlaybackFromServer()
  const v = videoElement.value
  const s = state.value
  if (v && s && s.action === 'play') {
    try {
      await v.play()
      autoplayDeniedCount.value = 0
    } catch {
      autoplayDeniedCount.value++
    }
  }
}

/** 观看者：先按服务端对齐进度，再本地播放（不调用房主控制 API） */
async function onViewerPlayClick() {
  viewerLocalPause.value = false
  await resyncPlaybackFromServer()
  const v = videoElement.value
  const s = state.value
  if (v && s && s.action === 'play') {
    try {
      await v.play()
      autoplayDeniedCount.value = 0
    } catch {
      autoplayDeniedCount.value++
    }
  }
}

/** 观看者：仅暂停本客户端，不改变房间状态 */
function onViewerPauseClick() {
  viewerLocalPause.value = true
  const v = videoElement.value
  if (v) v.pause()
}

function onOwnerPlay() {
  if (!canControl.value || applyingRemoteSync.value) return
  void submitOwnerControl({ action: 'play', position: getVideoTime() })
}

function onOwnerPause() {
  if (!canControl.value || applyingRemoteSync.value) return
  void submitOwnerControl({ action: 'pause', position: getVideoTime() })
}

function onOwnerSeeked() {
  if (!canControl.value || applyingRemoteSync.value) return
  void submitOwnerControl({ action: 'seek', position: getVideoTime() })
}

function onVideoEnded() {
  if (!canControl.value || applyingRemoteSync.value) return
  const q = queue.value.map((v) => v.id)
  const cur = currentVideo.value
  const mode = playbackMode.value
  const nextId = nextVideoAfterEnd(cur, q, mode)
  if (nextId) {
    currentVideo.value = nextId
    void submitOwnerControl({ action: 'switch', position: 0, video_id: nextId, queue: q })
  } else {
    void submitOwnerControl({ action: 'pause', position: getVideoTime() })
  }
}

async function addManualUrl() {
  if (!canControl.value || !manualUrl.value.trim()) return
  const url = manualUrl.value.trim()
  const stub: Video = {
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
  }
  const prev = [...queue.value]
  const newIds = [...prev.map((v) => v.id), url]
  queue.value = [...prev, stub]
  manualUrl.value = ''
  pendingQueueSubmit.value++
  const ok = await submitOwnerControl({ action: 'pause', position: getVideoTime(), queue: newIds })
  if (!ok) queue.value = prev
  pendingQueueSubmit.value--
}

async function addLibraryVideo(video: Video) {
  if (!canControl.value || queue.value.some((item) => item.id === video.id)) return
  const prev = [...queue.value]
  const newIds = [...prev.map((v) => v.id), video.id]
  queue.value = [...prev, video]
  pendingQueueSubmit.value++
  const ok = await submitOwnerControl({ action: 'pause', position: getVideoTime(), queue: newIds })
  if (!ok) queue.value = prev
  pendingQueueSubmit.value--
}

async function moveQueue(index: number, delta: number) {
  if (!canControl.value) return
  const target = index + delta
  if (target < 0 || target >= queue.value.length) return
  const prev = [...queue.value]
  const items = [...queue.value]
  const [item] = items.splice(index, 1)
  items.splice(target, 0, item)
  const newIds = items.map((v) => v.id)
  queue.value = items
  pendingQueueSubmit.value++
  const ok = await submitOwnerControl({ action: 'pause', position: getVideoTime(), queue: newIds })
  if (!ok) queue.value = prev
  pendingQueueSubmit.value--
}

async function removeQueue(index: number) {
  if (!canControl.value) return
  const prev = [...queue.value]
  const items = [...queue.value]
  items.splice(index, 1)
  const newIds = items.map((v) => v.id)
  queue.value = items
  pendingQueueSubmit.value++
  const ok = await submitOwnerControl({ action: 'pause', position: getVideoTime(), queue: newIds })
  if (!ok) queue.value = prev
  pendingQueueSubmit.value--
}

async function switchToQueueItem(item: Video) {
  if (!canControl.value) return
  const prev = currentVideo.value
  currentVideo.value = item.id
  const ok = await submitOwnerControl({
    action: 'switch',
    position: 0,
    video_id: item.id,
    queue: queue.value.map((v) => v.id),
  })
  if (!ok) currentVideo.value = prev
}

async function setPlaybackModeFromUi(mode: PlaybackMode) {
  if (!canControl.value) return
  const prev = playbackMode.value
  playbackMode.value = mode
  const ok = await submitOwnerControl({
    action: 'pause',
    position: getVideoTime(),
    playback_mode: mode,
  })
  if (!ok) playbackMode.value = prev
}

function onPlaybackModeChange(ev: Event) {
  const sel = ev.target as HTMLSelectElement | null
  if (!sel) return
  const v = sel.value
  if (v === 'loop' || v === 'sequential') void setPlaybackModeFromUi(v)
}

async function ownerNextTrack() {
  if (!canControl.value) return
  const q = queue.value.map((v) => v.id)
  const cur = currentVideo.value
  const nextId = nextInQueueForControl(cur, q, playbackMode.value)
  if (!nextId) return
  await submitOwnerControl({ action: 'next', position: 0, video_id: cur, queue: q })
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

function toggleViewerMute() {
  const v = videoElement.value
  if (!v) return
  v.muted = !v.muted
}

function setViewerVolume(e: Event) {
  const v = videoElement.value
  if (!v) return
  const t = e.target as HTMLInputElement
  v.volume = Number(t.value)
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
        <p v-if="roomActivityMessage" class="room-activity-toast" role="status">{{ roomActivityMessage }}</p>

        <div class="video-frame video-frame--stacked">
          <div class="video-frame__stack">
            <video
              ref="videoElement"
              :controls="canControl"
              playsinline
              v-on="ownerVideoListeners"
              @ended="onVideoEnded"
            />
            <div
              v-if="!canControl && showAutoplayBlockedOverlay"
              class="autoplay-blocked-overlay"
              role="dialog"
              aria-label="自动播放被阻止"
            >
              <p class="autoplay-blocked-overlay__title">房间正在播放，浏览器阻止了自动播放</p>
              <p v-if="autoplayOverlayHint" class="autoplay-blocked-overlay__hint muted">{{ autoplayOverlayHint }}</p>
              <AppButton variant="primary" type="button" @click="onSyncProgressClick">同步进度</AppButton>
            </div>
          </div>
          <div v-if="!canControl" class="viewer-chrome">
            <p class="viewer-chrome__hint">
              观看模式：进度与切视频由房主同步。控制栏仅含播放/暂停与音量；点击「播放」会先向服务端同步进度。暂停与音量仅作用于本机。
            </p>
            <div class="viewer-chrome__row viewer-chrome__row--controls">
              <AppButton size="sm" variant="primary" type="button" @click="onViewerPlayClick">播放</AppButton>
              <AppButton size="sm" variant="secondary" type="button" @click="onViewerPauseClick">暂停</AppButton>
              <label class="viewer-chrome__label">
                音量
                <input
                  class="ui-input"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="videoElement?.volume ?? 1"
                  @input="setViewerVolume"
                />
              </label>
              <AppButton size="sm" variant="secondary" type="button" @click="toggleViewerMute">
                {{ videoElement?.muted ? '取消静音' : '静音' }}
              </AppButton>
            </div>
          </div>
        </div>
        <p class="muted">当前视频：{{ selectedVideo?.title || currentVideo || '尚未选择视频' }}</p>
        <p v-if="controlError" class="error" role="alert">{{ controlError }}</p>
        <p v-if="!canControl" class="hint">普通成员为只读观看；进度与切视频由房主通过播放器与队列控制。</p>
        <p v-else class="hint">房主请使用播放器自带控件进行播放、暂停与拖动进度；队列变更会立即提交到服务端。</p>
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
        <p v-if="queueSyncPending" class="muted" role="status">正在同步队列到服务端…</p>
        <div class="playback-mode-row">
          <label class="playback-mode-label">
            播放模式
            <select class="ui-input" :value="playbackMode" :disabled="!canControl" @change="onPlaybackModeChange">
              <option value="sequential">顺序 — 最后一首结束后停止</option>
              <option value="loop">循环 — 最后一首后回到第一首</option>
            </select>
          </label>
          <AppButton v-if="canControl" size="sm" variant="secondary" type="button" @click="ownerNextTrack">下一首</AppButton>
        </div>
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
            <AppButton size="sm" :disabled="!canControl" @click="switchToQueueItem(item)">切换</AppButton>
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
.room-activity-toast {
  margin: 0.5rem 0 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.35);
  font-size: 0.875rem;
}
.video-frame--stacked {
  display: flex;
  flex-direction: column;
}
.video-frame__stack {
  position: relative;
}
.autoplay-blocked-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  text-align: center;
  background: rgba(2, 6, 23, 0.72);
  color: #f8fafc;
  z-index: 2;
}
.autoplay-blocked-overlay__title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  max-width: 22rem;
}
.autoplay-blocked-overlay__hint {
  margin: 0;
  font-size: 0.8125rem;
  max-width: 22rem;
}
.playback-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  margin-bottom: 0.75rem;
}
.playback-mode-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
}
.viewer-chrome {
  margin-top: 0.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.06);
}
.viewer-chrome__hint {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
}
.viewer-chrome__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.viewer-chrome__row--controls {
  align-items: flex-end;
}
.viewer-chrome__label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
}
@media (min-width: 961px) {
  .room-sidebar-close {
    display: none;
  }
}
</style>
