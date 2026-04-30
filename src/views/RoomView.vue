<script setup lang="ts">
import Hls from 'hls.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  API_BASE,
  ApiError,
  fetchRoomSnapshot,
  fetchRoomState,
  fetchVideo,
  kickRoomMember,
  sendRoomControl,
} from '../api'
import { useRoomRealtime } from '../composables/useRoomRealtime'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import { nextInQueueForControl, nextVideoAfterEnd } from '../utils/roomPlayback'
import {
  advancePlayPositionSinceServerUpdatedAt,
  refineRoomStateWithProjection,
} from '../utils/roomStateProjection'
import { waitForVideoReady } from '../utils/waitForVideo'
import { displayNameForUser } from '../utils/userDisplay'
import { clampDisplayTitle, shortTitleFromUrl } from '../utils/queueDisplay'
import type { PlaybackMode, Room, RoomPresenceMember, RoomSnapshotPayload, RoomState, RoomSocketMessage, Video } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppModal from '../components/ui/AppModal.vue'
import AppInput from '../components/ui/AppInput.vue'
import { useRoute } from 'vue-router'

const props = defineProps<{
  room: Room & { is_owner?: boolean }
  /** 仅运行期：普通成员进入私有房时由大厅传入，供 Ably 续签与 snapshot，不持久化 */
  joinPassword?: string
}>()
const emit = defineEmits<{ back: []; 'admin-rooms-changed': [] }>()
const auth = useAuthStore()
const route = useRoute()
const state = ref<RoomState | null>(null)
const playbackMode = ref<PlaybackMode>('sequential')
const serverControlVersion = ref(0)
/** 串行化房主控制 HTTP，避免并发请求共用旧 control_version 导致 409 stale */
let ownerControlLock: Promise<void> = Promise.resolve()
let ownerSeekSubmitTimer: ReturnType<typeof setTimeout> | null = null
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
const manualUrlTitle = ref('')
/** URL 队列条目的自定义展示名（仅前端；queue 提交仍为真实 URL id） */
const queueDisplayTitles = ref<Map<string, string>>(new Map())
const queueRenameDraft = ref('')
const queueRenameTargetId = ref<string | null>(null)
const queueRenameModalOpen = ref(false)
const queue = ref<Video[]>([])
const videoElement = ref<HTMLVideoElement | null>(null)
let hls: Hls | null = null
const scrubTime = ref(0)
const scrubDragging = ref(false)
const videoDuration = ref(0)
const localVideoPaused = ref(true)
const viewerMuted = ref(false)
const viewerVolume = ref(1)
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

const ownerVideoListeners = computed(() => (canControl.value ? { seeked: onOwnerSeeked } : {}))

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
  () => route.query.password,
  (q) => {
    if (props.room.visibility !== 'private' || isRoomOwnerOrAdmin.value) return
    const pwd = typeof q === 'string' ? q.trim() : ''
    if (pwd) runtimeRoomPassword.value = pwd
  },
  { immediate: true },
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

const selectedVideo = computed(() => queue.value.find((item) => item.id === currentVideo.value))
const displayedDuration = computed(() => {
  const candidates = [videoDuration.value, selectedVideo.value?.duration ?? 0]
  const duration = candidates.find((n) => Number.isFinite(n) && n > 0)
  return duration ?? 0
})
const progressMax = computed(() => Math.max(0.01, displayedDuration.value || 600))
const displayedCurrentTime = computed(() => {
  const max = displayedDuration.value || progressMax.value
  if (!Number.isFinite(scrubTime.value)) return 0
  return Math.min(Math.max(scrubTime.value, 0), max)
})
const isPlayingForUi = computed(() => !localVideoPaused.value && state.value?.action === 'play')

const shareModalOpen = ref(false)
const shareCopyFeedback = ref('')

const controlsVisible = ref(true)
const volumePopoverOpen = ref(false)
let controlsHideTimer: ReturnType<typeof setTimeout> | null = null
const CONTROLS_HIDE_MS = 3200

const showBigPlayOverlay = computed(
  () =>
    canControl.value &&
    queue.value.length > 0 &&
    (!currentVideo.value || !selectedVideo.value || !playbackUrl.value),
)

function displayTitleForQueueItem(item: Video): string {
  const custom = queueDisplayTitles.value.get(item.id)?.trim()
  if (custom) return clampDisplayTitle(custom)
  return clampDisplayTitle(item.title)
}

