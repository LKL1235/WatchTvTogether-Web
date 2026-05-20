<script setup lang="ts">
import { ref } from 'vue'
import type { RoomPresenceMember } from '../../types'
import AppButton from '../ui/AppButton.vue'

const props = defineProps<{
  members: RoomPresenceMember[]
  canControl: boolean
  currentUserId?: string
  displayName: (member: RoomPresenceMember) => string
}>()

const emit = defineEmits<{
  kick: [member: RoomPresenceMember]
}>()

/** 用户确认：默认展开；列表区域固定高度，成员多时在区内滚动 */
const expanded = ref(true)

function toggleExpanded() {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="room-chat-members" :class="{ 'is-collapsed': !expanded }">
    <button
      type="button"
      class="room-chat-members__toggle"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      <span class="room-chat-members__title">在线成员（{{ members.length }}）</span>
      <svg
        class="room-chat-members__chevron"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          v-if="expanded"
          d="M4 10L8 6L12 10"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-else
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <div
      v-show="expanded"
      class="room-chat-members__list"
      role="region"
      aria-label="在线成员列表"
    >
      <div v-for="member in members" :key="member.connectionId || member.id" class="member">
        <span class="avatar">{{ displayName(member).slice(0, 1).toUpperCase() }}</span>
        <span class="room-chat-members__info">
          {{ displayName(member) }}
          <small class="muted">@{{ member.username }}</small>
          <small v-if="member.is_owner" class="muted">房主</small>
          <small v-else-if="member.role === 'admin'" class="muted">管理员</small>
        </span>
        <AppButton
          v-if="canControl && member.id !== currentUserId"
          size="sm"
          variant="danger"
          @click="emit('kick', member)"
        >
          踢出
        </AppButton>
      </div>
      <p v-if="!members.length" class="muted room-chat-members__empty">
        暂无 presence 成员（连接建立后将显示）
      </p>
    </div>
  </section>
</template>

<style scoped>
.room-chat-members {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border);
}

.room-chat-members__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.room-chat-members__toggle:hover {
  background: rgba(56, 189, 248, 0.08);
}

.room-chat-members__toggle:focus-visible {
  outline: 2px solid var(--color-accent, #38bdf8);
  outline-offset: -2px;
}

.room-chat-members__title {
  font-size: 0.8125rem;
  font-weight: 600;
}

.room-chat-members__chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.room-chat-members__list {
  height: var(--room-chat-members-list-height, 7.5rem);
  overflow-y: auto;
  padding: 0 0.75rem 0.5rem;
}

.room-chat-members__info {
  flex: 1;
  min-width: 0;
  font-size: 0.875rem;
}

.room-chat-members__info small {
  display: inline;
  margin-left: 0.25rem;
}

.room-chat-members__empty {
  margin: 0;
  padding: 0.25rem 0 0.35rem;
  font-size: 0.8125rem;
}

.room-chat-members.is-collapsed .room-chat-members__toggle {
  border-bottom: none;
}
</style>
