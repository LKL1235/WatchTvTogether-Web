<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createDownload, deleteVideo, fetchDownloads, fetchRooms, fetchVideos } from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { DownloadTask, Room, Video } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppEmpty from '../components/ui/AppEmpty.vue'

const emit = defineEmits<{ 'open-room': [room: Room] }>()
const auth = useAuthStore()
const videos = ref<Video[]>([])
const downloads = ref<DownloadTask[]>([])
const rooms = ref<Room[]>([])
const sourceUrl = ref('')
const message = ref('')
const loadError = ref('')
const loading = ref(false)
const submitLoading = ref(false)
const submitError = ref('')
let downloadPollTimer: ReturnType<typeof setInterval> | null = null

const readyVideos = computed(() => videos.value.filter((video) => video.status === 'ready').length)
const runningTasks = computed(() => downloads.value.filter((task) => ['pending', 'running'].includes(task.status)).length)

async function loadAll() {
  loadError.value = ''
  loading.value = true
  try {
    const [videoRes, downloadRes, roomRes] = await Promise.all([
      fetchVideos(auth.accessToken.value),
      fetchDownloads(auth.accessToken.value),
      fetchRooms(auth.accessToken.value),
    ])
    videos.value = videoRes.items
    downloads.value = downloadRes.items
    rooms.value = roomRes.items
  } catch (err) {
    loadError.value = formatApiError(err, '加载管理数据失败')
  } finally {
    loading.value = false
  }
}

async function submitDownload() {
  submitError.value = ''
  message.value = ''
  if (!sourceUrl.value.trim()) {
    submitError.value = '请输入要下载的链接'
    return
  }
  submitLoading.value = true
  try {
    const task = await createDownload(auth.accessToken.value, sourceUrl.value.trim())
    downloads.value = [task, ...downloads.value.filter((item) => item.id !== task.id)]
    sourceUrl.value = ''
    message.value = '下载任务已提交'
  } catch (err) {
    submitError.value = formatApiError(err, '提交下载失败')
  } finally {
    submitLoading.value = false
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

function startDownloadPolling() {
  stopDownloadPolling()
  downloadPollTimer = window.setInterval(async () => {
    if (!auth.accessToken.value) return
    try {
      const res = await fetchDownloads(auth.accessToken.value)
      downloads.value = res.items
    } catch {
      // 静默失败，避免后台页刷屏；用户可点「刷新」
    }
  }, 4000)
}

function stopDownloadPolling() {
  if (downloadPollTimer != null) {
    clearInterval(downloadPollTimer)
    downloadPollTimer = null
  }
}

onMounted(async () => {
  await loadAll()
  startDownloadPolling()
})

onUnmounted(() => {
  stopDownloadPolling()
})
</script>

<template>
  <section class="admin-stack">
    <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
    <div v-if="loading && !videos.length && !downloads.length" class="muted" aria-live="polite">正在加载…</div>

    <div v-else class="stats-grid">
      <AppCard padding="compact" hover>
        <p class="eyebrow">视频库</p>
        <strong>{{ videos.length }}</strong>
        <span class="muted">{{ readyVideos }} 个可播放</span>
      </AppCard>
      <AppCard padding="compact" hover>
        <p class="eyebrow">下载任务</p>
        <strong>{{ downloads.length }}</strong>
        <span class="muted">{{ runningTasks }} 个进行中</span>
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
          <p class="eyebrow">下载管理</p>
          <h2>提交 URL 并查看进度</h2>
        </div>
        <span class="pill">列表约每 4 秒自动刷新</span>
      </div>
      <form class="inline-form" style="margin-bottom: 1rem" @submit.prevent="submitDownload">
        <input
          v-model="sourceUrl"
          class="ui-input"
          style="flex: 1; min-width: 200px"
          placeholder="https://example.com/movie.mp4 或 m3u8 / 站点链接"
        />
        <AppButton type="submit" :loading="submitLoading">提交下载</AppButton>
      </form>
      <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>
      <p v-if="message" class="success">{{ message }}</p>
      <div class="table-list">
        <div v-if="!downloads.length" class="muted">暂无下载任务。</div>
        <div class="table-row" v-for="task in downloads" :key="task.id">
          <div>
            <strong>{{ task.source_url }}</strong>
            <small class="muted">{{ task.status }} · {{ Math.round(task.progress) }}%</small>
          </div>
          <progress max="100" :value="task.progress"></progress>
        </div>
      </div>
    </AppCard>

    <AppCard>
      <div class="section-head">
        <div>
          <p class="eyebrow">视频库管理</p>
          <h2>服务器缓存视频</h2>
        </div>
        <AppButton variant="secondary" size="sm" :loading="loading" @click="loadAll">刷新</AppButton>
      </div>
      <div class="video-library">
        <article class="video-card" v-for="video in videos" :key="video.id">
          <img v-if="video.poster_path" :src="video.poster_path" :alt="video.title" />
          <div v-else class="poster-placeholder">无封面</div>
          <strong>{{ video.title }}</strong>
          <small class="muted">{{ video.format || 'unknown' }} · {{ Math.round(video.duration || 0) }} 秒 · {{ video.status }}</small>
          <AppButton variant="danger" size="sm" @click="removeVideo(video)">删除</AppButton>
        </article>
        <AppEmpty v-if="!videos.length" title="暂无缓存视频" description="提交下载任务后，就绪的视频会出现在这里。" />
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
            <small class="muted">{{ room.visibility }} · owner {{ room.owner_id }}</small>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
            <span class="pill">{{ room.current_video_id || '未选择视频' }}</span>
            <AppButton size="sm" variant="secondary" @click="emit('open-room', room)">进入房间</AppButton>
          </div>
        </div>
      </div>
    </AppCard>
  </section>
</template>
