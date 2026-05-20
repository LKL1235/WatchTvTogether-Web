import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

export const CHAT_PANEL_STORAGE_KEY = 'wtt.roomChatPanel.v1'
export const DEFAULT_CHAT_WIDTH = 340
export const MIN_CHAT_WIDTH = 280
export const MAX_CHAT_WIDTH_PX = 480
export const COLLAPSED_STRIP_WIDTH = 40
const DESKTOP_MQ = '(min-width: 961px)'

interface ChatPanelPrefs {
  width?: number
  collapsed?: boolean
}

function readPrefs(): ChatPanelPrefs {
  try {
    const raw = localStorage.getItem(CHAT_PANEL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ChatPanelPrefs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePrefs(width: number, collapsed: boolean) {
  try {
    localStorage.setItem(
      CHAT_PANEL_STORAGE_KEY,
      JSON.stringify({ width: Math.round(width), collapsed }),
    )
  } catch {
    /* ignore quota */
  }
}

export function maxChatWidthPx(): number {
  if (typeof window === 'undefined') return MAX_CHAT_WIDTH_PX
  return Math.min(MAX_CHAT_WIDTH_PX, Math.floor(window.innerWidth * 0.38))
}

export function clampChatWidth(w: number): number {
  return Math.max(MIN_CHAT_WIDTH, Math.min(maxChatWidthPx(), w))
}

export function useRoomChatPanelLayout() {
  const prefs = readPrefs()
  const width = ref(clampChatWidth(typeof prefs.width === 'number' ? prefs.width : DEFAULT_CHAT_WIDTH))
  const collapsed = ref(Boolean(prefs.collapsed))
  const isDesktop = ref(
    typeof window !== 'undefined' ? window.matchMedia(DESKTOP_MQ).matches : true,
  )
  const isFullscreen = ref(false)
  const isResizing = ref(false)

  let resizeRaf = 0
  let resizeStartX = 0
  let resizeStartWidth = 0

  function persist() {
    writePrefs(width.value, collapsed.value)
  }

  function clampToViewport() {
    width.value = clampChatWidth(width.value)
  }

  function toggleCollapsed() {
    collapsed.value = !collapsed.value
    persist()
  }

  function resetWidth() {
    width.value = DEFAULT_CHAT_WIDTH
    persist()
  }

  function onResizePointerDown(ev: PointerEvent) {
    if (!isDesktop.value || collapsed.value) return
    ev.preventDefault()
    isResizing.value = true
    resizeStartX = ev.clientX
    resizeStartWidth = width.value
    const target = ev.currentTarget as HTMLElement
    target.setPointerCapture(ev.pointerId)
    document.body.style.userSelect = 'none'
  }

  function onResizePointerMove(ev: PointerEvent) {
    if (!isResizing.value) return
    const delta = resizeStartX - ev.clientX
    const next = clampChatWidth(resizeStartWidth + delta)
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      width.value = next
    })
  }

  function endResize(ev: PointerEvent) {
    if (!isResizing.value) return
    const delta = resizeStartX - ev.clientX
    const finalWidth = clampChatWidth(resizeStartWidth + delta)
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = 0
    }
    width.value = finalWidth
    isResizing.value = false
    document.body.style.userSelect = ''
    const target = ev.currentTarget as HTMLElement
    if (target.hasPointerCapture?.(ev.pointerId)) {
      target.releasePointerCapture(ev.pointerId)
    }
    persist()
  }

  function onResizerKeydown(ev: KeyboardEvent) {
    if (!isDesktop.value || collapsed.value) return
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault()
      width.value = clampChatWidth(width.value + 16)
      persist()
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault()
      width.value = clampChatWidth(width.value - 16)
      persist()
    }
  }

  function updateFullscreenState() {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
    }
    const el =
      document.fullscreenElement ??
      doc.webkitFullscreenElement ??
      null
    isFullscreen.value = Boolean(el)
  }

  const showDesktopChat = computed(
    () => isDesktop.value && !isFullscreen.value,
  )

  const chatPanelWidthPx = computed(() =>
    collapsed.value ? COLLAPSED_STRIP_WIDTH : width.value,
  )

  const chatPanelStyle = computed(() => ({
    '--room-chat-width': `${chatPanelWidthPx.value}px`,
  }))

  let desktopMq: MediaQueryList | null = null
  let onMqChange: (() => void) | null = null

  onMounted(() => {
    clampToViewport()
    desktopMq = window.matchMedia(DESKTOP_MQ)
    onMqChange = () => {
      isDesktop.value = desktopMq?.matches ?? false
      clampToViewport()
    }
    desktopMq.addEventListener('change', onMqChange)
    window.addEventListener('resize', clampToViewport)
    document.addEventListener('fullscreenchange', updateFullscreenState)
    document.addEventListener('webkitfullscreenchange', updateFullscreenState)
    updateFullscreenState()
  })

  onUnmounted(() => {
    if (desktopMq && onMqChange) desktopMq.removeEventListener('change', onMqChange)
    window.removeEventListener('resize', clampToViewport)
    document.removeEventListener('fullscreenchange', updateFullscreenState)
    document.removeEventListener('webkitfullscreenchange', updateFullscreenState)
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    document.body.style.userSelect = ''
  })

  watch(width, () => {
    if (!isResizing.value) persist()
  })

  return {
    width,
    collapsed,
    isDesktop,
    isFullscreen,
    isResizing,
    showDesktopChat,
    chatPanelStyle,
    chatPanelWidthPx,
    minChatWidth: MIN_CHAT_WIDTH,
    maxChatWidth: computed(() => maxChatWidthPx()),
    toggleCollapsed,
    resetWidth,
    onResizePointerDown,
    onResizePointerMove,
    endResize,
    onResizerKeydown,
    clampToViewport,
  }
}
