<script setup lang="ts">
const props = defineProps<{
  width: number
  minWidth: number
  maxWidth: number
  collapsed: boolean
}>()

const emit = defineEmits<{
  pointerdown: [ev: PointerEvent]
  pointermove: [ev: PointerEvent]
  pointerup: [ev: PointerEvent]
  pointercancel: [ev: PointerEvent]
  dblclick: []
  keydown: [ev: KeyboardEvent]
}>()
</script>

<template>
  <div
    v-if="!collapsed"
    class="room-chat-resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label="调整聊天栏宽度"
    :aria-valuenow="width"
    :aria-valuemin="minWidth"
    :aria-valuemax="maxWidth"
    tabindex="0"
    @pointerdown="emit('pointerdown', $event)"
    @pointermove="emit('pointermove', $event)"
    @pointerup="emit('pointerup', $event)"
    @pointercancel="emit('pointerup', $event)"
    @dblclick="emit('dblclick')"
    @keydown="emit('keydown', $event)"
  />
</template>

<style scoped>
.room-chat-resizer {
  flex-shrink: 0;
  width: 6px;
  margin-left: -3px;
  margin-right: -3px;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
  align-self: stretch;
  background: transparent;
  transition: background 0.15s ease;
}

.room-chat-resizer:hover,
.room-chat-resizer:focus-visible {
  background: rgba(56, 189, 248, 0.35);
  outline: none;
}
</style>
