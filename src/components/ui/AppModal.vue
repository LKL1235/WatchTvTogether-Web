<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import AppButton from './AppButton.vue'

const props = defineProps<{
  modelValue: boolean
  title?: string
  closeOnBackdrop?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [open: boolean]; close: [] }>()

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdrop() {
  if (props.closeOnBackdrop !== false) close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close()
}

watch(
  () => props.modelValue,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="ui-modal"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="title ? 'ui-modal-title' : undefined"
    >
      <div class="ui-modal__backdrop" @click="onBackdrop" />
      <div class="ui-modal__panel">
        <header class="ui-modal__head">
          <h2 v-if="title" id="ui-modal-title" class="ui-modal__title">{{ title }}</h2>
          <AppButton variant="ghost" size="sm" class="ui-modal__close" type="button" @click="close" aria-label="关闭">
            ×
          </AppButton>
        </header>
        <div class="ui-modal__body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="ui-modal__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
