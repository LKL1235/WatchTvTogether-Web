<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  resetPassword as resetPasswordRequest,
  sendPasswordResetCode,
  sendRegisterVerificationCode,
} from '../api'
import { useAuthStore } from '../stores/auth'
import { formatApiError } from '../utils/errors'
import {
  getPasswordPolicyMessage,
  PASSWORD_RULES_SHORT,
  PASSWORD_RULES_TOOLTIP,
} from '../utils/passwordPolicy'
import AppButton from '../components/ui/AppButton.vue'
import AppCard from '../components/ui/AppCard.vue'
import AppInput from '../components/ui/AppInput.vue'

const auth = useAuthStore()
type AuthMode = 'login' | 'register' | 'forgot'
const mode = ref<AuthMode>('login')

const loginIdentifier = ref('')
const loginPassword = ref('')

const regEmail = ref('')
const regUsername = ref('')
const regPassword = ref('')
const regCode = ref('')
const regNickname = ref('')

const resetEmail = ref('')
const resetCode = ref('')
const resetNewPassword = ref('')
const resetStep = ref<1 | 2 | 3>(1)

const fieldErrors = ref<Record<string, string>>({})
const error = ref('')
const info = ref('')
const loading = ref(false)
const sendCodeLoading = ref(false)
const sendResetCodeLoading = ref(false)

const registerCooldown = ref(0)
const resetCooldown = ref(0)
let registerIntervalId: ReturnType<typeof setInterval> | null = null
let resetIntervalId: ReturnType<typeof setInterval> | null = null

function startRegisterCooldown(seconds: number) {
  if (registerIntervalId) clearInterval(registerIntervalId)
  registerCooldown.value = Math.max(1, Math.floor(seconds))
  registerIntervalId = setInterval(() => {
    registerCooldown.value -= 1
    if (registerCooldown.value <= 0 && registerIntervalId) {
      clearInterval(registerIntervalId)
      registerIntervalId = null
    }
  }, 1000)
}

function startResetCooldown(seconds: number) {
  if (resetIntervalId) clearInterval(resetIntervalId)
  resetCooldown.value = Math.max(1, Math.floor(seconds))
  resetIntervalId = setInterval(() => {
    resetCooldown.value -= 1
    if (resetCooldown.value <= 0 && resetIntervalId) {
      clearInterval(resetIntervalId)
      resetIntervalId = null
    }
  }, 1000)
}

onBeforeUnmount(() => {
  if (registerIntervalId) clearInterval(registerIntervalId)
  if (resetIntervalId) clearInterval(resetIntervalId)
})

const loginIdError = computed(() => fieldErrors.value.login)
const loginPwdError = computed(() => fieldErrors.value.password)
const regEmailError = computed(() => fieldErrors.value.email)
const regUserError = computed(() => fieldErrors.value.reg_username)
const regPwdError = computed(() => fieldErrors.value.reg_password)
const regCodeError = computed(() => fieldErrors.value.code)
const regNickError = computed(() => fieldErrors.value.nickname)
const resetEmailError = computed(() => fieldErrors.value.reset_email)
const resetCodeError = computed(() => fieldErrors.value.reset_code)
const resetPwdError = computed(() => fieldErrors.value.reset_new_password)

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernameRe = /^[a-z0-9_]{3,40}$/
const codeRe = /^\d{6}$/

function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase()
}

function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase()
}

function validateLoginForm(): boolean {
  fieldErrors.value = {}
  if (!loginIdentifier.value.trim()) fieldErrors.value.login = '请输入邮箱或用户名'
  if (loginPassword.value.length < 8) fieldErrors.value.password = '密码至少 8 位'
  return Object.keys(fieldErrors.value).length === 0
}

