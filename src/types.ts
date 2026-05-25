export interface User {
  id: string
  username: string
  /** 账户邮箱；不在房间成员等公开 UI 中默认展示 */
  email?: string
  nickname?: string
  avatar_url?: string
  role: 'admin' | 'user'
}

/** POST /api/auth/register/code 与找回密码发码成功响应 */
export interface RegisterCodeResponse {
  expires_at: string
  retry_after: number
  retry_after_s?: number
}

/** POST /api/ably/token：后端签发的 Ably 用 JWT */
export interface AblyJwtResponse {
  token: string
  expires_at: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: string
}

export interface Room {
  id: string
  name: string
  owner_id: string
  visibility: 'public' | 'private'
  current_video_id?: string
  created_at: string
  updated_at: string
  is_owner?: boolean
}

export type PlaybackAction = 'play' | 'pause' | 'seek' | 'next' | 'switch'

/** 与后端 model.PlaybackMode 一致 */
export type PlaybackMode = 'sequential' | 'loop'

/** POST /api/rooms/:id/join 成功响应（含跨房自动迁移时的旧房间 ID） */
export type JoinRoomResult = Room & { is_owner: boolean; left_room_id?: string }

/** GET /api/admin/rooms 原始单条（与后端 adminRoomListItem 一致） */
export interface AdminRoomListItem {
  room: Room
  owner?: User
  online_count: number
  current_video_id?: string
  playback_action?: PlaybackAction
  created_at: string
}

/** 管理端房间列表行（由 AdminRoomListItem 展平，供 UI 使用） */
export interface AdminRoomRow extends Room {
  online_count?: number
  viewer_count?: number
  playback_action?: PlaybackAction
  action?: PlaybackAction
  position?: number
  is_playing?: boolean
  owner?: User
}

export interface RoomState {
  room_id: string
  video_id?: string
  /** 与后端房间状态一致，同步与快照中可能包含队列 ID 列表 */
  queue?: string[]
  action: PlaybackAction
  position: number
  playback_mode?: PlaybackMode
  video_duration?: number
  control_version?: number
  /** 控制写入时间（投影前），与后端 base_updated_at 对齐 */
  base_updated_at?: string
  updated_by?: string
  updated_at?: string
}

/** Ably `room.chat` 与 HTTP 聊天接口消息体（与后端 room.ChatMessage 对齐） */
export interface RoomChatMessage {
  type: string
  seq: number
  stream_id: string
  room_id: string
  user: {
    id: string
    username: string
    nickname?: string
    role: string
    is_owner?: boolean
  }
  text: string
  sent_at: number
}

/** GET /api/rooms/:id/chat */
export interface RoomChatListResponse {
  items: RoomChatMessage[]
  has_more: boolean
}

/** POST /api/rooms/:id/chat */
export interface PostRoomChatResponse {
  message: RoomChatMessage
  realtime: 'ok' | 'deferred'
}

/** Ably / HTTP 广播的同步与控制消息体，与后端 WebSocket 时代字段对齐 */
export interface RoomSocketMessage {
  type: string
  action?: PlaybackAction
  event?: string
  position?: number
  video_id?: string
  queue?: string[]
  playback_mode?: PlaybackMode
  control_version?: number
  timestamp?: number
  payload?: RoomSnapshotPayload | Record<string, unknown>
  user?: {
    id: string
    username: string
    nickname?: string
    role: string
    is_owner: boolean
  }
}

/** Ably 频道消息的通用结构（name 如 room.sync，data 为 JSON） */
export type RoomRealtimeMessage = RoomSocketMessage

export interface RoomPresenceMember {
  /** 后端 JWT 用户 ID，与 Ably clientId 一致 */
  id: string
  username: string
  /** 展示名，可与他人重复；UI 优先展示 */
  nickname?: string
  role?: string
  is_owner?: boolean
  connectionId?: string
}

/** 服务端 POST /api/rooms/:id/snapshot 返回 */
export interface RoomSnapshotPayload {
  room_id: string
  state?: RoomState
  /** 后端快照不再包含实时在线用户；Ably presence 维护成员列表 */
  users?: Array<{ id: string; username: string; nickname?: string; role: string; is_owner: boolean }>
  /** 服务端可能返回 null；前端须归一化为数组 */
  queue?: string[] | null
  viewer_count: number
  ably?: {
    channel: string
    token_endpoint: string
  }
}

/** In-room queue item (id is the playback URL). */
export interface Video {
  id: string
  title: string
  file_url: string
  duration?: number
  format?: string
  created_at?: string
  updated_at?: string
}
