<script setup lang="ts">
defineProps<{
  modelValue: string
  label?: string
  hint?: string
  error?: string
  disabled?: boolean
  id?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="ui-field" :class="{ 'ui-field--error': error }">
    <label v-if="label" class="ui-field__label" :for="id">{{ label }}</label>
    <select
      :id="id"
      class="ui-select"
      :value="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <p v-if="error" class="ui-field__error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>