function shareRoomLink(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const base = `${origin}/room/${encodeURIComponent(props.room.id)}`
  if (props.room.visibility !== 'private') return base
  const pwd = runtimeRoomPassword.value.trim()
  if (!pwd) return base
  const q = new URLSearchParams({ password: pwd })
  return `${base}?${q.toString()}`
}

async function copyShareLink() {
  shareCopyFeedback.value = ''
  const url = shareRoomLink()
  try {
    await navigator.clipboard.writeText(url)
    shareCopyFeedback.value = '已复制到剪贴板'
  } catch {
    shareCopyFeedback.value = '复制失败，请手动全选复制'
  }
}

function scheduleControlsHide() {
  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer)
    controlsHideTimer = null
  }
  if (!canControl.value && !volumePopoverOpen.value && state.value?.action === 'play' && !showBigPlayOverlay.value) {
    controlsHideTimer = setTimeout(() => {
      controlsHideTimer = null
      controlsVisible.value = false
    }, CONTROLS_HIDE_MS)
  }
}

function showControlsBar() {
  controlsVisible.value = true
  scheduleControlsHide()
}

function onPlayerChromePointerMove() {
  showControlsBar()
}

function onPlayerChromePointerLeave() {
  scheduleControlsHide()
}

function onPlayerChromeTouchStart() {
  showControlsBar()
}

function onVideoAreaFocusIn() {
  showControlsBar()
}

watch([() => state.value?.action, volumePopoverOpen, showBigPlayOverlay], () => {
  if (state.value?.action !== 'play' || volumePopoverOpen.value || showBigPlayOverlay.value) {
    if (controlsHideTimer) {
      clearTimeout(controlsHideTimer)
      controlsHideTimer = null
    }
    controlsVisible.value = true
    return
  }
  scheduleControlsHide()
})

watch(shareModalOpen, (open) => {
  if (!open) shareCopyFeedback.value = ''
})

/** 与 Vercel 无本机文件场景对齐：优先外链 / `source_url`，其次 `/api/...` 相对路径 */
function resolveVideoPlaybackUrl(video: Video): string {
  const direct = video.file_url?.trim() || video.source_url?.trim()
  if (direct) {
    if (direct.startsWith('http://') || direct.startsWith('https://') || direct.startsWith('//')) {
      return direct
    }
    if (direct.startsWith('/')) return `${API_BASE}${direct}`
    return direct
  }
  const rel = video.file_path?.trim()
  if (rel) {
    if (rel.startsWith('http://') || rel.startsWith('https://') || rel.startsWith('//')) return rel
    if (rel.startsWith('/')) return `${API_BASE}${rel}`
    return `${API_BASE}/${rel.replace(/^\//, '')}`
  }
  return `${API_BASE}/api/videos/${encodeURIComponent(video.id)}/file`
}

