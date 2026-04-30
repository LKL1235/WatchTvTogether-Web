<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError, fetchRoom, joinRoom } from './api'
import { useAuthStore } from './stores/auth'
import { formatApiError } from './utils/errors'
import AppButton from './components/ui/AppButton.vue'
import AppModal from './components/ui/AppModal.vue'
import AppInput from './components/ui/AppInput.vue'
import AuthView from './views/AuthView.vue'
import LobbyView from './views/LobbyView.vue'
import RoomView from './views/RoomView.vue'
import AdminView from './views/AdminView.vue'
import type { Room } from './types'
import { displayNameForUser } from './utils/userDisplay'

const REDIRECT_KEY = 'wt_redirect_after_auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const currentRoom = ref<Room | null>(null)
const currentJoinPassword = ref('')
const showAdmin = ref(false)
const isAdmin = computed(() => auth.user.value?.role === 'admin')
const lobbyListTick = ref(0)
provide('lobbyListTick', lobbyListTick)

const lobbyToast = ref('')
let lobbyToastTimer: ReturnType<typeof setTimeout> | null = null

const sharedJoining = ref(false)
const sharedJoinError = ref('')

const joinModalOpen = ref(false)
const pendingJoinRoom = ref<Room | null>(null)
const pendingJoinRoomName = computed(() => pendingJoinRoom.value?.name ?? '')
const joinModalPassword = ref('')
const joinModalError = ref('')
const joinModalLoading = ref(false)
const joinModalReason = ref<'first_private' | 'need_password_again'>('first_private')

function showLobbyToast(text: string) {
  lobbyToast.value = text
  if (lobbyToastTimer) clearTimeout(lobbyToastTimer)
  lobbyToastTimer = setTimeout(() => {
    lobbyToast.value = ''
    lobbyToastTimer = null
  }, 4500)
}

function syncUrlForRoom(room: Room, joinPassword?: string) {
  const uid = auth.user.value?.id
  const canSkipPrivatePassword =
    auth.user.value?.role === 'admin' || room.is_owner === true || (!!uid && room.owner_id === uid)
  if (room.visibility === 'private' && joinPassword && !canSkipPrivatePassword) {
    void router.replace({ path: `/room/${room.id}`, query: { password: joinPassword } })
    return
  }
  void router.replace({ path: `/room/${room.id}` })
}

function goLobby() {
  currentRoom.value = null
  currentJoinPassword.value = ''
  showAdmin.value = false
  lobbyListTick.value++
  void router.push('/')
}

function goAdmin() {
  showAdmin.value = true
}

function openRoomFromLobby(room: Room, joinPassword?: string, leftRoomId?: string) {
  currentRoom.value = room
  currentJoinPassword.value = joinPassword ?? ''
  showAdmin.value = false
  syncUrlForRoom(room, joinPassword)
  if (leftRoomId) {
    showLobbyToast('已自动离开之前的房间，并进入当前房间。')
  }
}

function openRoomFromAdmin(room: Room) {
  currentRoom.value = room
  currentJoinPassword.value = ''
  showAdmin.value = false
  syncUrlForRoom(room, undefined)
}

function openJoinModal(room: Room, reason: 'first_private' | 'need_password_again') {
  pendingJoinRoom.value = room
  joinModalPassword.value = ''
  joinModalError.value = ''
  joinModalReason.value = reason
  joinModalOpen.value = true
}

function closeJoinModal() {
  joinModalOpen.value = false
  pendingJoinRoom.value = null
}

const joinModalIntro = computed(() =>
  joinModalReason.value === 'first_private'
    ? '该房间为私有，请输入密码。'
    : '需要重新输入密码：授权已失效、房间已重建，或密码不正确。',
)

async function confirmJoinFromModal() {
  if (!pendingJoinRoom.value) return
  joinModalError.value = ''
  joinModalLoading.value = true
  try {
    const joined = await joinRoom(
      auth.accessToken.value,
      pendingJoinRoom.value.id,
      joinModalPassword.value.trim() || undefined,
    )
    closeJoinModal()
    openRoomFromLobby(joined, joinModalPassword.value.trim() || undefined, joined.left_room_id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      joinModalReason.value = 'need_password_again'
    }
    joinModalError.value = formatApiError(err, '加入失败，请检查密码或稍后重试')
  } finally {
    joinModalLoading.value = false
  }
}

async function tryEnterPrivateFromDeepLink(room: Room) {
  try {
    const joined = await joinRoom(auth.accessToken.value, room.id)
    openRoomFromLobby(joined, undefined, joined.left_room_id)
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      openJoinModal(room, 'first_private')
      return
    }
    throw err
  }
}

