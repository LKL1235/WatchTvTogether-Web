<script setup lang="ts">
defineProps<{
  padding?: 'default' | 'compact' | 'none'
  hover?: boolean
}>()
</script>

<template>
  <article class="ui-card" :class="[`ui-card--pad-${padding ?? 'default'}`, { 'ui-card--hover': hover }]">
    <header v-if="$slots.header" class="ui-card__header">
      <slot name="header" />
    </header>
    <div class="ui-card__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="ui-card__footer">
      <slot name="footer" />
    </footer>
  </article>
</template>
