<script setup lang="ts">
defineProps<{
  modelValue: string | number
  label?: string
  hint?: string
  /** 悬停或聚焦「?」时展示的详细说明（与 hint 的简短提示配合使用） */
  hintTooltip?: string
  error?: string
  type?: string
  autocomplete?: string
  disabled?: boolean
  required?: boolean
  minlength?: number
  maxlength?: number
  placeholder?: string
  id?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.type === 'number' ? el.valueAsNumber : el.value
  emit('update:modelValue', Number.isNaN(v as number) ? el.value : v)
}
</script>

<template>
  <div class="ui-field" :class="{ 'ui-field--error': error }">
    <label v-if="label" class="ui-field__label" :for="id">
      <span class="ui-field__label-text">{{ label }}</span>
      <span
        v-if="hintTooltip"
        class="ui-field__hint-help"
        tabindex="0"
      >
        <button
          type="button"
          class="ui-field__hint-help-trigger"
          :aria-label="'查看说明：' + hintTooltip"
          @click.prevent
        >
          ?
        </button>
        <span class="ui-field__hint-help-popover" role="tooltip">{{ hintTooltip }}</span>
      </span>
    </label>
    <input
      :id="id"
      class="ui-input"
      :type="type ?? 'text'"
      :value="modelValue"
      :autocomplete="autocomplete"
      :disabled="disabled"
      :required="required"
      :minlength="minlength"
      :maxlength="maxlength"
      :placeholder="placeholder"
      @input="onInput"
    />
    <p v-if="error" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.ui-field__label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.ui-field__label-text {
  flex: 1 1 auto;
  min-width: 0;
}
.ui-field__hint-help {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  align-self: center;
}
.ui-field__hint-help-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border-strong, #cbd5e1);
  border-radius: 50%;
  background: var(--color-bg-elevated, #f1f5f9);
  color: var(--color-text-muted, #64748b);
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1;
  cursor: help;
}
.ui-field__hint-help-trigger:hover,
.ui-field__hint-help-trigger:focus-visible {
  border-color: var(--color-accent, #3b82f6);
  color: var(--color-accent, #2563eb);
  outline: none;
}
.ui-field__hint-help-popover {
  position: absolute;
  left: 0;
  bottom: 100%;
  z-index: 20;
  margin-bottom: 0.35rem;
  padding: 0.5rem 0.65rem;
  max-width: min(22rem, 92vw);
  border-radius: var(--radius-md, 0.375rem);
  border: 1px solid var(--color-border-strong, #e2e8f0);
  background: var(--color-bg-base, #fff);
  color: var(--color-text, inherit);
  font-size: var(--text-xs, 0.75rem);
  font-weight: 400;
  line-height: 1.45;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    visibility 0.12s ease;
}
.ui-field__hint-help:hover .ui-field__hint-help-popover,
.ui-field__hint-help:focus-within .ui-field__hint-help-popover {
  opacity: 1;
  visibility: visible;
}
</style>
