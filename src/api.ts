import type {
  AblyJwtResponse,
  AdminRoomRow,
  AuthTokens,
  CapabilityReport,
  DownloadTask,
  JoinRoomResult,
  PlaybackAction,
  PlaybackMode,
  RegisterCodeResponse,
  Room,
  RoomSnapshotPayload,
  RoomSocketMessage,
  RoomState,
  User,
  Video,
} from './types'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://watchtvtogether.bestlkl.top'

export class ApiError extends Error {
  /** HTTP `Retry-After`（秒），常见于验证码冷却或限流 */
  retryAfterSeconds?: number

  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, token = ''): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!response.ok) {
    let message = response.statusText
    try {
      const payload = await response.json()
      message = payload.error?.message ?? message
    } catch {
      // Keep HTTP status text when the server returned no JSON body.
    }
    const err = new ApiError(message, response.status)
    const ra = response.headers.get('Retry-After')
    if (ra) {
      const sec = Number.parseInt(ra, 10)
      if (!Number.isNaN(sec) && sec > 0) err.retryAfterSeconds = sec
    }
    throw err
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export function sendRegisterVerificationCode(email: string) {
  return apiFetch<RegisterCodeResponse>('/api/auth/register/code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function sendPasswordResetCode(email: string) {
  return apiFetch<RegisterCodeResponse>('/api/auth/password/reset/code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(input: { email: string; code: string; new_password: string }) {
  return apiFetch<void>('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function register(input: {
  email: string
  username: string
  password: string
  code: string
  nickname?: string
  avatar_url?: string
}) {
  return apiFetch<{ user: User; tokens: AuthTokens }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function login(input: { login: string; password: string }) {
  return apiFetch<{ user: User; tokens: AuthTokens }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function refreshSession(refresh_token: string) {
  return apiFetch<{ tokens: AuthTokens }>('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token }),
  })
}

export function logout(token: string, refreshToken: string) {
  return apiFetch<void>(
    '/api/auth/logout',
    {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    token,
  )
}

export function fetchMe(token: string) {
  return apiFetch<{ user: User }>('/api/users/me', {}, token)
}

export function fetchRooms(token: string) {
  return apiFetch<{ items: Room[]; total: number }>('/api/rooms', {}, token)
}

export function createRoom(
  token: string,
  input: { name: string; visibility: 'public' | 'private'; password?: string },
) {
  return apiFetch<Room & { is_owner: boolean }>(
    '/api/rooms',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

/** 已获服务端授权的私有房可不传 password；请求体仅在有非空密码时包含 password 字段 */
export function joinRoom(token: string, roomId: string, password?: string) {
  const body: Record<string, string> = {}
  if (password !== undefined && password !== '') {
    body.password = password
  }
  return apiFetch<JoinRoomResult>(
    `/api/rooms/${roomId}/join`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  )
}

export function fetchRoom(token: string, roomId: string) {
  return apiFetch<Room & { is_owner: boolean }>(`/api/rooms/${roomId}`, {}, token)
}

export function fetchRoomState(token: string, roomId: string) {
  return apiFetch<RoomState>(`/api/rooms/${roomId}/state`, {}, token)
}

export function fetchAblyToken(
  token: string,
  input: { room_id: string; purpose: 'room'; password?: string },
) {
  return apiFetch<AblyJwtResponse>(
    '/api/ably/token',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

export function sendRoomControl(
  token: string,
  roomId: string,
  input: {
    action: PlaybackAction
    position: number
    video_id: string
    queue?: string[]
    playback_mode?: PlaybackMode
    control_version?: number
  },
) {
  return apiFetch<RoomSocketMessage>(
    `/api/rooms/${roomId}/control`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    token,
  )
}

/** 已授权时可不传 password（omit 字段） */
export function fetchRoomSnapshot(token: string, roomId: string, password?: string) {
  const body: Record<string, string> = {}
  if (password !== undefined && password !== '') {
    body.password = password
  }
  return apiFetch<RoomSnapshotPayload>(
    `/api/rooms/${roomId}/snapshot`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  )
}

export function closeRoom(token: string, roomId: string) {
  return apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' }, token)
}

export function fetchAdminRooms(token: string) {
  return apiFetch<{ items: AdminRoomRow[]; total?: number }>('/api/admin/rooms', {}, token)
}

export function fetchVideo(token: string, id: string) {
  return apiFetch<Video>(`/api/videos/${encodeURIComponent(id)}`, {}, token)
}

export function fetchVideos(token: string, opts: string | { query?: string; status?: string } = '') {
  const query = typeof opts === 'string' ? opts : (opts.query ?? '')
  const status = typeof opts === 'string' ? 'ready' : (opts.status ?? 'ready')
  const params = new URLSearchParams({ limit: '50' })
  if (status) {
    params.set('status', status)
  }
  if (query.trim()) {
    params.set('q', query.trim())
  }
  return apiFetch<{ items: Video[]; total: number }>(`/api/videos?${params}`, {}, token)
}

export function deleteVideo(token: string, id: string) {
  return apiFetch<void>(`/api/admin/videos/${id}`, { method: 'DELETE' }, token)
}

export function fetchDownloads(token: string) {
  return apiFetch<{ items: DownloadTask[] }>('/api/admin/downloads', {}, token)
}

export function createDownload(token: string, sourceUrl: string) {
  return apiFetch<DownloadTask>(
    '/api/admin/downloads',
    {
      method: 'POST',
      body: JSON.stringify({ source_url: sourceUrl }),
    },
    token,
  )
}

export function cancelDownload(token: string, taskId: string) {
  return apiFetch<void>(`/api/admin/downloads/${taskId}`, { method: 'DELETE' }, token)
}

export function kickRoomMember(token: string, roomId: string, userId: string) {
  return apiFetch<void>(`/api/rooms/${roomId}/kick/${userId}`, { method: 'POST' }, token)
}

export function fetchCapabilities(token: string) {
  return apiFetch<CapabilityReport>('/api/capabilities', {}, token)
}
