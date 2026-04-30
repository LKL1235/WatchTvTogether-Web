import { describe, expect, it } from 'vitest'

import type { RoomState } from '../types'
import {
  advancePlayPositionSinceServerUpdatedAt,
  refineRoomStateWithProjection,
} from './roomStateProjection'

function baseState(over: Partial<RoomState> = {}): RoomState {
  return {
    room_id: 'r1',
    action: 'play',
    position: 10,
    video_id: 'v1',
    ...over,
  }
}

describe('advancePlayPositionSinceServerUpdatedAt', () => {
  it('非 play 或缺少 updated_at 时原样返回', () => {
    const s = baseState({
      action: 'pause',
      updated_at: '2020-01-01T00:00:00.000Z',
    })
    expect(advancePlayPositionSinceServerUpdatedAt(s, Date.now())).toEqual(s)
  })

  it('play 时按 position 相对 updated_at 再推进', () => {
    const anchor = Date.parse('2020-01-01T00:00:00.000Z')
    const s = baseState({
      action: 'play',
      position: 100,
      updated_at: new Date(anchor).toISOString(),
      video_duration: 3600,
      playback_mode: 'sequential',
    })
    const out = advancePlayPositionSinceServerUpdatedAt(s, anchor + 2000)
    expect(out.position).toBeCloseTo(102, 5)
    expect(out.action).toBe('play')
  })
})

describe('refineRoomStateWithProjection', () => {
  it('非 play 或缺少 base_updated_at 时原样返回', () => {
    const s = baseState({ action: 'pause', base_updated_at: '2020-01-01T00:00:00.000Z' })
    expect(refineRoomStateWithProjection(s, Date.now())).toEqual(s)
  })

  it('play 时按经过时间推进 position', () => {
    const base = Date.parse('2020-01-01T00:00:00.000Z')
    const s = baseState({
      base_updated_at: new Date(base).toISOString(),
      position: 5,
      video_duration: 3600,
      playback_mode: 'sequential',
    })
    const out = refineRoomStateWithProjection(s, base + 3000)
    expect(out.position).toBeCloseTo(8, 5)
    expect(out.action).toBe('play')
  })

  it('顺序模式到达片尾时暂停', () => {
    const base = Date.parse('2020-01-01T00:00:00.000Z')
    const s = baseState({
      base_updated_at: new Date(base).toISOString(),
      position: 95,
      video_duration: 100,
      playback_mode: 'sequential',
    })
    const out = refineRoomStateWithProjection(s, base + 10000)
    expect(out.action).toBe('pause')
    expect(out.position).toBe(100)
  })

  it('循环模式到达片尾时回到开头继续 play', () => {
    const base = Date.parse('2020-01-01T00:00:00.000Z')
    const s = baseState({
      base_updated_at: new Date(base).toISOString(),
      position: 95,
      video_duration: 100,
      playback_mode: 'loop',
    })
    const out = refineRoomStateWithProjection(s, base + 10000)
    expect(out.action).toBe('play')
    expect(out.position).toBeLessThan(100)
  })
})
