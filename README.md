# WatchTvTogether-Web

WatchTvTogether 的 Vue 3 前端项目，用于实现「一起看电视/电影」的房间管理、同步播放和管理员下载管理。

## 当前页面

1. **登录 / 注册页（AuthView）**
   - 用户登录、注册、错误提示。
   - 登录成功后进入大厅。

2. **大厅页（LobbyView）**
   - 展示房间列表（公开/私有）。
   - 支持创建房间（公开/私有 + 密码）。
   - 点击房间加入并进入房间页。

3. **房间页（RoomView）**
   - 视频播放区（支持 mp4 / m3u8）。
   - 同步控制：播放、暂停、同步进度、切换视频。
   - 队列管理：手动 URL、从视频库加入、上移下移、删除。
   - 成员列表与踢人（房主/管理员）。
   - 实时事件显示（WebSocket）。

4. **管理员后台页（AdminView）**
   - 下载任务提交与实时进度。
   - 视频库管理（查看、删除、刷新）。
   - 房间监控统计与当前房间信息。

## 当前使用的接口

基础地址：`VITE_API_BASE`（默认：`https://watchtvtogether.bestlkl.top`）

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
- `GET /api/rooms/{roomId}/state`：获取房间同步状态
- `POST /api/rooms/{roomId}/kick/{userId}`：踢出成员

### 视频与下载
- `GET /api/videos?limit=50&status=...&q=...`：查询视频列表
- `DELETE /api/admin/videos/{id}`：删除视频
- `GET /api/admin/downloads`：查询下载任务
- `POST /api/admin/downloads`：创建下载任务
- `DELETE /api/admin/downloads/{taskId}`：取消下载任务

### 能力探测
- `GET /api/capabilities`：获取服务能力报告

### WebSocket（实时）
- `/ws/rooms/{roomId}?token=...`：房间内同步控制与事件广播
- `/ws/admin/downloads?token=...`：管理员下载任务实时状态

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
