# WatchTvTogether-Web

WatchTvTogether 的 Vue 3 前端项目，用于实现「一起看电视/电影」的房间管理、同步播放和管理员后台。**后端（Go API）部署在 Vercel**：无持久磁盘、不提供服务端视频下载与本地入库（无 ffmpeg / yt-dlp 流水线）；影片来源以后端配置的 **外链 URL、HLS（m3u8）或对象存储签名 URL** 为准，与本前端通过 `GET /api/videos` 返回的 `file_url` / `source_url` 等字段对齐。

## 环境变量

- `VITE_API_BASE`：后端 HTTP API 根地址。生产/预览部署时请设为 Vercel 上的 Go API 域名（例如 `https://your-api.vercel.app`）；本地开发可省略（默认 `https://watchtvtogether.bestlkl.top`），或由 `vite` 代理到本机后端。**前端仅通过该变量拼接请求与播放 URL，不涉及服务端密钥。**
- **不要**在任意前端环境变量中配置 `RESEND_API_KEY`、`ABLY_ROOT_KEY`、`VITE_ABLY_ROOT_KEY` 或任何邮件/Ably root secret；Ably 房间订阅 JWT 仅由后端 `POST /api/ably/token` 签发，由 Ably 客户端在内存中通过 `authCallback` 续签。

## 实时同步（Ably）

房间内的播放同步与事件不再通过浏览器连接后端 WebSocket。进入房间时先调用 `POST /api/rooms/:roomId/snapshot` 获取状态与 `ably.channel`，再使用 Ably Realtime 订阅该频道上的 `room.sync`、`room.event`、`room.snapshot`；在线成员列表由 **同一控制频道上的 Presence** 维护。`authCallback` 请求 `POST /api/ably/token` 时，后端返回 **Ably 用 JWT**（JSON：`token`、`expires_at`），前端将 `token` 交给 Ably SDK；临近过期时 SDK 会再次调用 `authCallback`。若返回 401，前端会先尝试 `POST /api/auth/refresh` 刷新本系统 access token 再重试一次；403 时提示检查私有房密码或重新加入。若前后端或预览域名变更，需在后端与 [Ably](https://ably.com) 仪表盘中核对允许的域名与密钥策略。

私有房间的密码仅保存在当前页面内存（大厅加入成功后传入房间页），用于 snapshot 与 Ably JWT 续签；刷新或离开页面后需重新输入。

## 认证与账户

- 注册须先 `POST /api/auth/register/code` 发送邮箱验证码，再 `POST /api/auth/register` 提交 `email`、`username`、`password`、`code` 及可选 `nickname`（显示名可重复）。
- 登录使用 `POST /api/auth/login`，请求体字段为 `login`（邮箱或用户名）与 `password`。
- 找回密码：`POST /api/auth/password/reset/code` 与 `POST /api/auth/password/reset`；界面不区分邮箱是否存在，成功提示一致。

## 当前页面

1. **登录 / 注册页（AuthView）**
   - 登录：`login` 支持邮箱或用户名；注册须邮箱验证码；可选显示名（可重复）。
   - 「忘记密码」多步流程与错误提示（冷却、每日上限、验证码错误等）。

2. **大厅页（LobbyView）**
   - 展示房间列表（公开/私有）。
   - 支持创建房间（公开/私有 + 密码）。
   - 点击房间加入并进入房间页；私有房密码仅在本次会话传入房间页。

3. **房间页（RoomView）**
   - 视频播放区（支持 mp4 / m3u8）。
   - 同步控制：播放、暂停、同步进度、切换视频（通过 `POST /api/rooms/:roomId/control`，非 WebSocket）。
   - 队列管理：手动 URL、从视频库加入、上移下移、删除。
   - 在线成员（Ably Presence）与踢人（房主/管理员）。
   - 开发模式下展示最近实时消息与连接状态。

4. **管理员后台页（AdminView）**
   - 视频库管理（查看、删除、刷新）；列表数据来自后端配置的远程影片元数据。
   - 房间监控统计与当前房间信息。

## 当前使用的接口

基础地址：`VITE_API_BASE`（见上文默认值）。

### 认证与用户

- `POST /api/auth/register/code`：发送注册邮箱验证码
- `POST /api/auth/register`：注册（`email`、`username`、`password`、`code`、可选 `nickname` / `avatar_url`）
- `POST /api/auth/password/reset/code`：发送找回密码验证码
- `POST /api/auth/password/reset`：重置密码（`email`、`code`、`new_password`）
- `POST /api/auth/login`：登录（`login` 为邮箱或用户名，`password`）
- `POST /api/auth/refresh`：刷新 access token
- `POST /api/auth/logout`：退出登录
- `GET /api/users/me`：获取当前用户（含 `email`）

### 房间相关

- `GET /api/rooms`：获取房间列表
- `POST /api/rooms`：创建房间
- `POST /api/rooms/{roomId}/join`：加入房间
- `GET /api/rooms/{roomId}`：获取单个房间详情
- `GET /api/rooms/{roomId}/state`：轻量读取播放状态
- `POST /api/rooms/{roomId}/snapshot`：进入房间时完整初始化快照（含 Ably 频道名）
- `POST /api/ably/token`：签发当前房间的 **Ably JWT**（JSON：`token`、`expires_at`；仅 subscribe / presence / history）
- `POST /api/rooms/{roomId}/control`：房主/管理员提交播放控制，服务端发布 `room.sync`
- `POST /api/rooms/{roomId}/kick/{userId}`：踢出成员

### 视频

- `GET /api/videos?limit=50&status=...&q=...`：查询视频列表（条目的可播放地址优先取 `file_url` / `source_url` 等，与无本机存储的后端一致）
- `DELETE /api/admin/videos/{id}`：删除视频

**已移除**（Vercel 后端不再提供）：`GET/POST/DELETE /api/admin/downloads*`，以及依赖 `GET /api/capabilities` 中下载相关能力标志的前端逻辑。

### 关于 CORS 与 cookie

- 若前后端分属不同源，需由后端 `Access-Control-Allow-Origin` 等配置与前端 `VITE_API_BASE` 一致；本应用以 **Bearer token** 为主，一般无需跨站 cookie。

### 实时通道

- **房间**：浏览器连接 **Ably**（见上文），不再使用 `GET /ws/room/:roomId`。

## TodoList（待优化项）

1. **UI 整体升级**
   - 视觉风格更现代化（背景层次、阴影、卡片质感）。
   - 统一设计语言（圆角、间距、字号、图标体系）。

2. **按钮与交互反馈优化**
   - 主次按钮层级更清晰。
   - 增加 hover / active / disabled / loading 状态一致性。

3. **表单体验优化**
   - 更好的输入校验和错误提示文案。
   - 优化表单布局与可读性（标签、占位符、分组）。

4. **响应式适配加强**
   - 提升移动端与平板体验。
   - 房间页侧边栏在小屏下改为抽屉或分段布局。

5. **状态与错误处理完善**
   - 统一空态、加载态、失败态组件。
   - 对网络异常和权限错误给出更明确提示。

6. **可维护性改进**
   - 抽离可复用 UI 组件（Button / Input / Card / Modal）。
   - 引入页面级与组件级的样式规范。
