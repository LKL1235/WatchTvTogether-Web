<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <div class="ui-empty" role="status">
    <div class="ui-empty__icon" aria-hidden="true">
      <slot name="icon">◇</slot>
    </div>
    <p class="ui-empty__title">{{ title }}</p>
    <p v-if="description" class="ui-empty__desc">{{ description }}</p>
    <div v-if="$slots.default" class="ui-empty__actions">
      <slot />
    </div>
  </div>
</template>
