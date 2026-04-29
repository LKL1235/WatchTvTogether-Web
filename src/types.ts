export interface User {
  id: string
  username: string
  nickname?: string
  avatar_url?: string
  role: 'admin' | 'user'
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

export interface RoomState {
  room_id: string
  video_id?: string
  /** 与后端房间状态一致，同步与快照中可能包含队列 ID 列表 */
  queue?: string[]
  action: PlaybackAction
  position: number
  updated_by?: string
  updated_at?: string
}

/** Ably / HTTP 广播的同步与控制消息体，与后端 WebSocket 时代字段对齐 */
export interface RoomSocketMessage {
  type: string
  action?: PlaybackAction
  event?: string
  position?: number
  video_id?: string
  queue?: string[]
  timestamp?: number
  payload?: RoomSnapshotPayload | Record<string, unknown>
  user?: {
    id: string
    username: string
    role: string
    is_owner: boolean
  }
}

/** Ably 频道消息的通用结构（name 如 room.sync，data 为 JSON） */
export type RoomRealtimeMessage = RoomSocketMessage

export interface AblyTokenDetails {
  token: string
  expires: number
  issued: number
  capability: string
  clientId: string
}

export interface RoomPresenceMember {
  /** 后端 JWT 用户 ID，与 Ably clientId 一致 */
  id: string
  username: string
  role?: string
  is_owner?: boolean
  connectionId?: string
}

/** 服务端 POST /api/rooms/:id/snapshot 返回 */
export interface RoomSnapshotPayload {
  room_id: string
  state?: RoomState
  /** 后端快照不再包含实时在线用户；Ably presence 维护成员列表 */
  users?: Array<{ id: string; username: string; role: string; is_owner: boolean }>
  queue: string[]
  viewer_count: number
  ably?: {
    channel: string
    token_endpoint: string
  }
}

export interface Video {
  id: string
  title: string
  file_path: string
  file_url?: string
  poster_path?: string
  duration: number
  format: string
  size: number
  source_url?: string
  status: 'processing' | 'ready' | 'error'
  created_at: string
  updated_at: string
}

export interface DownloadTask {
  id: string
  user_id: string
  source_url: string
  video_id?: string
  progress: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled'
  error?: string
  created_at: string
  updated_at: string
}

export interface CapabilityReport {
  ffmpeg: boolean
  ffprobe: boolean
  ytdlp: boolean
  aria2: boolean
  features: {
    hls_download: boolean
    poster_generation: boolean
    ytdlp_import: boolean
    magnet_download: boolean
  }
}
