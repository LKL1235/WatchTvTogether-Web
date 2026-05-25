import type { AdminRoomListItem, AdminRoomRow } from '../types'

/** 将 GET /api/admin/rooms 嵌套结构展平为管理端 UI 使用的行 */
export function normalizeAdminRoomItem(item: AdminRoomListItem): AdminRoomRow {
  const { room } = item
  return {
    ...room,
    current_video_id: item.current_video_id ?? room.current_video_id,
    online_count: item.online_count,
    playback_action: item.playback_action,
    created_at: item.created_at || room.created_at,
    owner: item.owner,
  }
}
