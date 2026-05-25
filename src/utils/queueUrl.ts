/** Room queue items must be absolute playback URLs (SaaS: no server-side catalog). */
export function isPlaybackUrl(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (t.startsWith('//')) return true
  return /^https?:\/\//i.test(t)
}
