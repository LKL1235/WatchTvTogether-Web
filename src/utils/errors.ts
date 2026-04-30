import { ApiError } from '../api'

const AUTH_MESSAGE_MAP: Record<string, string> = {
  'invalid username/email or password': '邮箱/用户名或密码错误',
  'verification code sent too recently': '验证码发送过于频繁，请稍后再试',
  'daily verification email limit reached': '今日验证邮件发送次数已达上限（最多 5 次）',
  'invalid verification code': '验证码错误',
  'verification code expired': '验证码已过期',
  'too many incorrect verification attempts': '验证尝试次数过多，请重新获取验证码',
  'email or username already in use': '邮箱或用户名已被占用',
  'invalid email': '邮箱格式不正确',
  'invalid username (use 3-40 chars: a-z, 0-9, _)': '用户名无效（3–40 位，仅小写字母、数字、下划线）',
  'password does not meet requirements': '密码不符合要求（至少 8 位）',
  'too many requests': '请求过于频繁，请稍后再试',
}

function mapAuthMessage(raw: string): string {
  const key = raw.trim().toLowerCase()
  for (const [en, zh] of Object.entries(AUTH_MESSAGE_MAP)) {
    if (key === en) return zh
  }
  return raw
}

export function formatApiError(err: unknown, fallback = '请求失败'): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '未授权或登录已过期，请重新登录。'
    if (err.status === 403) return '没有权限执行此操作；若是私有房请检查房间密码或重新加入。'
    if (err.status === 404) return '请求的资源不存在。'
    if (err.status === 409) return mapAuthMessage(err.message) || err.message || '操作冲突，请刷新后重试。'
    if (err.status === 429) {
      const base = mapAuthMessage(err.message)
      if (typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0) {
        return `${base}（约 ${err.retryAfterSeconds} 秒后可重试）`
      }
      return base || '请求过于频繁，请稍后再试。'
    }
    if (err.status >= 500) return '服务器暂时不可用，请稍后重试。'
    return mapAuthMessage(err.message) || err.message || fallback
  }
  if (err instanceof Error) return err.message
  return fallback
}
