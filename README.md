# WatchTvTogether-Web

## 演示说明

访问线上演示或自行部署预览时，建议先阅读本节，避免常见卡点。

- **登录请使用邮箱**：登录页的「账号」字段请填写**注册时使用的邮箱**（而非用户名），可减少因用户名拼写、大小写不一致导致的登录失败。若尚未有账号，需先完成**邮箱验证码注册**流程。
- **注册依赖邮箱**：注册会向邮箱发送验证码，请确保邮箱可收信；若收不到邮件，检查垃圾箱或稍后再试（后端可能对验证码请求有冷却与每日上限）。
- **私有房间**：加入私有房需要密码；通过分享链接进入时，若 URL 带有 `?password=`，需在**已登录**状态下由路由传入密码；刷新页面后若链接仍带密码参数可再次生效。
- **播放与网络**：片源为房主在房间内添加的 **外链 URL**（mp4、m3u8 等），浏览器直接请求 CDN / 对象存储；能否播放取决于资源本身、CORS 与网络。若无法播放，检查 URL 是否可公开访问、是否允许跨域。
- **实时同步**：房间内同步依赖 Ably 与后端签发的 JWT；若前后端域名变更，需在对应服务中核对允许的域名与密钥策略。

---

WatchTvTogether 的 Vue 3 前端项目，用于实现「一起看电视/电影」的房间管理、同步播放和管理员后台。**后端（Go API）部署在 Vercel**：无持久磁盘、不提供服务端视频下载与本地入库（无 ffmpeg / yt-dlp 流水线）。**无全局影片库**——房主在房间内手动添加 **http(s) 或协议相对（`//`）播放 URL** 组成队列；同步状态与队列存于 Redis，由 Ably 推送。

## 环境变量

- `VITE_API_BASE`：后端 HTTP API 根地址。生产/预览部署时请设为 Vercel 上的 Go API 域名（例如 `https://your-api.vercel.app`）；本地开发可省略（默认 `https://watchtvtogether.bestlkl.top`），或由 `vite` 代理到本机后端。**前端仅通过该变量拼接请求与播放 URL，不涉及服务端密钥。**
- **不要**在任意前端环境变量中配置 `RESEND_API_KEY`、`ABLY_ROOT_KEY`、`VITE_ABLY_ROOT_KEY` 或任何邮件/Ably root secret；Ably 房间订阅 JWT 仅由后端 `POST /api/ably/token` 签发，由 Ably 客户端在内存中通过 `authCallback` 续签。

## 实时同步（Ably）

房间内的播放同步与事件不再通过浏览器连接后端 WebSocket。进入房间时先调用 `POST /api/rooms/:roomId/snapshot` 获取状态与 `ably.channel`，再使用 Ably Realtime 订阅该频道上的 `room.sync`、`room.event`、`room.snapshot` 以及 **`room.chat`（聊天）**；在线成员列表由 **同一控制频道上的 Presence** 维护。聊天历史通过 **`GET /api/rooms/:roomId/chat`** 拉取（Redis Stream），发送通过 **`POST /api/rooms/:roomId/chat`**，与播放控制一样不经由客户端 Ably `publish`。

私有房间的密码可由大厅加入后传入房间页，或由分享链接 `?password=` 在已登录场景下由路由传入，用于 snapshot 与 Ably JWT 续签；刷新后若 URL 仍带密码则可再次读取。

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
   - 视频播放区（支持 mp4 / m3u8）；房主自定义控制条（播放/暂停、进度、音量），普通成员仅本地播放/暂停与音量；画中画与远程播放入口已禁用。
   - 同步控制：房主通过 `POST /api/rooms/:roomId/control` 提交全局播放、暂停、进度与切视频；普通成员不提交全局控制。
   - 队列管理：手动输入播放 URL（可选本机展示名）、上移下移、删除、切换；展示名仅存浏览器内存，跨成员同步的仍是 URL 列表。
   - 分享：`/room/:roomId` 深链，私有房可在查询参数中带 `password`（登录后加入）；分享弹窗可复制链接。
   - **聊天**（桌面右侧可折叠列 / 移动底部 Sheet）：加载 `GET /api/rooms/:roomId/chat` 历史；发送 `POST /api/rooms/:roomId/chat`；实时增量由 Ably `room.chat` 推送。聊天区顶部为**在线成员**（Ably Presence，可折叠；列表固定高度滚动），房主/管理员可踢人。
   - **视频队列**：独立工具抽屉（舞台区「队列」按钮）；不含聊天。
   - 开发模式下展示最近实时消息与连接状态。

