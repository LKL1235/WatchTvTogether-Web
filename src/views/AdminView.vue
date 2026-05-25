<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { closeRoom, fetchAdminRooms } from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { AdminRoomRow, Room } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'

const emit = defineEmits<{ 'open-room': [room: Room] }>()
const auth = useAuthStore()
const rooms = ref<AdminRoomRow[]>([])
const message = ref('')
const loadError = ref('')
const loading = ref(false)

async function loadAll() {
  loadError.value = ''
  loading.value = true
  try {
    const roomRes = await fetchAdminRooms(auth.accessToken.value)
    rooms.value = roomRes.items
  } catch (err) {
    loadError.value = formatApiError(err, '加载管理数据失败')
  } finally {
    loading.value = false
  }
}

async function adminCloseRoom(room: AdminRoomRow) {
  if (!window.confirm(`确定关闭并删除房间「${room.name}」？房间内所有用户将被断开。`)) return
  message.value = ''
  loadError.value = ''
  try {
    await closeRoom(auth.accessToken.value, room.id)
    rooms.value = rooms.value.filter((r) => r.id !== room.id)
    message.value = '房间已关闭'
  } catch (err) {
    window.alert(formatApiError(err, '关闭房间失败'))
  }
}

function roomPlaybackLabel(room: AdminRoomRow) {
  const a = room.playback_action ?? room.action
  if (a === 'play') return '播放中'
  if (a === 'pause') return '已暂停'
  if (a) return String(a)
  return '—'
}

function roomOnlineCount(room: AdminRoomRow) {
  if (typeof room.online_count === 'number') return room.online_count
  if (typeof room.viewer_count === 'number') return room.viewer_count
  return '—'
}

onMounted(async () => {
  await loadAll()
})
</script>

<template>
  <section class="admin-stack">
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <div v-if="loading && !rooms.length" class="muted" aria-live="polite">正在加载…</div>

    <div v-else class="stats-grid">
      <AppCard padding="compact" hover>
        <p class="eyebrow">房间监控</p>
        <strong>{{ rooms.length }}</strong>
        <span class="muted">当前房间</span>
      </AppCard>
    </div>

    <AppCard>
      <div class="section-head">
        <div>
          <p class="eyebrow">房间监控</p>
          <h2>当前房间</h2>
        </div>
        <AppButton variant="secondary" size="sm" :loading="loading" @click="loadAll">刷新</AppButton>
      </div>
      <p v-if="message" class="success">{{ message }}</p>
      <div class="table-list">
        <div v-if="!rooms.length" class="muted">暂无房间。</div>
        <div class="table-row" v-for="room in rooms" :key="room.id">
          <div>
            <strong>{{ room.name }}</strong>
            <small class="muted">
              {{ room.visibility }} · 房主
              {{ room.owner?.nickname || room.owner?.username || room.owner_id }} · 在线
              {{ roomOnlineCount(room) }} ·
              {{ roomPlaybackLabel(room) }}
            </small>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
            <span class="pill">{{ room.current_video_id || '未选择视频' }}</span>
            <AppButton size="sm" variant="secondary" @click="emit('open-room', room)">进入房间</AppButton>
            <AppButton size="sm" variant="danger" @click="adminCloseRoom(room)">关闭房间</AppButton>
          </div>
        </div>
      </div>
    </AppCard>
  </section>
</template>
