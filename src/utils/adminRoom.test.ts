import { describe, expect, it } from 'vitest'
import { normalizeAdminRoomItem } from './adminRoom'

describe('normalizeAdminRoomItem', () => {
  it('maps nested room.id and room.name for delete/confirm UI', () => {
    const row = normalizeAdminRoomItem({
      room: {
        id: '0df30785-f280-41e0-a26c-5d01a039871c',
        name: 'test_room',
        owner_id: '4bb280f8-aa6e-46fb-a4fc-4b0d3d583ebf',
        visibility: 'public',
        created_at: '2026-05-25T02:20:25.943797Z',
        updated_at: '2026-05-25T02:20:25.943797Z',
      },
      owner: {
        id: '4bb280f8-aa6e-46fb-a4fc-4b0d3d583ebf',
        email: '2544563843@qq.com',
        username: 'hood1234',
        nickname: 'hood1234',
        role: 'admin',
      },
      online_count: 0,
      playback_action: 'pause',
      created_at: '2026-05-25T02:20:25.943797Z',
    })
    expect(row.id).toBe('0df30785-f280-41e0-a26c-5d01a039871c')
    expect(row.name).toBe('test_room')
    expect(row.online_count).toBe(0)
    expect(row.playback_action).toBe('pause')
    expect(row.owner?.username).toBe('hood1234')
  })
})
