<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { PlaybackMode, Video } from '../../types'
import AppButton from '../ui/AppButton.vue'
import AppCard from '../ui/AppCard.vue'

const props = defineProps<{
  open: boolean
  queue: Video[]
  playbackMode: PlaybackMode
  canControl: boolean
  queueSyncPending: boolean
  manualUrl: string
  manualUrlTitle: string
  isDev: boolean
  eventPreview: string
  displayTitle: (item: Video) => string
}>()

const emit = defineEmits<{
  close: []
  'update:manualUrl': [value: string]
  'update:manualUrlTitle': [value: string]
  'playback-mode-change': [ev: Event]
  'owner-next-track': []
  'add-manual-url': []
  'move-queue': [index: number, delta: number]
  'switch-queue-item': [item: Video]
  'open-queue-rename': [item: Video]
  'remove-queue': [index: number]
}>()

/** Keep drawer mounted during close transition (v-if + is-open on same tick skips CSS transition). */
const rendered = ref(false)
const panelOpen = ref(false)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      rendered.value = true
      await nextTick()
      panelOpen.value = true
    } else {
      panelOpen.value = false
    }
  },
  { immediate: true },
)

function onDrawerTransitionEnd(ev: TransitionEvent) {
  if (ev.target !== ev.currentTarget || ev.propertyName !== 'transform') return
  if (!panelOpen.value && !props.open) {
    rendered.value = false
  }
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="rendered" class="room-tools-root" role="presentation">
      <div class="room-tools-backdrop" @click="emit('close')" />
      <aside
        class="room-tools-drawer"
        :class="{ 'is-open': panelOpen }"
        role="dialog"
        aria-modal="true"
        aria-label="视频队列"
        @keydown="onKeydown"
        @transitionend="onDrawerTransitionEnd"
      >
        <div class="room-tools-drawer__head">
          <h3 class="room-tools-drawer__title">视频队列</h3>
          <AppButton variant="ghost" size="sm" type="button" @click="emit('close')">关闭</AppButton>
        </div>

        <div class="room-tools-drawer__scroll">
          <AppCard padding="compact">
            <h3 class="sidebar-heading">视频队列</h3>
            <p v-if="queueSyncPending" class="muted" role="status">正在同步队列到服务端…</p>
            <div class="playback-mode-row">
              <label class="playback-mode-label">
                播放模式
                <select
                  class="ui-input"
                  :value="playbackMode"
                  :disabled="!canControl"
                  @change="emit('playback-mode-change', $event)"
                >
                  <option value="sequential">顺序 — 最后一首结束后停止</option>
                  <option value="loop">循环 — 最后一首后回到第一首</option>
                </select>
              </label>
              <AppButton
                v-if="canControl"
                size="sm"
                variant="secondary"
                type="button"
                @click="emit('owner-next-track')"
              >
                下一首
              </AppButton>
            </div>
            <form class="inline-form inline-form--stack" @submit.prevent="emit('add-manual-url')">
              <input
                :value="manualUrl"
                class="ui-input"
                placeholder="添加 mp4 / m3u8 URL"
                :disabled="!canControl"
                @input="emit('update:manualUrl', ($event.target as HTMLInputElement).value)"
              />
              <input
                :value="manualUrlTitle"
                class="ui-input"
                placeholder="显示名称（可选）"
                :disabled="!canControl"
                @input="emit('update:manualUrlTitle', ($event.target as HTMLInputElement).value)"
              />
              <AppButton type="submit" size="sm" :disabled="!canControl">添加</AppButton>
            </form>
            <p v-if="!canControl" class="muted queue-owner-hint">队列由房主管理；你可查看顺序与当前条目。</p>
            <div v-for="(item, index) in queue" :key="item.id" class="queue-item">
              <div class="queue-item__text">
                <strong :title="item.file_url || item.file_path || item.id">{{ displayTitle(item) }}</strong>
                <small class="queue-url-line" :title="item.file_url || item.file_path">{{
                  item.file_url || item.file_path
                }}</small>
              </div>
              <div class="queue-actions">
                <AppButton
                  v-if="canControl"
                  size="sm"
                  variant="secondary"
                  :disabled="index === 0"
                  @click="emit('move-queue', index, -1)"
                >
                  上移
                </AppButton>
                <AppButton
                  v-if="canControl"
                  size="sm"
                  variant="secondary"
                  :disabled="index === queue.length - 1"
                  @click="emit('move-queue', index, 1)"
                >
                  下移
                </AppButton>
                <AppButton
                  v-if="canControl"
                  size="sm"
                  :disabled="!canControl"
                  @click="emit('switch-queue-item', item)"
                >
                  切换
                </AppButton>
                <AppButton
                  v-if="canControl"
                  size="sm"
                  variant="secondary"
                  @click="emit('open-queue-rename', item)"
                >
                  改名
                </AppButton>
                <AppButton
                  v-if="canControl"
                  size="sm"
                  variant="danger"
                  :disabled="!canControl"
                  @click="emit('remove-queue', index)"
                >
                  删除
                </AppButton>
              </div>
            </div>
          </AppCard>

          <AppCard v-if="isDev" padding="compact">
            <h3 class="sidebar-heading">实时事件（开发）</h3>
            <pre class="events-pre">{{ eventPreview || '—' }}</pre>
          </AppCard>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.room-tools-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer);
  pointer-events: none;
}

.room-tools-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}

.room-tools-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 90vw);
  display: flex;
  flex-direction: column;
  padding: var(--space-xl);
  padding-top: calc(var(--topbar-h) + var(--space-md));
  background: var(--color-bg-card);
  border-left: 1px solid var(--color-border-strong);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
  transform: translateX(100%);
  transition: transform 0.25s ease;
}

.room-tools-drawer.is-open {
  transform: translateX(0);
}

.room-tools-drawer__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: var(--space-lg);
}

.room-tools-drawer__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.room-tools-drawer__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: var(--space-lg);
  align-content: start;
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

.inline-form--stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: stretch;
}

.events-pre {
  max-height: 10rem;
  overflow: auto;
  font-size: 0.75rem;
  margin: 0;
}
</style>
