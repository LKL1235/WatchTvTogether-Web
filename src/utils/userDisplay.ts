import type { User } from '../types'

/** UI 展示名：优先昵称，否则用户名（昵称可重复，用户名唯一） */
export function displayNameForUser(u: Pick<User, 'nickname' | 'username'> | null | undefined): string {
  if (!u) return ''
  const n = u.nickname?.trim()
  return n || u.username
}