function validateRegisterForm(): boolean {
  fieldErrors.value = {}
  const em = normalizeEmail(regEmail.value)
  if (!em || !emailRe.test(em)) fieldErrors.value.email = '请输入有效邮箱'
  const u = normalizeUsername(regUsername.value)
  if (!usernameRe.test(u)) fieldErrors.value.reg_username = '用户名 3–40 位，仅小写字母、数字、下划线'
  {
    const msg = getPasswordPolicyMessage(regPassword.value)
    if (msg) fieldErrors.value.reg_password = msg
  }
  if (!codeRe.test(regCode.value.trim())) fieldErrors.value.code = '请输入 6 位数字验证码'
  const nick = regNickname.value.trim()
  if (nick && nick.length < 2) fieldErrors.value.nickname = '显示名至少 2 个字符，或留空（将默认使用用户名）'
  return Object.keys(fieldErrors.value).length === 0
}

function validateResetStep1(): boolean {
  fieldErrors.value = {}
  const em = normalizeEmail(resetEmail.value)
  if (!em || !emailRe.test(em)) fieldErrors.value.reset_email = '请输入有效邮箱'
  return Object.keys(fieldErrors.value).length === 0
}

function validateResetStep2(): boolean {
  fieldErrors.value = {}
  if (!codeRe.test(resetCode.value.trim())) fieldErrors.value.reset_code = '请输入 6 位数字验证码'
  {
    const msg = getPasswordPolicyMessage(resetNewPassword.value)
    if (msg) {
      fieldErrors.value.reset_new_password =
        msg === '密码至少 8 位' ? '新密码至少 8 位' : msg.replace(/^密码/, '新密码')
    }
  }
  return Object.keys(fieldErrors.value).length === 0
}

async function sendRegisterCode() {
  error.value = ''
  info.value = ''
  const em = normalizeEmail(regEmail.value)
  fieldErrors.value = {}
  if (!em || !emailRe.test(em)) {
    fieldErrors.value.email = '请输入有效邮箱后再发送验证码'
    return
  }
  if (registerCooldown.value > 0) return
  sendCodeLoading.value = true
  try {
    const res = await sendRegisterVerificationCode(em)
    const sec = res.retry_after_s ?? res.retry_after
    startRegisterCooldown(sec)
    info.value = '验证码已发送（若邮箱未注册也会显示成功，以保护隐私）。请查收邮件。'
  } catch (err) {
    error.value = formatApiError(err)
  } finally {
    sendCodeLoading.value = false
  }
}

async function sendResetCode() {
  error.value = ''
  info.value = ''
  if (!validateResetStep1()) return
  if (resetCooldown.value > 0) return
  sendResetCodeLoading.value = true
  try {
    const em = normalizeEmail(resetEmail.value)
    const res = await sendPasswordResetCode(em)
    const sec = res.retry_after_s ?? res.retry_after
    startResetCooldown(sec)
    info.value = '若该邮箱已注册，您将收到验证码邮件。'
    resetStep.value = 2
  } catch (err) {
    error.value = formatApiError(err)
  } finally {
    sendResetCodeLoading.value = false
  }
}

async function submitResetPassword() {
  error.value = ''
  info.value = ''
  if (!validateResetStep2()) return
  loading.value = true
  try {
    await resetPasswordRequest({
      email: normalizeEmail(resetEmail.value),
      code: resetCode.value.trim(),
      new_password: resetNewPassword.value,
    })
    resetStep.value = 3
    resetCode.value = ''
    resetNewPassword.value = ''
    info.value = '密码已重置，请使用新密码登录。'
  } catch (err) {
    error.value = formatApiError(err)
  } finally {
    loading.value = false
  }
}

async function submit() {
  error.value = ''
  info.value = ''
  if (mode.value === 'login') {
    if (!validateLoginForm()) return
    loading.value = true
    try {
      await auth.login({
        login: loginIdentifier.value.trim(),
        password: loginPassword.value,
      })
    } catch (err) {
      error.value = formatApiError(err)
    } finally {
      loading.value = false
    }
    return
  }
  if (mode.value === 'register') {
    if (!validateRegisterForm()) return
    loading.value = true
    try {
      await auth.register({
        email: normalizeEmail(regEmail.value),
        username: normalizeUsername(regUsername.value),
        password: regPassword.value,
        code: regCode.value.trim(),
        nickname: regNickname.value.trim() || undefined,
      })
    } catch (err) {
      error.value = formatApiError(err)
    } finally {
      loading.value = false
    }
  }
}

