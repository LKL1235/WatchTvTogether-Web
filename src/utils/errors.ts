import { ApiError } from '../api'

export function formatApiError(err: unknown, fallback = '请求失败'): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '未授权或登录已过期，请重新登录。'
    if (err.status === 403) return '没有权限执行此操作。'
    if (err.status === 404) return '请求的资源不存在。'
    if (err.status === 409) return err.message || '操作冲突，请刷新后重试。'
    if (err.status >= 500) return '服务器暂时不可用，请稍后重试。'
    return err.message || fallback
  }
  if (err instanceof Error) return err.message
  return fallback
}
