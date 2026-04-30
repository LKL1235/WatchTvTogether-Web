import type { PlaybackMode, RoomState } from '../types'

function applyPlayElapsedWithDuration(
  s: RoomState,
  elapsed: number,
  fallbackMode: PlaybackMode,
): RoomState {
  const mode =
    s.playback_mode === 'loop' || s.playback_mode === 'sequential' ? s.playback_mode : fallbackMode
  const dur = typeof s.video_duration === 'number' && Number.isFinite(s.video_duration) ? s.video_duration : 0
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

/**
 * GET /state 与 POST /snapshot 在 play 时已把 position 投影到服务端写入的 `updated_at`；
 * 用本地时间与该锚点的差再补一小段，覆盖网络延迟，且不会与 base_updated_at 重复投影。
 */
export function advancePlayPositionSinceServerUpdatedAt(
  s: RoomState,
  nowMs: number,
  fallbackMode: PlaybackMode = 'sequential',
): RoomState {
  if (s.action !== 'play' || !s.updated_at) return s
  const anchorMs = Date.parse(s.updated_at)
  if (!Number.isFinite(anchorMs)) return s
  const elapsed = Math.max(0, (nowMs - anchorMs) / 1000)
  if (elapsed <= 0) return s
  return applyPlayElapsedWithDuration(s, elapsed, fallbackMode)
}

/**
 * 将「以 base_updated_at 为锚、position 为锚点时刻进度」的 play 状态投影到 nowMs。
 * 仅适用于 position 尚未按 base 做过投影的载荷；服务端已投影的快照应改用 {@link advancePlayPositionSinceServerUpdatedAt}。
 */
export function refineRoomStateWithProjection(
  s: RoomState,
  nowMs: number,
  fallbackMode: PlaybackMode = 'sequential',
): RoomState {
  if (s.action !== 'play' || !s.base_updated_at) return s
  const baseMs = Date.parse(s.base_updated_at)
  if (!Number.isFinite(baseMs)) return s
  const elapsed = (nowMs - baseMs) / 1000
  return applyPlayElapsedWithDuration(s, elapsed, fallbackMode)
}
