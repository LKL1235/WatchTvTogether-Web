# WatchTvTogether-Web

WatchTvTogether 的 Vue 3 前端项目，用于实现「一起看电视/电影」的房间管理、同步播放和管理员下载管理。

## 环境变量

- `VITE_API_BASE`：后端 HTTP API 根地址，例如 `https://your-backend.vercel.app`（未设置时默认 `https://watchtvtogether.bestlkl.top`）。
- **不要**在任意前端环境变量中配置 `ABLY_ROOT_KEY` 或 `VITE_ABLY_ROOT_KEY`；Ably 临时 token 仅由后端 `POST /api/ably/token` 签发，由 Ably 客户端在内存中续签。

## 实时同步（Ably）

房间内的播放同步与事件不再通过浏览器连接后端 WebSocket。进入房间时先调用 `POST /api/rooms/:roomId/snapshot` 获取状态与 `ably.channel`，再使用 Ably Realtime 订阅该频道上的 `room.sync`、`room.event`、`room.snapshot`；在线成员列表由 **同一控制频道上的 Presence** 维护。

私有房间的密码仅保存在当前页面内存（大厅加入成功后传入房间页），用于 snapshot 与 Ably token 续签；刷新或离开页面后需重新输入。

## 当前页面

1. **登录 / 注册页（AuthView）**
   - 用户登录、注册、错误提示。
   - 登录成功后进入大厅。

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
   - 下载任务提交与实时进度。
   - 视频库管理（查看、删除、刷新）。
   - 房间监控统计与当前房间信息。

## 当前使用的接口

基础地址：`VITE_API_BASE`（见上文默认值）。

### 认证与用户

- `POST /api/auth/register`：注册
- `POST /api/auth/login`：登录
- `POST /api/auth/logout`：退出登录
- `GET /api/users/me`：获取当前用户

### 房间相关

- `GET /api/rooms`：获取房间列表
- `POST /api/rooms`：创建房间
- `POST /api/rooms/{roomId}/join`：加入房间
- `GET /api/rooms/{roomId}`：获取单个房间详情
- `GET /api/rooms/{roomId}/state`：轻量读取播放状态
- `POST /api/rooms/{roomId}/snapshot`：进入房间时完整初始化快照（含 Ably 频道名）
- `POST /api/ably/token`：签发当前房间的 Ably 临时 token（仅 subscribe / presence / history）
- `POST /api/rooms/{roomId}/control`：房主/管理员提交播放控制，服务端发布 `room.sync`
- `POST /api/rooms/{roomId}/kick/{userId}`：踢出成员

### 视频与下载

- `GET /api/videos?limit=50&status=...&q=...`：查询视频列表
- `DELETE /api/admin/videos/{id}`：删除视频
- `GET /api/admin/downloads`：查询下载任务
- `POST /api/admin/downloads`：创建下载任务
- `DELETE /api/admin/downloads/{taskId}`：取消下载任务

### 能力探测

- `GET /api/capabilities`：获取服务能力报告

### 实时通道

- **房间**：浏览器连接 **Ably**，订阅快照返回的 `ably.channel`，不再使用 `GET /ws/room/:roomId`。
- **管理员下载进度**：若后端仍提供独立 WebSocket，路径以后端文档为准（本仓库房间同步不依赖该通道）。

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
   - 对网络异常和权限错误给出更明确提示；Ably token 因 JWT 过期返回 401 时可接入 refresh 流。

6. **可维护性改进**
   - 抽离可复用 UI 组件（Button / Input / Card / Modal）。
   - 引入页面级与组件级的样式规范。
