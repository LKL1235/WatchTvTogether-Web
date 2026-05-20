import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue'

const BOTTOM_THRESHOLD_PX = 80

export function useChatScroll(
  messageCount: Ref<number>,
  loading: Ref<boolean>,
) {
  const logRef = ref<HTMLElement | null>(null)
  const isAtBottom = ref(true)
  const showNewMessages = ref(false)

  function distanceFromBottom(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }

  function scrollToBottom(smooth = false) {
    const el = logRef.value
    if (!el) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    })
    isAtBottom.value = true
    showNewMessages.value = false
  }

  function onLogScroll() {
    const el = logRef.value
    if (!el) return
    isAtBottom.value = distanceFromBottom(el) <= BOTTOM_THRESHOLD_PX
    if (isAtBottom.value) showNewMessages.value = false
  }

  function jumpToLatest() {
    scrollToBottom(true)
  }

  let prevCount = messageCount.value

  const stopCount = watch(messageCount, (n) => {
    if (n <= prevCount) {
      prevCount = n
      return
    }
    prevCount = n
    void nextTick(() => {
      if (isAtBottom.value) scrollToBottom()
      else showNewMessages.value = true
    })
  })

  const stopLoading = watch(loading, (now, was) => {
    if (was && !now) {
      void nextTick(() => scrollToBottom())
    }
  })

  onUnmounted(() => {
    stopCount()
    stopLoading()
  })

  return {
    logRef,
    isAtBottom,
    showNewMessages,
    onLogScroll,
    scrollToBottom,
    jumpToLatest,
  }
}
