import type { PlaybackMode, RoomState } from '../types'

/**
 * 将服务端快照/同步中的 play 状态按 base_updated_at 与时长投影到「当前时刻」的 position，
 * 避免连接建立延迟导致新成员进度落后；片尾与循环与 todo 描述一致。
 */
export function refineRoomStateWithProjection(
  s: RoomState,
  nowMs: number,
  fallbackMode: PlaybackMode = 'sequential',
): RoomState {
  if (s.action !== 'play' || !s.base_updated_at) return s
  const baseMs = Date.parse(s.base_updated_at)
  if (!Number.isFinite(baseMs)) return s
  const mode =
    s.playback_mode === 'loop' || s.playback_mode === 'sequential' ? s.playback_mode : fallbackMode
  const dur = typeof s.video_duration === 'number' && Number.isFinite(s.video_duration) ? s.video_duration : 0
  const elapsed = (nowMs - baseMs) / 1000
  if (dur <= 0) {
    return { ...s, position: Math.max(0, s.position + elapsed) }
  }
  const raw = s.position + elapsed
  const atEnd = raw >= dur - 0.25
  if (atEnd) {
    if (mode === 'loop') {
      const wrapped = dur > 0 ? raw % dur : 0
      return { ...s, position: wrapped, action: 'play' }
    }
    return { ...s, position: dur, action: 'pause' }
  }
  return { ...s, position: Math.min(raw, dur) }
}
