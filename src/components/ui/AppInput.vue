<script setup lang="ts">
defineProps<{
  modelValue: string | number
  label?: string
  hint?: string
  error?: string
  type?: string
  autocomplete?: string
  disabled?: boolean
  required?: boolean
  minlength?: number
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
    <label v-if="label" class="ui-field__label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="ui-input"
      :type="type ?? 'text'"
      :value="modelValue"
      :autocomplete="autocomplete"
      :disabled="disabled"
      :required="required"
      :minlength="minlength"
      :placeholder="placeholder"
      @input="onInput"
    />
    <p v-if="error" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>
