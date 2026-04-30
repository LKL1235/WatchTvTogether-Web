<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { useAuthStore } from './stores/auth'
import AppButton from './components/ui/AppButton.vue'
import AuthView from './views/AuthView.vue'
import LobbyView from './views/LobbyView.vue'
import RoomView from './views/RoomView.vue'
import AdminView from './views/AdminView.vue'
import type { Room } from './types'
import { displayNameForUser } from './utils/userDisplay'

const auth = useAuthStore()
const currentRoom = ref<Room | null>(null)
const currentJoinPassword = ref('')
const showAdmin = ref(false)
const isAdmin = computed(() => auth.user.value?.role === 'admin')
/** 从房间返回大厅时递增，驱动大厅刷新房间列表（空房清理后列表一致） */
const lobbyListTick = ref(0)
provide('lobbyListTick', lobbyListTick)

const lobbyToast = ref('')
let lobbyToastTimer: ReturnType<typeof setTimeout> | null = null

function showLobbyToast(text: string) {
  lobbyToast.value = text
  if (lobbyToastTimer) clearTimeout(lobbyToastTimer)
  lobbyToastTimer = setTimeout(() => {
    lobbyToast.value = ''
    lobbyToastTimer = null
  }, 4500)
}

function goLobby() {
  currentRoom.value = null
  currentJoinPassword.value = ''
  showAdmin.value = false
  lobbyListTick.value++
}

function goAdmin() {
  showAdmin.value = true
}

function openRoomFromLobby(room: Room, joinPassword?: string, leftRoomId?: string) {
  currentRoom.value = room
  currentJoinPassword.value = joinPassword ?? ''
  showAdmin.value = false
  if (leftRoomId) {
    showLobbyToast('已自动离开之前的房间，并进入当前房间。')
  }
}

function openRoomFromAdmin(room: Room) {
  currentRoom.value = room
  currentJoinPassword.value = ''
  showAdmin.value = false
}

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
      <AdminView v-if="showAdmin" @open-room="openRoomFromAdmin" />
      <RoomView
        v-else-if="currentRoom"
        :room="currentRoom"
        :join-password="currentJoinPassword || undefined"
        @back="goLobby"
        @admin-rooms-changed="() => lobbyListTick++"
      />
      <LobbyView v-else @open-room="openRoomFromLobby" />
    </div>
  </main>
</template>
