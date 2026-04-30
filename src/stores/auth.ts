import { computed, ref } from 'vue'
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession as refreshSessionRequest,
  register as registerRequest,
} from '../api'
import type { AuthTokens, User } from '../types'

const user = ref<User | null>(null)
const accessToken = ref(localStorage.getItem('access_token') || '')
const refreshToken = ref(localStorage.getItem('refresh_token') || '')

function persist(tokens: AuthTokens) {
  accessToken.value = tokens.access_token
  refreshToken.value = tokens.refresh_token
  localStorage.setItem('access_token', tokens.access_token)
  localStorage.setItem('refresh_token', tokens.refresh_token)
}

function clear() {
  user.value = null
  accessToken.value = ''
  refreshToken.value = ''
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

export function useAuthStore() {
  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function register(payload: {
    email: string
    username: string
    password: string
    code: string
    nickname?: string
    avatar_url?: string
  }) {
    const res = await registerRequest(payload)
    user.value = res.user
    persist(res.tokens)
  }

  async function login(payload: { login: string; password: string }) {
    const res = await loginRequest(payload)
    user.value = res.user
    persist(res.tokens)
  }

  async function refreshSession() {
    if (!refreshToken.value) return
    const res = await refreshSessionRequest(refreshToken.value)
    persist(res.tokens)
  }

  async function loadMe() {
    if (!accessToken.value) return
    const res = await fetchMe(accessToken.value)
    user.value = res.user
  }

  async function logout() {
    if (accessToken.value) {
      await logoutRequest(accessToken.value, refreshToken.value).catch(() => undefined)
    }
    clear()
  }

  function setSession(nextUser: User, tokens: AuthTokens) {
    user.value = nextUser
    persist(tokens)
  }

  return {
    user,
    accessToken,
    refreshToken,
    isAuthenticated,
    isAdmin,
    register,
    login,
    refreshSession,
    loadMe,
    logout,
    setSession,
  }
}
