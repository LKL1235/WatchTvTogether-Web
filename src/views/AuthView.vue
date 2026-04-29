<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppInput from '../components/ui/AppInput.vue'

const auth = useAuthStore()
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const nickname = ref('')
const fieldErrors = ref<Record<string, string>>({})
const error = ref('')
const loading = ref(false)

const usernameError = computed(() => fieldErrors.value.username)
const passwordError = computed(() => fieldErrors.value.password)
const nicknameError = computed(() => fieldErrors.value.nickname)

function validate(): boolean {
  fieldErrors.value = {}
  const u = username.value.trim()
  if (u.length < 3) fieldErrors.value.username = '用户名至少 3 个字符'
  if (password.value.length < 8) fieldErrors.value.password = '密码至少 8 位'
  if (mode.value === 'register') {
    const n = nickname.value.trim()
    if (n && n.length < 2) fieldErrors.value.nickname = '昵称至少 2 个字符，或留空'
  }
  return Object.keys(fieldErrors.value).length === 0
}

async function submit() {
  error.value = ''
  if (!validate()) return
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login({ username: username.value.trim(), password: password.value })
    } else {
      await auth.register({
        username: username.value.trim(),
        password: password.value,
        nickname: nickname.value.trim() || undefined,
      })
    }
  } catch (err) {
    error.value = formatApiError(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <AppCard>
      <template #header>
        <p class="eyebrow">WatchTogether</p>
        <h1>{{ mode === 'login' ? '登录' : '注册' }}</h1>
      </template>
      <form class="auth-form" @submit.prevent="submit">
        <AppInput
          id="auth-username"
          v-model="username"
          label="用户名"
          :error="usernameError"
          hint="至少 3 个字符，用于登录"
          autocomplete="username"
          required
          :minlength="3"
          placeholder="yourname"
        />
        <AppInput
          v-if="mode === 'register'"
          id="auth-nickname"
          v-model="nickname"
          label="昵称（可选）"
          :error="nicknameError"
          hint="在房间中显示的名称"
          autocomplete="nickname"
          placeholder="周五夜影院"
        />
        <AppInput
          id="auth-password"
          v-model="password"
          label="密码"
          type="password"
          :error="passwordError"
          hint="至少 8 位"
          autocomplete="current-password"
          required
          :minlength="8"
          placeholder="••••••••"
        />
        <p v-if="error" class="auth-alert" role="alert">{{ error }}</p>
        <AppButton variant="primary" type="submit" block :loading="loading">
          {{ loading ? '处理中…' : '继续' }}
        </AppButton>
      </form>
      <div class="auth-footer">
        <AppButton variant="link" type="button" @click="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
        </AppButton>
      </div>
    </AppCard>
  </div>
</template>