const playbackUrl = computed(() => {
  if (!selectedVideo.value) return currentVideo.value
  return resolveVideoPlaybackUrl(selectedVideo.value)
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
    const custom = queueDisplayTitles.value.get(id)?.trim()
    const defaultTitle = shortTitleFromUrl(id)
    return {
      id,
      title: custom ? clampDisplayTitle(custom) : defaultTitle,
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
  try {
    const v = await fetchVideo(token, id)
    return v
  } catch {
    return {
      id,
      title: `未知视频 (${id.slice(0, 8)}…)`,
      file_path: `/api/videos/${encodeURIComponent(id)}/file`,
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
    serverControlVersion.value = Math.max(serverControlVersion.value, s.control_version)
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

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${mins}:${String(secs).padStart(2, '0')}`
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
  const merged = { ...s, room_id: props.room.id }
  const aligned = advancePlayPositionSinceServerUpdatedAt(merged, Date.now(), playbackMode.value)
  state.value = aligned
  currentVideo.value = s.video_id || ''
  if (!canControl.value && prevVideoId !== (s.video_id || '')) {
    viewerLocalPause.value = false
  }
  runWithRemoteSync(() => syncPlayerFromState(aligned.action, aligned.position))
}

async function submitOwnerControl(input: {
  action: RoomSocketMessage['action']
  position: number
  video_id?: string
  queue?: string[]
  playback_mode?: PlaybackMode
}): Promise<boolean> {
  if (!canControl.value) return false
  const previous = ownerControlLock
  let release!: () => void
  ownerControlLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await performOwnerControl(input, false)
  } finally {
    release()
  }
}

async function performOwnerControl(
  input: {
    action: RoomSocketMessage['action']
    position: number
    video_id?: string
    queue?: string[]
    playback_mode?: PlaybackMode
  },
  afterStaleRetry: boolean,
): Promise<boolean> {
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
    const staleConflict =
      err instanceof ApiError &&
      err.status === 409 &&
      /stale control version/i.test(String(err.message))
    if (staleConflict && !afterStaleRetry) {
      try {
        const snap = await fetchRoomSnapshot(auth.accessToken.value, props.room.id, snapshotPassword())
        await applyRoomSnapshot(snap)
      } catch {
        try {
          await refreshAuthoritativeState()
        } catch {
          // ignore
        }
      }
      return performOwnerControl(input, true)
    }
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
    const ids = new Set(queue.value.map((v) => v.id))
    queueDisplayTitles.value = new Map(
      [...queueDisplayTitles.value].filter(([k]) => ids.has(k)),
    )
  } else if (!queueIds.length && payload.state?.video_id) {
    queue.value = await buildQueueFromIds([payload.state.video_id], auth.accessToken.value)
  }
  await nextTick()
  loadPlaybackSource()
  await nextTick()
  if (state.value) {
    const aligned = advancePlayPositionSinceServerUpdatedAt(state.value, Date.now(), playbackMode.value)
    state.value = aligned
    runWithRemoteSync(() => syncPlayerFromState(aligned.action, aligned.position))
  }
}

onMounted(async () => {
  roomLoadError.value = ''
  try {
    const snapshot = await fetchRoomSnapshot(auth.accessToken.value, props.room.id, snapshotPassword())
    await applyRoomSnapshot(snapshot)
    if (!ablyChannelName.value) {
      roomLoadError.value = '房间快照未返回 Ably 频道名，无法建立实时连接'
      return
    }
    connectRealtime()
    showControlsBar()
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      roomLoadError.value = '房间已关闭或不存在'
      emit('admin-rooms-changed')
    } else if (err instanceof ApiError && err.status === 403) {
      roomLoadError.value = formatApiError(err, '无权进入：请检查分享链接中的密码，或返回大厅重新加入')
    } else {
      roomLoadError.value = formatApiError(err, '加载房间失败')
    }
  }
})

onBeforeUnmount(() => {
  if (ownerSeekSubmitTimer) {
    clearTimeout(ownerSeekSubmitTimer)
    ownerSeekSubmitTimer = null
  }
  if (remoteSyncClearTimer) {
    clearTimeout(remoteSyncClearTimer)
    remoteSyncClearTimer = null
  }
  if (roomActivityClearTimer) {
    clearTimeout(roomActivityClearTimer)
    roomActivityClearTimer = null
  }
  if (controlsHideTimer) {
    clearTimeout(controlsHideTimer)
    controlsHideTimer = null
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
    const name = displayNameForUser(u) || '某用户'

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

function onVideoLoadedMetadata() {
  const v = videoElement.value
  videoDuration.value = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
  scrubTime.value = v?.currentTime ?? 0
  localVideoPaused.value = v?.paused ?? true
  viewerMuted.value = v?.muted ?? false
  viewerVolume.value = v?.volume ?? 1
}

function onVideoTimeUpdate() {
  if (scrubDragging.value) return
  const v = videoElement.value
  if (v && Number.isFinite(v.currentTime)) scrubTime.value = v.currentTime
}

function onScrubPointerDown() {
  scrubDragging.value = true
}

function onScrubPointerUp() {
  scrubDragging.value = false
  const v = videoElement.value
  if (v && Number.isFinite(scrubTime.value)) v.currentTime = scrubTime.value
}

function onScrubInput(e: Event) {
  const t = e.target as HTMLInputElement
  const n = Number(t.value)
  scrubTime.value = n
  const v = videoElement.value
  if (v && canControl.value) v.currentTime = n
}

function onVideoPlay() {
  localVideoPaused.value = false
  if (canControl.value) onOwnerPlay()
}

function onVideoPause() {
  localVideoPaused.value = true
  if (canControl.value) onOwnerPause()
}

async function onPrimaryPlaybackClick() {
  if (isPlayingForUi.value) {
    if (canControl.value) {
      onOwnerPause()
    } else {
      onViewerPauseClick()
    }
    return
  }
  if (canControl.value) {
    await onOwnerBarPlayClick()
  } else {
    await onViewerPlayClick()
  }
}

function loadPlaybackSource() {
  const video = videoElement.value
  if (!video || !playbackUrl.value) return
  hls?.destroy()
  hls = null
  const url = playbackUrl.value
  const looksLikeHls = url.endsWith('.m3u8') || /\.m3u8(\?|$)/i.test(url)
  if (looksLikeHls) {
    if (Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(url)
      hls.attachMedia(video)
      return
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      video.load()
      return
    }
  }
  video.src = url
  video.load()
  void video.addEventListener(
    'loadedmetadata',
    () => {
      scrubTime.value = Number.isFinite(video.currentTime) ? video.currentTime : 0
      videoDuration.value = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    },
    { once: true },
  )
}

async function syncPlayerFromState(action: RoomSocketMessage['action'], nextPosition: number) {
  const video = videoElement.value
  if (!video) return
  await waitForVideoReady(video)
  if (Number.isFinite(nextPosition)) {
    video.currentTime = nextPosition
    scrubTime.value = nextPosition
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

async function onViewerPlayWhenWaitingOwner() {
  viewerLocalPause.value = false
  showRoomActivity('等待房主开始播放')
}

/** 观看者：先按服务端对齐进度，再本地播放（不调用房主控制 API） */
async function onViewerPlayClick() {
  const hasCurrent = Boolean(currentVideo.value && selectedVideo.value && playbackUrl.value)
  if (!hasCurrent && queue.value.length > 0) {
    await onViewerPlayWhenWaitingOwner()
    return
  }
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
  if (ownerSeekSubmitTimer) clearTimeout(ownerSeekSubmitTimer)
  ownerSeekSubmitTimer = setTimeout(() => {
    ownerSeekSubmitTimer = null
    void submitOwnerControl({ action: 'seek', position: getVideoTime() })
  }, 220)
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
  const display = manualUrlTitle.value.trim() || shortTitleFromUrl(url)
  const nextTitles = new Map(queueDisplayTitles.value)
  nextTitles.set(url, display)
  queueDisplayTitles.value = nextTitles
  const stub: Video = {
    id: url,
    title: clampDisplayTitle(display),
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
  manualUrlTitle.value = ''
  pendingQueueSubmit.value++
  const ok = await submitOwnerControl({ action: 'pause', position: getVideoTime(), queue: newIds })
  if (!ok) {
    queue.value = prev
    const rollback = new Map(queueDisplayTitles.value)
    rollback.delete(url)
    queueDisplayTitles.value = rollback
  }
  pendingQueueSubmit.value--
}

function firstQueueVideoId(): string | null {
  return queue.value[0]?.id ?? null
}

async function ownerStartQueuePlayback() {
  const firstId = firstQueueVideoId()
  if (!firstId || !canControl.value) return
  const prev = currentVideo.value
  currentVideo.value = firstId
  const ok = await submitOwnerControl({
    action: 'play',
    position: 0,
    video_id: firstId,
    queue: queue.value.map((v) => v.id),
  })
  if (!ok) currentVideo.value = prev
}

async function onOwnerBarPlayClick() {
  if (!canControl.value) return
  const hasCurrent = Boolean(currentVideo.value && selectedVideo.value && playbackUrl.value)
  if (!hasCurrent && queue.value.length > 0) {
    await ownerStartQueuePlayback()
    return
  }
  onOwnerPlay()
}

function openQueueRename(item: Video) {
  if (!canControl.value) return
  queueRenameTargetId.value = item.id
  queueRenameDraft.value = queueDisplayTitles.value.get(item.id)?.trim() ?? displayTitleForQueueItem(item)
  queueRenameModalOpen.value = true
}

function closeQueueRename() {
  queueRenameModalOpen.value = false
  queueRenameTargetId.value = null
  queueRenameDraft.value = ''
}

function applyQueueRename() {
  if (!canControl.value || !queueRenameTargetId.value) return
  const id = queueRenameTargetId.value
  const raw = queueRenameDraft.value.trim()
  const nextMap = new Map(queueDisplayTitles.value)
  if (!raw || raw === shortTitleFromUrl(id)) {
    nextMap.delete(id)
  } else {
    nextMap.set(id, clampDisplayTitle(raw))
  }
  queueDisplayTitles.value = nextMap
  queue.value = queue.value.map((v) => {
    if (v.id !== id) return v
    const t = displayTitleForQueueItem(v)
    return { ...v, title: t }
  })
  closeQueueRename()
}

function onEnterPictureInPicture(ev: Event) {
  const v = ev.target as HTMLVideoElement & { exitPictureInPicture?: () => Promise<void> }
  try {
    void v.exitPictureInPicture?.()
  } catch {
    // ignore
  }
  showRoomActivity('当前房间不支持小窗播放，已退出画中画。')
}

function onVideoWrapperClick(ev: MouseEvent) {
  const t = ev.target as HTMLElement
  if (t.closest('.player-chrome') || t.closest('.autoplay-blocked-overlay') || t.closest('.big-play-overlay')) return
  if (canControl.value) showControlsBar()
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
  const removedId = items[index]?.id
  items.splice(index, 1)
  const newIds = items.map((v) => v.id)
  queue.value = items
  if (removedId) {
    const nextMap = new Map(queueDisplayTitles.value)
    nextMap.delete(removedId)
    queueDisplayTitles.value = nextMap
  }
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

async function kick(member: RoomPresenceMember) {
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
  viewerMuted.value = v.muted
}

function setViewerVolume(e: Event) {
  const v = videoElement.value
  if (!v) return
  const t = e.target as HTMLInputElement
  const nextVolume = Number(t.value)
  v.volume = nextVolume
  viewerVolume.value = nextVolume
  if (nextVolume > 0 && v.muted) {
    v.muted = false
    viewerMuted.value = false
  }
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
        <div class="room-title-row">
          <h2 class="room-title">{{ room.name }}</h2>
          <AppButton size="sm" variant="secondary" type="button" @click="shareModalOpen = true">分享房间</AppButton>
        </div>
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

        <div
          class="video-frame video-frame--stacked"
          @pointermove="onPlayerChromePointerMove"
          @pointerleave="onPlayerChromePointerLeave"
          @touchstart.passive="onPlayerChromeTouchStart"
          @focusin.capture="onVideoAreaFocusIn"
          @click="onVideoWrapperClick"
        >
          <div class="video-frame__stack player-stack">
            <video
              ref="videoElement"
              class="room-video"
              :controls="false"
              playsinline
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noplaybackrate noremoteplayback"
              @loadedmetadata="onVideoLoadedMetadata"
              @timeupdate="onVideoTimeUpdate"
              @play="onVideoPlay"
              @pause="onVideoPause"
              @enterpictureinpicture="onEnterPictureInPicture"
              v-on="ownerVideoListeners"
              @ended="onVideoEnded"
            />
            <div
              v-if="showBigPlayOverlay"
              class="big-play-overlay"
              role="region"
              aria-label="开始播放队列"
            >
              <AppButton variant="primary" type="button" @click.stop="ownerStartQueuePlayback">播放队列</AppButton>
            </div>
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
            <div
              class="player-chrome"
              :class="{ 'player-chrome--hidden': !controlsVisible && !showBigPlayOverlay }"
              @pointermove.stop="showControlsBar"
            >
              <label class="player-chrome__scrub" @pointerdown.stop @click.stop>
                <span class="sr-only">进度</span>
                <input
                  class="player-chrome__range"
                  type="range"
                  :min="0"
                  :max="progressMax"
                  step="0.25"
                  :value="displayedCurrentTime"
                  :disabled="!canControl"
                  :aria-valuetext="`${formatPlaybackTime(displayedCurrentTime)} / ${formatPlaybackTime(displayedDuration)}`"
                  @pointerdown.stop="onScrubPointerDown"
                  @pointerup.stop="onScrubPointerUp"
                  @input.stop="onScrubInput"
                />
              </label>
              <div class="player-chrome__control-row">
                <button
                  class="player-chrome__icon-button player-chrome__play-button"
                  type="button"
                  :aria-label="isPlayingForUi ? '暂停' : '播放'"
                  @click.stop="onPrimaryPlaybackClick"
                >
                  <span aria-hidden="true">{{ isPlayingForUi ? '❚❚' : '▶' }}</span>
                </button>
                <div class="player-chrome__time" aria-live="off">
                  <span>{{ formatPlaybackTime(displayedCurrentTime) }}</span>
                  <span class="player-chrome__time-separator">/</span>
                  <span>{{ formatPlaybackTime(displayedDuration) }}</span>
                </div>
                <div class="player-chrome__spacer" />
                <label class="player-chrome__volume" @pointerdown.stop @click.stop>
                  <span class="sr-only">音量</span>
                  <input
                    class="player-chrome__volume-range"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    :value="viewerVolume"
                    @focus="volumePopoverOpen = true"
                    @blur="volumePopoverOpen = false"
                    @input="setViewerVolume"
                  />
                </label>
                <button
                  class="player-chrome__icon-button"
                  type="button"
                  :aria-label="viewerMuted ? '取消静音' : '静音'"
                  @click.stop="toggleViewerMute"
                >
                  <span aria-hidden="true">{{ viewerMuted ? '🔇' : '🔊' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <p class="muted">当前视频：{{ selectedVideo?.title || currentVideo || '尚未选择视频' }}</p>
        <p v-if="controlError" class="error" role="alert">{{ controlError }}</p>
        <p v-if="!canControl" class="hint">
          进度与切视频由房主控制；你可正常观看并与房间同步。播放/暂停可先对齐服务端进度；音量与静音仅作用于本机。
        </p>
        <p v-else class="hint">房主可使用下方控制条与进度条；队列变更会立即提交到服务端。</p>
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
        <form class="inline-form inline-form--stack" @submit.prevent="addManualUrl">
          <input v-model="manualUrl" class="ui-input" placeholder="添加 mp4 / m3u8 URL" :disabled="!canControl" />
          <input
            v-model="manualUrlTitle"
            class="ui-input"
            placeholder="显示名称（可选）"
            :disabled="!canControl"
          />
          <AppButton type="submit" size="sm" :disabled="!canControl">添加</AppButton>
        </form>
        <p v-if="!canControl" class="muted queue-owner-hint">队列由房主管理；你可查看顺序与当前条目。</p>
        <div class="queue-item" v-for="(item, index) in queue" :key="item.id">
          <div class="queue-item__text">
            <strong :title="item.file_url || item.file_path || item.id">{{ displayTitleForQueueItem(item) }}</strong>
            <small class="queue-url-line" :title="item.file_url || item.file_path">{{ item.file_url || item.file_path }}</small>
          </div>
          <div class="queue-actions">
            <AppButton
              v-if="canControl"
              size="sm"
              variant="secondary"
              :disabled="index === 0"
              @click="moveQueue(index, -1)"
            >
              上移
            </AppButton>
            <AppButton
              v-if="canControl"
              size="sm"
              variant="secondary"
              :disabled="index === queue.length - 1"
              @click="moveQueue(index, 1)"
            >
              下移
            </AppButton>
            <AppButton v-if="canControl" size="sm" :disabled="!canControl" @click="switchToQueueItem(item)">切换</AppButton>
            <AppButton v-if="canControl" size="sm" variant="secondary" @click="openQueueRename(item)">改名</AppButton>
            <AppButton v-if="canControl" size="sm" variant="danger" :disabled="!canControl" @click="removeQueue(index)">删除</AppButton>
          </div>
        </div>
      </AppCard>

      <AppCard padding="compact">
        <h3 class="sidebar-heading">在线成员（Ably Presence）</h3>
        <div class="member" v-for="member in members" :key="member.connectionId || member.id">
          <span class="avatar">{{ displayNameForUser(member).slice(0, 1).toUpperCase() }}</span>
          <span>
            {{ displayNameForUser(member) }}
            <small class="muted">@{{ member.username }}</small>
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

    <AppModal v-model="shareModalOpen" title="分享房间">
      <p class="muted" style="margin-top: 0">
        复制下方链接即可邀请他人进入同一房间。私有房链接可能包含密码参数，请勿公开发布。
      </p>
      <textarea class="share-url-field" readonly rows="3" :value="shareRoomLink()" />
      <p v-if="shareCopyFeedback" class="muted" role="status">{{ shareCopyFeedback }}</p>
      <template #footer>
        <AppButton variant="secondary" type="button" @click="shareModalOpen = false">关闭</AppButton>
        <AppButton variant="primary" type="button" @click="copyShareLink">复制链接</AppButton>
      </template>
    </AppModal>

    <AppModal v-model="queueRenameModalOpen" title="编辑显示名称" @close="closeQueueRename">
      <AppInput v-model="queueRenameDraft" label="显示名称" hint="留空或恢复默认则使用短链接标题" />
      <template #footer>
        <AppButton variant="secondary" type="button" @click="closeQueueRename">取消</AppButton>
        <AppButton variant="primary" type="button" @click="applyQueueRename">保存</AppButton>
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.room-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.room-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.player-stack {
  background: #0f172a;
  border-radius: 0.5rem;
  overflow: hidden;
}
.room-video {
  display: block;
  width: 100%;
  max-height: min(70vh, 520px);
  vertical-align: middle;
}
.big-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.45);
  z-index: 3;
  pointer-events: auto;
}
.player-chrome {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1.65rem 0.75rem 0.65rem;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.58) 42%, rgba(0, 0, 0, 0.74) 100%);
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  z-index: 4;
  transition: opacity 0.25s ease, transform 0.25s ease;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
}
.player-chrome > * {
  pointer-events: auto;
}
.player-chrome--hidden {
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
}
.player-chrome--hidden > * {
  pointer-events: none;
}
.player-chrome__control-row {
  display: flex;
  align-items: center;
  min-height: 2.1rem;
  gap: 0.5rem;
}
.player-chrome__scrub {
  display: flex;
  margin: 0;
}
.player-chrome__range {
  width: 100%;
  height: 0.95rem;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
  accent-color: #f59e0b;
}
.player-chrome__range:disabled {
  cursor: default;
}
.player-chrome__range::-webkit-slider-runnable-track,
.player-chrome__volume-range::-webkit-slider-runnable-track {
  height: 0.2rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
}
.player-chrome__range::-webkit-slider-thumb,
.player-chrome__volume-range::-webkit-slider-thumb {
  appearance: none;
  width: 0.82rem;
  height: 0.82rem;
  margin-top: -0.31rem;
  border-radius: 999px;
  border: 2px solid #fff;
  background: #f59e0b;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}
.player-chrome__range::-moz-range-track,
.player-chrome__volume-range::-moz-range-track {
  height: 0.2rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
}
.player-chrome__range::-moz-range-progress,
.player-chrome__volume-range::-moz-range-progress {
  height: 0.2rem;
  border-radius: 999px;
  background: #f59e0b;
}
.player-chrome__range::-moz-range-thumb,
.player-chrome__volume-range::-moz-range-thumb {
  width: 0.72rem;
  height: 0.72rem;
  border-radius: 999px;
  border: 2px solid #fff;
  background: #f59e0b;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}
.player-chrome__range:focus-visible,
.player-chrome__volume-range:focus-visible,
.player-chrome__icon-button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.95);
  outline-offset: 3px;
}
.player-chrome__icon-button {
  display: inline-grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #fff;
  font-size: 1.08rem;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.player-chrome__icon-button:hover {
  background: rgba(255, 255, 255, 0.14);
}
.player-chrome__icon-button:active {
  transform: scale(0.94);
}
.player-chrome__play-button {
  font-size: 1.15rem;
}
.player-chrome__time {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  min-width: 7.4rem;
  color: rgba(255, 255, 255, 0.94);
  font-variant-numeric: tabular-nums;
  font-size: 0.86rem;
  font-weight: 600;
}
.player-chrome__time-separator {
  color: rgba(255, 255, 255, 0.66);
}
.player-chrome__spacer {
  flex: 1;
}
.player-chrome__volume {
  display: flex;
  align-items: center;
  width: clamp(4.5rem, 12vw, 7rem);
  margin: 0;
}
.player-chrome__volume-range {
  width: 100%;
  height: 0.95rem;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
  accent-color: #fff;
}
@media (max-width: 640px) {
  .player-chrome {
    padding: 1.35rem 0.55rem 0.5rem;
  }
  .player-chrome__control-row {
    gap: 0.35rem;
  }
  .player-chrome__icon-button {
    width: 1.9rem;
    height: 1.9rem;
  }
  .player-chrome__time {
    min-width: 5.9rem;
    font-size: 0.76rem;
  }
  .player-chrome__volume {
    display: none;
  }
}
.share-url-field {
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
  padding: 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  resize: vertical;
}
.inline-form--stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: stretch;
}
.queue-owner-hint {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
}
.queue-item__text {
  min-width: 0;
  flex: 1;
}
.queue-url-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
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