4. **管理员后台页（AdminView）**
   - 房间监控：当前房间数、在线人数、播放状态、当前 URL。
   - 管理员可关闭并删除房间（`DELETE /api/rooms/:id`）。
   - **已无视频库管理**（全局 `GET /api/videos` 已移除）。

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
- `GET /api/rooms/{roomId}/chat`：聊天历史（`before_id`、`limit`、可选 `password` 查询参数）
- `POST /api/rooms/{roomId}/chat`：发送聊天（`text`、可选 `password`）
- `POST /api/ably/token`：签发当前房间的 **Ably JWT**（JSON：`token`、`expires_at`；仅 subscribe / presence / history）
- `POST /api/rooms/{roomId}/control`：房主/管理员提交播放控制（`video_id` / `queue[]` 为外链 URL；可选 `video_duration` 供进度投影）；服务端发布 `room.sync`
- `POST /api/rooms/{roomId}/kick/{userId}`：踢出成员
- `DELETE /api/rooms/{roomId}`：关闭并删除房间（房主或管理员）

### 管理员

- `GET /api/admin/rooms`：房间列表（嵌套 `room` + `online_count` + `playback_action` + `current_video_id`）

### 播放队列（URL-only）

- 队列条目必须是 `http://`、`https://` 或 `//` 开头的绝对 URL（见 `src/utils/queueUrl.ts`）。
- 房主在 metadata 加载后上报 `video_duration`，后端用于 `GET /state` / `snapshot` 的进度投影（见 `src/utils/roomStateProjection.ts`）。
- 后端契约详见 WatchTvTogether 仓库：
  - [docs/room_queue_url_only_zh.md](https://github.com/LKL1235/WatchTvTogether/blob/main/docs/room_queue_url_only_zh.md)（URL 校验、`video_duration`、进度投影）
  - [docs/room_chat_realtime_design_zh.md](https://github.com/LKL1235/WatchTvTogether/blob/main/docs/room_chat_realtime_design_zh.md)（聊天 HTTP + Ably `room.chat`）
  - [docs/room_empty_cleanup_ops_zh.md](https://github.com/LKL1235/WatchTvTogether/blob/main/docs/room_empty_cleanup_ops_zh.md)（空房清理与 `room cleanup:` 日志排障）

### 关于 CORS 与 cookie

- 若前后端分属不同源，需由后端 `Access-Control-Allow-Origin` 等配置与前端 `VITE_API_BASE` 一致；本应用以 **Bearer token** 为主，一般无需跨站 cookie。

### 实时通道

- **房间**：浏览器连接 **Ably**（见上文），不再使用 `GET /ws/room/:roomId`。

## 后端设计文档（排障）

与 Go API 行为不一致时，以 **WatchTvTogether** 仓库 `docs/` 为准（上节链接）。常见场景：

- 队列 URL 被拒：对照 `room_queue_url_only_zh.md` 与 `src/utils/queueUrl.ts`
- 进度不同步：确认房主是否上报 `video_duration`；客户端投影见 `src/utils/roomStateProjection.ts`
- 房间删不掉 / 幽灵房：查后端 stdout 中 `room cleanup:` 日志（`room_empty_cleanup_ops_zh.md`）

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
