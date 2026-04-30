/** 队列条目的展示名与 URL 队列 ID 的映射（仅存于前端内存，随 control 提交的 queue 仍为真实 id） */

const MAX_TITLE_LEN = 80

export function shortTitleFromUrl(url: string): string {
  const t = url.trim()
  if (!t) return '未命名'
  try {
    const u = new URL(t.startsWith('//') ? `https:${t}` : t)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last) return last.slice(0, MAX_TITLE_LEN)
    return (u.hostname || t).slice(0, MAX_TITLE_LEN)
  } catch {
    const part = t.split('/').pop() || t
    return part.slice(0, MAX_TITLE_LEN)
  }
}

export function clampDisplayTitle(name: string): string {
  const s = name.trim()
  if (s.length <= MAX_TITLE_LEN) return s
  return `${s.slice(0, MAX_TITLE_LEN - 1)}…`
}
