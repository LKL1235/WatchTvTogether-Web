<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import AppButton from '../ui/AppButton.vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const DEFAULT_VH = 65
const MAX_VH = 92
const sheetVh = ref(DEFAULT_VH)

let dragStartY = 0
let dragStartVh = DEFAULT_VH
let dragging = false

function resetHeight() {
  sheetVh.value = DEFAULT_VH
}

watch(
  () => props.open,
  (open) => {
    if (!open) resetHeight()
  },
)

function onHandlePointerDown(ev: PointerEvent) {
  dragging = true
  dragStartY = ev.clientY
  dragStartVh = sheetVh.value
  ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
}

function onHandlePointerMove(ev: PointerEvent) {
  if (!dragging) return
  const deltaY = dragStartY - ev.clientY
  const vhDelta = (deltaY / window.innerHeight) * 100
  sheetVh.value = Math.max(DEFAULT_VH, Math.min(MAX_VH, dragStartVh + vhDelta))
}

function endDrag(ev: PointerEvent) {
  if (!dragging) return
  dragging = false
  const target = ev.currentTarget as HTMLElement
  if (target.hasPointerCapture?.(ev.pointerId)) {
    target.releasePointerCapture(ev.pointerId)
  }
  if (sheetVh.value > (DEFAULT_VH + MAX_VH) / 2) {
    sheetVh.value = MAX_VH
  } else {
    sheetVh.value = DEFAULT_VH
  }
}

function onBackdropClick() {
  emit('close')
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && props.open) emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="room-chat-sheet-root"
      role="presentation"
    >
      <div class="room-chat-sheet-backdrop" @click="onBackdropClick" />
      <section
        class="room-chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="房间聊天"
        :style="{ '--room-chat-sheet-vh': `${sheetVh}vh` }"
      >
        <div
          class="room-chat-sheet__handle"
          @pointerdown="onHandlePointerDown"
          @pointermove="onHandlePointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <span class="room-chat-sheet__grip" aria-hidden="true" />
        </div>
        <header class="room-chat-sheet__header">
          <h3 class="room-chat-sheet__title">聊天</h3>
          <AppButton variant="ghost" size="sm" type="button" @click="emit('close')">关闭</AppButton>
        </header>
        <div class="room-chat-sheet__body">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.room-chat-sheet-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  pointer-events: none;
}

.room-chat-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}

.room-chat-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  height: var(--room-chat-sheet-vh, 65vh);
  max-height: 92vh;
  background: var(--color-bg-card);
  border-top: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  min-height: 0;
}

.room-chat-sheet__handle {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0.25rem;
  cursor: ns-resize;
  touch-action: none;
}

.room-chat-sheet__grip {
  width: 2.5rem;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--color-border-strong);
}

.room-chat-sheet__header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 1rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
}

.room-chat-sheet__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.room-chat-sheet__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1rem 1rem;
}
</style>
