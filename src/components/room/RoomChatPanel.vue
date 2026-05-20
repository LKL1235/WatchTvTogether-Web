<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ROOM_CHAT_MAX_TEXT_RUNES } from '../../api'
import { useChatScroll } from '../../composables/useChatScroll'
import type { RoomChatMessage } from '../../types'
import AppButton from '../ui/AppButton.vue'

const props = defineProps<{
  messages: RoomChatMessage[]
  loading: boolean
  banner: string | null
  blocked: boolean
  sending: boolean
  sendError: string | null
  draft: string
  displayName: (user: RoomChatMessage['user']) => string
  countRunes: (text: string) => number
  embedded?: boolean
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  send: []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const messageCount = ref(props.messages.length)
const loadingRef = ref(props.loading)

watch(
  () => props.messages.length,
  (n) => {
    messageCount.value = n
  },
)
watch(
  () => props.loading,
  (v) => {
    loadingRef.value = v
  },
)

const { logRef, showNewMessages, onLogScroll, jumpToLatest, scrollToBottom } = useChatScroll(
  messageCount,
  loadingRef,
)

watch(
  () => props.loading,
  async (now, was) => {
    if (was && !now) await nextTick(() => scrollToBottom())
  },
)

function onDraftInput(ev: Event) {
  emit('update:draft', (ev.target as HTMLTextAreaElement).value)
}

function onSubmit() {
  emit('send')
}

function onTextareaKeydown(ev: KeyboardEvent) {
  if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return
  ev.preventDefault()
  onSubmit()
}

async function afterSendFocus() {
  await nextTick()
  scrollToBottom()
  textareaRef.value?.focus()
}

defineExpose({ afterSendFocus, scrollToBottom })
</script>

<template>
  <div class="room-chat-panel-inner" :class="{ 'room-chat-panel-inner--embedded': embedded }">
    <p v-if="banner" class="room-chat-banner muted" role="status">{{ banner }}</p>
    <p v-if="loading" class="muted room-chat-loading">加载聊天记录…</p>
    <div v-else class="room-chat-messages-wrap">
      <div
        ref="logRef"
        class="room-chat-messages"
        role="log"
        aria-live="polite"
        @scroll="onLogScroll"
      >
        <p v-if="!messages.length" class="muted room-chat-empty">暂无消息</p>
        <div v-for="m in messages" :key="m.stream_id || m.seq" class="room-chat-line">
          <strong>{{ displayName(m.user) }}</strong>
          <span class="muted"> · </span>
          <span>{{ m.text }}</span>
        </div>
      </div>
      <AppButton
        v-if="showNewMessages"
        class="room-chat-new-msgs"
        size="sm"
        variant="secondary"
        type="button"
        aria-label="跳至最新消息"
        @click="jumpToLatest"
      >
        ↓ 新消息
      </AppButton>
    </div>
    <form class="room-chat-composer" @submit.prevent="onSubmit">
      <textarea
        ref="textareaRef"
        class="ui-input room-chat-input"
        rows="2"
        :value="draft"
        :disabled="sending || blocked"
        :placeholder="blocked ? '聊天暂不可用' : '发送消息…'"
        maxlength="8000"
        @input="onDraftInput"
        @keydown="onTextareaKeydown"
      />
      <div class="room-chat-meta muted">
        {{ countRunes(draft) }} / {{ ROOM_CHAT_MAX_TEXT_RUNES }}
      </div>
      <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
      <AppButton type="submit" size="sm" :disabled="sending || blocked || !draft.trim()">发送</AppButton>
    </form>
  </div>
</template>

<style scoped>
.room-chat-panel-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 0.5rem;
}

.room-chat-panel-inner--embedded {
  min-height: 0;
}

.room-chat-banner,
.room-chat-loading {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.875rem;
}

.room-chat-messages-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.room-chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-size: 0.875rem;
  padding-right: 0.25rem;
}

.room-chat-empty {
  margin: 0;
}

.room-chat-line {
  margin-bottom: 0.35rem;
  word-break: break-word;
}

.room-chat-new-msgs {
  position: absolute;
  left: 50%;
  bottom: 0.5rem;
  transform: translateX(-50%);
  z-index: 2;
  box-shadow: var(--shadow-md);
}

.room-chat-composer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border-top: 1px solid var(--color-border);
  padding-top: 0.5rem;
}

.room-chat-input {
  resize: vertical;
  min-height: 2.5rem;
}

.room-chat-meta {
  font-size: 0.75rem;
}
</style>