async function openRoomFromDeepLink(roomId: string, queryPassword?: string) {
  sharedJoinError.value = ''
  sharedJoining.value = true
  try {
    const room = await fetchRoom(auth.accessToken.value, roomId)
    const uid = auth.user.value?.id
    const canSkipPrivatePassword =
      auth.user.value?.role === 'admin' || room.is_owner === true || (!!uid && room.owner_id === uid)

    if (room.visibility === 'private' && canSkipPrivatePassword) {
      try {
        const joined = await joinRoom(auth.accessToken.value, room.id)
        openRoomFromLobby(joined, undefined, joined.left_room_id)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          sharedJoinError.value = '房间已关闭或不存在'
          return
        }
        openJoinModal(room, 'need_password_again')
      }
      return
    }

    if (room.visibility === 'private') {
      const pwd = queryPassword?.trim()
      if (pwd) {
        try {
          const joined = await joinRoom(auth.accessToken.value, room.id, pwd)
          openRoomFromLobby(joined, pwd, joined.left_room_id)
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) {
            sharedJoinError.value = formatApiError(err, '密码错误或无权进入')
            openJoinModal(room, 'need_password_again')
            return
          }
          throw err
        }
        return
      }
      await tryEnterPrivateFromDeepLink(room)
      return
    }

    try {
      const joined = await joinRoom(auth.accessToken.value, room.id)
      openRoomFromLobby(joined, undefined, joined.left_room_id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        sharedJoinError.value = '房间已关闭或不存在'
        return
      }
      throw err
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      sharedJoinError.value = '房间已关闭或不存在'
    } else {
      sharedJoinError.value = formatApiError(err, '进入房间失败')
    }
  } finally {
    sharedJoining.value = false
  }
}

watch(
  () => auth.isAuthenticated.value,
  async (loggedIn) => {
    if (!loggedIn) return
    const pending = sessionStorage.getItem(REDIRECT_KEY)
    if (pending && pending.startsWith('/room/')) {
      sessionStorage.removeItem(REDIRECT_KEY)
      await router.replace(pending)
    }
  },
)

watch(
  () => (auth.isAuthenticated.value ? `${String(route.name)}:${route.fullPath}` : ''),
  () => {
    if (!auth.isAuthenticated.value) {
      if (route.name === 'room' && route.params.roomId) {
        sessionStorage.setItem(REDIRECT_KEY, route.fullPath)
      }
      return
    }
    if (route.name !== 'room') return
    const roomId = String(route.params.roomId || '')
    if (!roomId) return
    if (currentRoom.value?.id === roomId) return
    if (joinModalOpen.value && pendingJoinRoom.value?.id === roomId) return
    const pwd = typeof route.query.password === 'string' ? route.query.password : undefined
    void openRoomFromDeepLink(roomId, pwd)
  },
  { immediate: true },
)

onMounted(() => {
  auth.loadMe().catch(() => auth.logout())
})
</script>

<template>
  <AuthView v-if="!auth.isAuthenticated.value" />
  <main v-else class="app-shell">
    <header class="topbar">
      <div class="topbar__brand">
        <p class="eyebrow">WatchTogether</p>
        <h1>同步观影</h1>
      </div>
      <nav>
        <AppButton :variant="!currentRoom && !showAdmin ? 'primary' : 'secondary'" size="sm" @click="goLobby">
          大厅
        </AppButton>
        <AppButton v-if="isAdmin" :variant="showAdmin ? 'primary' : 'secondary'" size="sm" @click="goAdmin">
          管理员后台
        </AppButton>
        <AppButton variant="ghost" size="sm" @click="auth.logout()">退出 {{ displayNameForUser(auth.user.value) }}</AppButton>
      </nav>
    </header>

    <div class="app-main">
      <p v-if="lobbyToast" class="lobby-toast" role="status">{{ lobbyToast }}</p>
      <div v-if="sharedJoining && route.name === 'room'" class="muted" style="padding: 1rem" aria-live="polite">
        正在进入房间…
      </div>
      <p v-else-if="sharedJoinError && route.name === 'room' && !currentRoom" class="error" role="alert" style="padding: 1rem">
        {{ sharedJoinError }}
        <AppButton variant="secondary" size="sm" style="margin-left: 0.5rem" @click="goLobby">返回大厅</AppButton>
      </p>
      <AdminView v-else-if="showAdmin" @open-room="openRoomFromAdmin" />
      <RoomView
        v-else-if="currentRoom"
        :room="currentRoom"
        :join-password="currentJoinPassword || undefined"
        @back="goLobby"
        @admin-rooms-changed="() => lobbyListTick++"
      />
      <LobbyView v-else @open-room="openRoomFromLobby" />
    </div>

    <AppModal v-model="joinModalOpen" :title="pendingJoinRoom ? `加入：${pendingJoinRoomName}` : '加入房间'" @close="closeJoinModal">
      <p class="muted" style="margin: 0 0 1rem">{{ joinModalIntro }}</p>
      <AppInput
        v-model="joinModalPassword"
        label="房间密码"
        type="password"
        autocomplete="current-password"
        placeholder="输入密码"
        :error="joinModalError"
      />
      <template #footer>
        <AppButton variant="secondary" type="button" @click="closeJoinModal">取消</AppButton>
        <AppButton variant="primary" type="button" :loading="joinModalLoading" @click="confirmJoinFromModal">加入</AppButton>
      </template>
    </AppModal>
  </main>
</template>
