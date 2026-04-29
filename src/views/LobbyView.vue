<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { createRoom as createRoomRequest, fetchRooms, joinRoom } from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { Room } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppEmpty from '../components/ui/AppEmpty.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppModal from '../components/ui/AppModal.vue'
import AppSelect from '../components/ui/AppSelect.vue'

const emit = defineEmits<{ 'open-room': [room: Room] }>()
const auth = useAuthStore()
const rooms = ref<Room[]>([])
const loading = ref(false)
const error = ref('')
const form = ref({ name: '', visibility: 'public' as 'public' | 'private', password: '' })
const createLoading = ref(false)
const createError = ref('')

const joinModalOpen = ref(false)
const pendingRoom = ref<Room | null>(null)
const joinPassword = ref('')
const joinError = ref('')
const joinLoading = ref(false)

async function loadRooms() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetchRooms(auth.accessToken.value)
    rooms.value = res.items
  } catch (err) {
    error.value = formatApiError(err, '加载房间失败')
  } finally {
    loading.value = false
  }
}

function focusCreateName() {
  nextTick(() => document.getElementById('create-room-name')?.focus())
}

async function createRoom() {
  createError.value = ''
  if (!form.value.name.trim()) {
    createError.value = '请填写房间名称'
    return
  }
  if (form.value.visibility === 'private' && !form.value.password.trim()) {
    createError.value = '私有房间需要设置密码'
    return
  }
  createLoading.value = true
  try {
    const room = await createRoomRequest(auth.accessToken.value, {
      name: form.value.name.trim(),
      visibility: form.value.visibility,
      password: form.value.password,
    })
    form.value = { name: '', visibility: 'public', password: '' }
    await loadRooms()
    emit('open-room', room)
  } catch (err) {
    createError.value = formatApiError(err, '创建房间失败')
  } finally {
    createLoading.value = false
  }
}

function openJoinModal(room: Room) {
  pendingRoom.value = room
  joinPassword.value = ''
  joinError.value = ''
  joinModalOpen.value = true
}

function closeJoinModal() {
  joinModalOpen.value = false
  pendingRoom.value = null
}

async function confirmJoin() {
  if (!pendingRoom.value) return
  joinError.value = ''
  joinLoading.value = true
  try {
    const joined = await joinRoom(auth.accessToken.value, pendingRoom.value.id, joinPassword.value)
    closeJoinModal()
    emit('open-room', joined)
  } catch (err) {
    joinError.value = formatApiError(err, '加入失败，请检查密码或稍后重试')
  } finally {
    joinLoading.value = false
  }
}

async function openRoom(room: Room) {
  if (room.visibility === 'private') {
    openJoinModal(room)
    return
  }
  try {
    const joined = await joinRoom(auth.accessToken.value, room.id)
    emit('open-room', joined)
  } catch {
    openJoinModal(room)
  }
}

onMounted(loadRooms)
</script>

<template>
  <div class="lobby-grid">
    <AppCard hover>
      <template #header>
        <p class="eyebrow">大厅</p>
        <h2 class="section-title">房间列表</h2>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="loading" class="muted" aria-live="polite">正在加载房间…</div>
      <div v-else class="room-list">
        <template v-if="rooms.length">
          <button v-for="room in rooms" :key="room.id" type="button" class="room-card" @click="openRoom(room)">
            <div class="room-card__meta">
              <strong>{{ room.name }}</strong>
              <span :class="['badge', room.visibility === 'private' ? 'badge--private' : 'badge--public']">
                {{ room.visibility === 'private' ? '私有' : '公开' }}
              </span>
            </div>
            <span class="muted" aria-hidden="true">进入 →</span>
          </button>
        </template>
        <AppEmpty v-else title="暂无房间" description="创建一个房间，邀请朋友一起同步播放。">
          <AppButton variant="secondary" size="sm" type="button" @click="focusCreateName">去创建</AppButton>
        </AppEmpty>
      </div>
    </AppCard>

    <AppCard>
      <template #header>
        <p class="eyebrow">新建</p>
        <h2 class="section-title">创建房间</h2>
      </template>
      <form class="create-form" @submit.prevent="createRoom">
        <AppInput
          id="create-room-name"
          v-model="form.name"
          label="房间名称"
          required
          placeholder="例如：周五电影夜"
          hint="将显示在大厅列表中"
        />
        <AppSelect v-model="form.visibility" label="可见性" hint="私有房间需密码才能进入">
          <option value="public">公开 — 任何人可进入</option>
          <option value="private">私有 — 需要密码</option>
        </AppSelect>
        <AppInput
          v-if="form.visibility === 'private'"
          v-model="form.password"
          label="房间密码"
          type="password"
          autocomplete="new-password"
          placeholder="设置进入密码"
          hint="分享给好友，加入时需输入"
        />
        <p v-if="createError" class="error" role="alert">{{ createError }}</p>
        <AppButton variant="primary" type="submit" block :loading="createLoading">创建并进入</AppButton>
      </form>
    </AppCard>
  </div>

  <AppModal v-model="joinModalOpen" :title="pendingRoom ? `加入：${pendingRoom.name}` : '加入房间'" @close="closeJoinModal">
    <p class="muted" style="margin: 0 0 1rem">该房间为私有，请输入密码。</p>
    <AppInput
      v-model="joinPassword"
      label="房间密码"
      type="password"
      autocomplete="current-password"
      placeholder="输入密码"
      :error="joinError"
    />
    <template #footer>
      <AppButton variant="secondary" type="button" @click="closeJoinModal">取消</AppButton>
      <AppButton variant="primary" type="button" :loading="joinLoading" @click="confirmJoin">加入</AppButton>
    </template>
  </AppModal>
</template>