function goRegister() {
  mode.value = 'register'
  error.value = ''
  info.value = ''
}

function goLogin() {
  mode.value = 'login'
  resetStep.value = 1
  error.value = ''
  info.value = ''
}

function openForgot() {
  mode.value = 'forgot'
  resetStep.value = 1
  resetCode.value = ''
  resetNewPassword.value = ''
  error.value = ''
  info.value = ''
}

function afterResetDone() {
  mode.value = 'login'
  resetStep.value = 1
  resetEmail.value = ''
  resetCode.value = ''
  resetNewPassword.value = ''
  info.value = ''
}

const cardTitle = computed(() => {
  if (mode.value === 'login') return '登录'
  if (mode.value === 'register') return '注册'
  if (resetStep.value === 3) return '重置完成'
  if (resetStep.value === 2) return '设置新密码'
  return '找回密码'
})
</script>

<template>
  <div class="auth-page">
    <AppCard>
      <template #header>
        <p class="eyebrow">WatchTogether</p>
        <h1>{{ cardTitle }}</h1>
      </template>

      <template v-if="mode === 'forgot'">
        <div v-if="resetStep === 1" class="auth-form">
          <AppInput
            id="reset-email"
            v-model="resetEmail"
            label="注册邮箱"
            :error="resetEmailError"
            hint="我们将向该邮箱发送 6 位验证码（若邮箱未注册也会显示相同提示）"
            autocomplete="email"
            type="email"
            placeholder="you@example.com"
          />
          <p v-if="error" class="auth-alert" role="alert">{{ error }}</p>
          <p v-if="info" class="auth-info" role="status">{{ info }}</p>
          <AppButton
            variant="primary"
            type="button"
            block
            :loading="sendResetCodeLoading"
            :disabled="resetCooldown > 0"
            @click="sendResetCode"
          >
            {{
              sendResetCodeLoading
                ? '发送中…'
                : resetCooldown > 0
                  ? `${resetCooldown} 秒后可重新发送`
                  : '发送验证码'
            }}
          </AppButton>
          <AppButton variant="link" type="button" block @click="goLogin">返回登录</AppButton>
        </div>

        <div v-else-if="resetStep === 2" class="auth-form">
          <p class="muted">验证码已发往 {{ normalizeEmail(resetEmail) }}</p>
          <AppInput
            id="reset-code"
            v-model="resetCode"
            label="验证码"
            :error="resetCodeError"
            hint="6 位数字，10 分钟内有效"
            inputmode="numeric"
            :maxlength="6"
            autocomplete="one-time-code"
            placeholder="000000"
          />
          <AppInput
            id="reset-new-password"
            v-model="resetNewPassword"
            label="新密码"
            type="password"
            :error="resetPwdError"
            :hint="PASSWORD_RULES_SHORT"
            :hint-tooltip="PASSWORD_RULES_TOOLTIP"
            autocomplete="new-password"
            :minlength="8"
            placeholder="••••••••"
          />
          <p v-if="error" class="auth-alert" role="alert">{{ error }}</p>
          <p v-if="info" class="auth-info" role="status">{{ info }}</p>
          <AppButton variant="primary" type="button" block :loading="loading" @click="submitResetPassword">
            {{ loading ? '提交中…' : '重置密码' }}
          </AppButton>
          <AppButton
            variant="link"
            type="button"
            block
            :disabled="sendResetCodeLoading || resetCooldown > 0"
            @click="sendResetCode"
          >
            {{
              resetCooldown > 0
                ? `${resetCooldown} 秒后可重新发送验证码`
                : sendResetCodeLoading
                  ? '发送中…'
                  : '重新发送验证码'
            }}
          </AppButton>
          <AppButton variant="link" type="button" block @click="resetStep = 1">上一步</AppButton>
        </div>

        <div v-else class="auth-form">
          <p class="auth-info" role="status">{{ info }}</p>
          <AppButton variant="primary" type="button" block @click="afterResetDone">去登录</AppButton>
        </div>
      </template>

      <form v-else class="auth-form" @submit.prevent="submit">
        <template v-if="mode === 'login'">
          <AppInput
            id="auth-login"
            v-model="loginIdentifier"
            label="邮箱或用户名"
            :error="loginIdError"
            hint="可使用邮箱或唯一用户名登录"
            autocomplete="username"
            required
            placeholder="邮箱或用户名"
          />
          <AppInput
            id="auth-password"
            v-model="loginPassword"
            label="密码"
            type="password"
            :error="loginPwdError"
            hint="至少 8 位"
            :hint-tooltip="PASSWORD_RULES_TOOLTIP"
            autocomplete="current-password"
            required
            :minlength="8"
            placeholder="••••••••"
          />
          <p class="auth-row-link">
            <AppButton variant="link" type="button" @click="openForgot">忘记密码？</AppButton>
          </p>
        </template>

        <template v-else>
          <AppInput
            id="auth-email"
            v-model="regEmail"
            label="邮箱"
            type="email"
            :error="regEmailError"
            hint="用于登录与验证，全局唯一"
            autocomplete="email"
            required
            placeholder="you@example.com"
          />
          <div class="code-row">
            <AppInput
              id="auth-code"
              v-model="regCode"
              label="邮箱验证码"
              :error="regCodeError"
              hint="6 位数字；每日最多发送 5 次"
              inputmode="numeric"
              :maxlength="6"
              autocomplete="one-time-code"
              placeholder="000000"
            />
            <AppButton
              type="button"
              variant="secondary"
              :loading="sendCodeLoading"
              :disabled="registerCooldown > 0"
              @click="sendRegisterCode"
            >
              {{
                sendCodeLoading
                  ? '发送中'
                  : registerCooldown > 0
                    ? `${registerCooldown}s`
                    : '发送验证码'
              }}
            </AppButton>
          </div>
          <AppInput
            id="auth-reg-username"
            v-model="regUsername"
            label="用户名（唯一）"
            :error="regUserError"
            hint="3–40 位，仅小写字母、数字、下划线；保存时会转为小写"
            autocomplete="username"
            required
            placeholder="your_name"
          />
          <AppInput
            id="auth-nickname"
            v-model="regNickname"
            label="显示名（可选）"
            :error="regNickError"
            hint="在房间中展示，可与他人重复；留空则默认使用用户名"
            autocomplete="nickname"
            placeholder="周五夜影院"
          />
          <AppInput
            id="auth-reg-password"
            v-model="regPassword"
            label="密码"
            type="password"
            :error="regPwdError"
            :hint="PASSWORD_RULES_SHORT"
            :hint-tooltip="PASSWORD_RULES_TOOLTIP"
            autocomplete="new-password"
            required
            :minlength="8"
            placeholder="••••••••"
          />
        </template>

        <p v-if="error" class="auth-alert" role="alert">{{ error }}</p>
        <p v-if="info" class="auth-info" role="status">{{ info }}</p>
        <AppButton variant="primary" type="submit" block :loading="loading">
          {{ loading ? '处理中…' : '继续' }}
        </AppButton>
      </form>

      <div class="auth-footer">
        <AppButton variant="link" type="button" @click="mode === 'login' ? goRegister() : goLogin()">
          {{ mode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
        </AppButton>
      </div>
    </AppCard>
  </div>
</template>

<style scoped>
.code-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  flex-wrap: wrap;
}
.code-row .ui-field {
  flex: 1 1 10rem;
}
.auth-row-link {
  margin: -0.25rem 0 0;
  text-align: right;
}
.auth-info {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.25);
  font-size: 0.875rem;
  color: var(--color-text, inherit);
}
</style>
