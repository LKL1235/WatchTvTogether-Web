<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch, type Ref } from 'vue'
import { ApiError, createRoom as createRoomRequest, fetchRooms, joinRoom } from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import type { Room } from '../types'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppEmpty from '../components/ui/AppEmpty.vue'
import AppInput from '../components/ui/AppInput.vue'
import AppModal from '../components/ui/AppModal.vue'
import AppSelect from '../components/ui/AppSelect.vue'

const emit = defineEmits<{
  'open-room': [room: Room, joinPassword?: string, leftRoomId?: string]
}>()
const auth = useAuthStore()
const lobbyListTick = inject<Ref<number>>('lobbyListTick', ref(0))

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
/** 首次进入私有房 vs 403 后需重新输入（授权失效、房间重建、密码错误） */
const joinModalReason = ref<'first_private' | 'need_password_again'>('first_private')

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

watch(lobbyListTick, () => {
  void loadRooms()
})

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

function openJoinModal(room: Room, reason: 'first_private' | 'need_password_again') {
  pendingRoom.value = room
  joinPassword.value = ''
  joinError.value = ''
  joinModalReason.value = reason
  joinModalOpen.value = true
}

function closeJoinModal() {
  joinModalOpen.value = false
  pendingRoom.value = null
}

const joinModalIntro = computed(() =>
  joinModalReason.value === 'first_private'
    ? '该房间为私有，请输入密码。'
    : '需要重新输入密码：授权已失效、房间已重建，或密码不正确。',
)

async function confirmJoin() {
  if (!pendingRoom.value) return
  joinError.value = ''
  joinLoading.value = true
  try {
    const joined = await joinRoom(
      auth.accessToken.value,
      pendingRoom.value.id,
      joinPassword.value.trim() || undefined,
    )
    closeJoinModal()
    emit('open-room', joined, joinPassword.value.trim() || undefined, joined.left_room_id)
  } catch (err) {
    joinError.value = formatApiError(err, '加入失败，请检查密码或稍后重试')
  } finally {
    joinLoading.value = false
  }
}

async function tryEnterPrivateRoom(room: Room) {
  try {
    const joined = await joinRoom(auth.accessToken.value, room.id)
    emit('open-room', joined, undefined, joined.left_room_id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      openJoinModal(room, 'first_private')
      return
    }
    if (err instanceof ApiError && err.status === 404) {
      error.value = '房间已关闭或不存在'
      await loadRooms()
      return
    }
    error.value = formatApiError(err, '进入房间失败')
  }
}

async function openRoom(room: Room) {
  const uid = auth.user.value?.id
  const canSkipPrivatePassword =
    auth.user.value?.role === 'admin' || room.is_owner === true || (!!uid && room.owner_id === uid)

  if (room.visibility === 'private' && canSkipPrivatePassword) {
    try {
      const joined = await joinRoom(auth.accessToken.value, room.id)
      emit('open-room', joined, undefined, joined.left_room_id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        error.value = '房间已关闭或不存在'
        await loadRooms()
        return
      }
      openJoinModal(room, 'need_password_again')
    }
    return
  }

  if (room.visibility === 'private') {
    await tryEnterPrivateRoom(room)
    return
  }
  try {
    const joined = await joinRoom(auth.accessToken.value, room.id)
    emit('open-room', joined, undefined, joined.left_room_id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      error.value = '房间已关闭或不存在'
      await loadRooms()
      return
    }
    error.value = formatApiError(err, '进入房间失败')
  }
}

onMounted(loadRooms)
</script>

<template>
  <div class="lobby-grid">
    <AppCard hover>
      <template #header>
        <div class="lobby-card-header">
          <div>
            <p class="eyebrow">大厅</p>
            <h2 class="section-title">房间列表</h2>
          </div>
          <AppButton
            variant="secondary"
            size="sm"
            type="button"
            :loading="loading"
            :disabled="loading"
            @click="loadRooms"
          >
            刷新
          </AppButton>
        </div>
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
    <p class="muted" style="margin: 0 0 1rem">{{ joinModalIntro }}</p>
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

<style scoped>
.lobby-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
</style>
