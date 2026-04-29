<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from './stores/auth'
import AppButton from './components/ui/AppButton.vue'
import AuthView from './views/AuthView.vue'
import LobbyView from './views/LobbyView.vue'
import RoomView from './views/RoomView.vue'
import AdminView from './views/AdminView.vue'
import type { Room } from './types'

const auth = useAuthStore()
const currentRoom = ref<Room | null>(null)
const showAdmin = ref(false)
const isAdmin = computed(() => auth.user.value?.role === 'admin')

function goLobby() {
  currentRoom.value = null
  showAdmin.value = false
}

function goAdmin() {
  showAdmin.value = true
}

function openRoomFromAdmin(room: Room) {
  currentRoom.value = room
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
        <AppButton variant="ghost" size="sm" @click="auth.logout()">退出 {{ auth.user.value?.username }}</AppButton>
      </nav>
    </header>

    <div class="app-main">
      <AdminView v-if="showAdmin" @open-room="openRoomFromAdmin" />
      <RoomView v-else-if="currentRoom" :room="currentRoom" @back="currentRoom = null" />
      <LobbyView v-else @open-room="currentRoom = $event" />
    </div>
  </main>
</template>
