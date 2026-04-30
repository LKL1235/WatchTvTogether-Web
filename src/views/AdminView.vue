<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { closeRoom, deleteVideo, fetchAdminRooms, fetchVideos } from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { AdminRoomRow, Video } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppEmpty from '../components/ui/AppEmpty.vue'

const emit = defineEmits<{ 'open-room': [room: AdminRoomRow] }>()
const auth = useAuthStore()
const videos = ref<Video[]>([])
const rooms = ref<AdminRoomRow[]>([])
const message = ref('')
const loadError = ref('')
const loading = ref(false)

const readyVideos = computed(() => videos.value.filter((video) => video.status === 'ready').length)

async function loadAll() {
  loadError.value = ''
  loading.value = true
  try {
    const [videoRes, roomRes] = await Promise.all([
      fetchVideos(auth.accessToken.value),
      fetchAdminRooms(auth.accessToken.value),
    ])
    videos.value = videoRes.items
    rooms.value = roomRes.items
  } catch (err) {
    loadError.value = formatApiError(err, '加载管理数据失败')
  } finally {
    loading.value = false
  }
}

async function removeVideo(video: Video) {
  if (!window.confirm(`确定删除「${video.title}」？`)) return
  try {
    await deleteVideo(auth.accessToken.value, video.id)
    videos.value = videos.value.filter((item) => item.id !== video.id)
  } catch (err) {
    window.alert(formatApiError(err, '删除失败'))
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
    <div v-if="loading && !videos.length" class="muted" aria-live="polite">正在加载…</div>

    <div v-else class="stats-grid">
      <AppCard padding="compact" hover>
        <p class="eyebrow">视频库</p>
        <strong>{{ videos.length }}</strong>
        <span class="muted">{{ readyVideos }} 个可播放</span>
      </AppCard>
      <AppCard padding="compact" hover>
        <p class="eyebrow">房间监控</p>
        <strong>{{ rooms.length }}</strong>
        <span class="muted">当前房间</span>
      </AppCard>
    </div>

    <AppCard>
      <div class="section-head">
        <div>
          <p class="eyebrow">视频库管理</p>
          <h2>影片列表（外链 / HLS 由后端配置）</h2>
        </div>
        <AppButton variant="secondary" size="sm" :loading="loading" @click="loadAll">刷新</AppButton>
      </div>
      <p v-if="message" class="success">{{ message }}</p>
      <div class="video-library">
        <article class="video-card" v-for="video in videos" :key="video.id">
          <img v-if="video.poster_path" :src="video.poster_path" :alt="video.title" />
          <div v-else class="poster-placeholder">无封面</div>
          <strong>{{ video.title }}</strong>
          <small class="muted">{{ video.format || 'unknown' }} · {{ Math.round(video.duration || 0) }} 秒 · {{ video.status }}</small>
          <AppButton variant="danger" size="sm" @click="removeVideo(video)">删除</AppButton>
        </article>
        <AppEmpty
          v-if="!videos.length"
          title="暂无影片"
          description="后端部署在 Vercel 时不提供服务端下载入库；影片由管理员在后端或数据库侧配置为外链或 HLS 地址。"
        />
      </div>
    </AppCard>

    <AppCard>
      <p class="eyebrow">房间监控</p>
      <h2 class="section-title" style="margin-top: 0.25rem">当前房间</h2>
      <div class="table-list">
        <div v-if="!rooms.length" class="muted">暂无房间。</div>
        <div class="table-row" v-for="room in rooms" :key="room.id">
          <div>
            <strong>{{ room.name }}</strong>
            <small class="muted">
              {{ room.visibility }} · 房主 {{ room.owner_id }} · 在线 {{ roomOnlineCount(room) }} ·
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
