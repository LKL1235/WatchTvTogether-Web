# Ably 实时能力改造 Todo

> 目标：将当前所有 WebSocket 实时链路迁移到 Ably SDK，并兼容 Vercel Serverless 部署；后端读取 `ABLY_ROOT_KEY` 签发客户端临时 token；前端基于当前 `WatchTvTogether-Web` 的 Vue 3/Vite 页面与接口做分阶段改造。

## 0. 当前现状与边界确认

- [ ] 梳理现有实时入口
  - [ ] 前端房间实时：`src/composables/useRoomSocket.ts`
    - 当前连接：`/ws/room/{roomId}?token=...`
    - 当前发送：`play_control`，字段包含 `action`、`position`、`video_id`、`queue`
    - 当前接收：`room_snapshot`、`sync`、`room_event`
  - [ ] 前端管理员下载进度：`src/views/AdminView.vue`
    - 当前连接：`/ws/admin/downloads?token=...`
    - 当前接收：`download_task`
  - [ ] 文档接口命名需要统一
    - README 写的是 `/ws/rooms/{roomId}`，代码中实际是 `/ws/room/{roomId}`。
    - 迁移时统一废弃旧 WebSocket 路径，避免继续暴露两个近似接口。
- [ ] 明确 Vercel 部署限制
  - [ ] Vercel Serverless 不适合作为长期驻留 WebSocket 服务。
  - [ ] 后端只保留短请求接口：鉴权、签 token、校验房间操作、持久化状态、通过 Ably REST 发布消息。
  - [ ] 浏览器使用 Ably Realtime SDK 直接连接 Ably，不再连接自建 `/ws/*`。
- [ ] 明确实时消息保留策略
  - [ ] 房间播放同步以最新状态为准，历史只用于短暂断线恢复。
  - [ ] 管理员下载进度以数据库/API 查询为基线，Ably 只负责增量推送。
  - [ ] 客户端重新进入页面时仍先调用 REST API 获取快照，再订阅 Ably 实时增量。

## 1. 接入 Ably Go SDK 并替换所有 WebSocket 后端链路

### 1.1 依赖与配置

- [ ] 后端 Go 项目增加 Ably SDK 依赖
  - [ ] 执行：`go get github.com/ably/ably-go/ably`
  - [ ] 在依赖锁文件中确认版本变更。
- [ ] 新增 Ably 配置模块
  - [ ] 从环境变量读取：`ABLY_ROOT_KEY`
  - [ ] 启动/请求初始化时校验为空场景。
  - [ ] 不将 root key 下发到前端、不写入日志、不暴露在错误响应中。
- [ ] 新增 Ably 客户端工厂
  - [ ] REST 客户端：用于服务端签 token、发布房间同步消息、发布管理员下载进度。
  - [ ] 如有非 Vercel 常驻进程，可选 Realtime 客户端；Vercel Serverless 场景默认不依赖常驻订阅。
  - [ ] 对外提供封装方法：
    - `CreateToken(ctx, params)`
    - `PublishRoomSync(ctx, roomID, payload)`
    - `PublishRoomEvent(ctx, roomID, payload)`
    - `PublishDownloadTask(ctx, task)`

### 1.2 Channel 设计

- [ ] 房间实时频道
  - [ ] 频道名：`room:{roomId}`
  - [ ] 用途：播放同步、队列变更、成员事件、房间快照通知。
  - [ ] 事件名：
    - `room_snapshot`：进入房间后的完整快照或强制刷新快照。
    - `sync`：播放控制和队列同步。
    - `room_event`：成员加入、离开、被踢、权限变更等。
- [ ] 房间 presence 频道
  - [ ] 可复用 `room:{roomId}` 的 presence，或拆分为 `room:{roomId}:presence`。
  - [ ] 建议优先复用 `room:{roomId}`，便于 token capability 管理。
  - [ ] presence data 包含：
    - `user_id`
    - `username`
    - `role`
    - `is_owner`
    - `joined_at`
- [ ] 管理员下载进度频道
  - [ ] 频道名：`admin:downloads`
  - [ ] 事件名：`download_task`
  - [ ] payload 沿用当前 `DownloadTask` 结构：
    - `id`
    - `user_id`
    - `source_url`
    - `video_id`
    - `progress`
    - `status`
    - `error`
    - `created_at`
    - `updated_at`
- [ ] 后续可扩展频道
  - [ ] `user:{userId}:notifications`：只推送给单个用户的通知。
  - [ ] `room:{roomId}:moderation`：房主/管理员专用管理事件。

### 1.3 消息结构设计

- [ ] 统一消息 envelope
  - [ ] 字段：
    - `type`：业务消息类型，例如 `sync`、`room_event`、`download_task`
    - `event`：Ably event name，可与 `type` 保持一致
    - `room_id`：房间消息必填
    - `request_id`：客户端或服务端生成，用于去重和排查
    - `sender`：发送者摘要，避免客户端再拼装用户身份
    - `payload`：业务数据
    - `timestamp`：服务端时间戳，Unix 秒或 ISO 字符串二选一并统一
  - [ ] 前端保留对旧 payload 的兼容仅作为迁移期任务，正式切换后删除旧 WebSocket 兼容层。
- [ ] 播放同步 payload
  - [ ] `action`: `play | pause | seek | next | switch`
  - [ ] `position`: number
  - [ ] `video_id`: string
  - [ ] `queue`: string[]
  - [ ] `updated_by`: string
  - [ ] `updated_at`: string
- [ ] 房间快照 payload
  - [ ] `room_id`
  - [ ] `state`
  - [ ] `users`
  - [ ] `queue`
  - [ ] `viewer_count`
- [ ] 房间事件 payload
  - [ ] `event`: `user_joined | user_left | user_kicked | owner_changed | permission_changed`
  - [ ] `user`
  - [ ] `reason?`
- [ ] 下载任务 payload
  - [ ] 保持当前前端 `DownloadTask` 类型可直接消费。
  - [ ] 失败状态必须包含可展示的 `error` 文案。

### 1.4 替换房间 WebSocket 控制链路

- [ ] 新增/调整 REST 控制接口
  - [ ] 推荐接口：`POST /api/rooms/{roomId}/control`
  - [ ] 请求体：
    ```json
    {
      "action": "play",
      "position": 12.34,
      "video_id": "video-id-or-url",
      "queue": ["video-id-or-url"],
      "request_id": "uuid"
    }
    ```
  - [ ] 响应体：
    ```json
    {
      "ok": true,
      "state": {
        "room_id": "room-id",
        "action": "play",
        "position": 12.34,
        "video_id": "video-id-or-url",
        "queue": ["video-id-or-url"],
        "updated_by": "user-id",
        "updated_at": "2026-04-29T00:00:00Z"
      }
    }
    ```
  - [ ] 后端职责：
    - 校验登录态。
    - 校验用户属于房间。
    - 校验只有房主或管理员可控制播放。
    - 持久化房间最新状态。
    - 使用 Ably REST SDK 向 `room:{roomId}` 发布 `sync`。
- [ ] 替换旧 `/ws/room/{roomId}` 行为
  - [ ] 不再要求后端维持 WebSocket 连接。
  - [ ] 旧接口在迁移期返回明确错误或 410，提示使用 Ably。
  - [ ] 前端所有订阅改为 Ably Realtime SDK。
- [ ] 处理队列变更
  - [ ] `switch`、`next`、队列上移/下移/删除后统一走 `POST /api/rooms/{roomId}/control`。
  - [ ] 服务端以请求中的 queue 为候选值，重新校验视频 ID/URL 合法性后落库。
- [ ] 处理加入/离开房间
  - [ ] 页面进入时调用现有 `GET /api/rooms/{roomId}/state` 获取基线状态。
  - [ ] 客户端 Ably 连接成功后进入 presence。
  - [ ] presence enter/leave 驱动在线成员列表。
  - [ ] 如需审计或持久成员记录，保留 REST join/leave 事件并由后端发布 `room_event`。

### 1.5 替换管理员下载进度 WebSocket 链路

- [ ] 下载任务创建后
  - [ ] 继续使用 `POST /api/admin/downloads` 创建任务。
  - [ ] 创建成功后服务端向 `admin:downloads` 发布 `download_task`，状态为 `pending` 或 `running`。
- [ ] 下载进度更新时
  - [ ] 下载 worker 每次更新数据库后调用 `PublishDownloadTask`。
  - [ ] 事件名固定为 `download_task`。
  - [ ] 控制发布频率，避免高频 progress 更新造成 Ably 消息量过大：
    - 进度变化不足 1% 可合并。
    - 同一任务最小发布间隔建议 500ms-1000ms。
    - 终态 `completed | failed | canceled` 必须立即发布。
- [ ] 前端管理员页
  - [ ] 页面加载时仍调用 `GET /api/admin/downloads` 获取初始列表。
  - [ ] Ably 订阅 `admin:downloads` 后只做增量 upsert。
  - [ ] 断线重连后重新拉取一次 `GET /api/admin/downloads` 对齐状态。

## 2. `ABLY_ROOT_KEY` 与客户端临时 token 签发接口

### 2.1 环境变量与部署配置

- [ ] 后端读取环境变量
  - [ ] 变量名：`ABLY_ROOT_KEY`
  - [ ] 内容：Ably Dashboard 中具备所需能力的 API key。
  - [ ] 最小能力建议包含：`publish`、`subscribe`、`presence`、`history`。
- [ ] Vercel 环境配置
  - [ ] 在 Vercel Project Settings -> Environment Variables 配置 `ABLY_ROOT_KEY`。
  - [ ] 分别确认 Production、Preview、Development 环境是否都需要配置。
  - [ ] 前端构建环境不要配置 `VITE_ABLY_ROOT_KEY`，避免 root key 被打包进浏览器。
- [ ] 本地开发配置
  - [ ] `.env.local` 或后端本地 env 中设置 `ABLY_ROOT_KEY`。
  - [ ] 示例文件只写变量名，不写真实 key。

### 2.2 Token 签发接口设计

- [ ] 新增接口：`POST /api/ably/token`
  - [ ] Header：`Authorization: Bearer <access_token>`
  - [ ] 请求体：
    ```json
    {
      "scope": "room",
      "room_id": "room-id"
    }
    ```
  - [ ] 管理员下载页请求体：
    ```json
    {
      "scope": "admin_downloads"
    }
    ```
  - [ ] 响应体优先返回 Ably TokenDetails：
    ```json
    {
      "token": "ably-token",
      "expires": 1714348800000,
      "issued": 1714345200000,
      "capability": "{\"room:room-id\":[\"subscribe\",\"presence\"]}",
      "clientId": "user-id"
    }
    ```
  - [ ] 如果前端采用 Ably `authUrl` 自动刷新，也可以返回 SDK 支持的 token request/token details 格式；最终格式以 Ably JS SDK 接入方式为准。
- [ ] Token 参数
  - [ ] `clientId` 使用当前用户 ID，避免匿名连接。
  - [ ] TTL 建议 30-60 分钟，满足自动刷新。
  - [ ] capability 根据 scope 动态生成。
- [ ] 房间 scope capability
  - [ ] 普通成员：
    ```json
    {
      "room:{roomId}": ["subscribe", "presence"]
    }
    ```
  - [ ] 房主/管理员如采用客户端直发控制消息，可增加 `publish`；推荐默认不增加，控制操作走后端 `POST /api/rooms/{roomId}/control`。
  - [ ] 若前端需要读取短历史，可增加 `history`。
- [ ] 管理员下载 scope capability
  - [ ] 仅管理员可签发：
    ```json
    {
      "admin:downloads": ["subscribe"]
    }
    ```
- [ ] 安全校验
  - [ ] 未登录返回 401。
  - [ ] 非房间成员请求 room token 返回 403。
  - [ ] 非管理员请求 `admin_downloads` 返回 403。
  - [ ] 不信任客户端传入的 `clientId`、role、capability。
  - [ ] 所有 capability 由服务端根据数据库权限生成。
- [ ] 错误响应
  - [ ] `ABLY_ROOT_KEY` 未配置：500，错误码如 `ABLY_NOT_CONFIGURED`。
  - [ ] Ably SDK 签发失败：502 或 500，记录服务端日志但不暴露 key。
  - [ ] scope 参数非法：400。

### 2.3 Token 自动刷新方案

- [ ] 前端 Ably Client 初始化时使用 `authCallback` 或 `authUrl`
  - [ ] `authCallback` 适合复用当前 `apiFetch` 和 Pinia auth token。
  - [ ] Ably SDK 在 token 过期前自动调用签发接口刷新。
- [ ] token 刷新失败处理
  - [ ] 401：引导重新登录。
  - [ ] 403：显示无权限，并断开当前 Ably channel。
  - [ ] 网络错误：展示重连中状态，保留页面基线数据。

## 3. 前端改造计划（基于当前 Vue 3/Vite 项目）

### 3.1 依赖与基础封装

- [ ] 增加前端依赖
  - [ ] 安装 Ably JS SDK：`ably`
  - [ ] 确认 Vite 构建可正常 tree-shaking。
- [ ] 新增 API 方法
  - [ ] `requestAblyToken(token, input)` -> `POST /api/ably/token`
  - [ ] `sendRoomControl(token, roomId, input)` -> `POST /api/rooms/{roomId}/control`
- [ ] 新增 Ably 客户端封装
  - [ ] 文件建议：`src/composables/useAblyClient.ts`
  - [ ] 输入：当前业务 access token、scope、roomId。
  - [ ] 输出：
    - `client`
    - `connectionState`
    - `connectionError`
    - `connect()`
    - `close()`
  - [ ] 统一处理 Ably connection 状态：
    - `initialized`
    - `connecting`
    - `connected`
    - `disconnected`
    - `suspended`
    - `failed`
    - `closed`
- [ ] 新增消息类型
  - [ ] 在 `src/types.ts` 中补充：
    - `AblyTokenScope`
    - `AblyTokenResponse`
    - `RealtimeEnvelope<T>`
    - `RoomSyncPayload`
    - `RoomEventPayload`
    - `DownloadTaskRealtimePayload`

### 3.2 替换 `useRoomSocket`

- [ ] 将 `src/composables/useRoomSocket.ts` 改造为 Ably 版本，或新建 `useRoomRealtime.ts`
  - [ ] `connect()`：
    - 初始化 Ably Realtime client。
    - 订阅 `room:{roomId}`。
    - 进入 presence。
    - 监听 connection 状态并更新 `connected`。
  - [ ] `close()`：
    - 离开 presence。
    - 取消 channel 订阅。
    - 关闭 Ably client。
  - [ ] 接收消息：
    - `room_snapshot` -> 更新 `lastMessage`。
    - `sync` -> 更新 `lastMessage`。
    - `room_event` -> 更新成员/事件列表。
  - [ ] presence：
    - `enter` -> 添加成员。
    - `leave` -> 移除成员。
    - `update` -> 更新成员资料。
  - [ ] `sendControl()` 不再直接 `socket.send`
    - 推荐改为调用 `sendRoomControl()` REST API。
    - 成功后本地可先乐观更新播放器。
    - 最终以 Ably 收到的 `sync` 消息校准。
- [ ] 保留向上层兼容的返回值
  - [ ] `connected`
  - [ ] `lastMessage`
  - [ ] `events`
  - [ ] `connect`
  - [ ] `sendControl`
  - [ ] `close`
  - [ ] 新增可选：`connectionState`、`membersFromPresence`

### 3.3 房间页 `RoomView.vue` 页面改造

- [ ] 文案替换
  - [ ] 将“操作会通过 WebSocket 广播”改为“操作会通过 Ably 实时同步”。
  - [ ] 实时事件区域标题保留，但可展示 Ably connection 状态。
- [ ] 播放控制交互
  - [ ] 点击播放/暂停/同步进度/切换视频时：
    - 校验 `canControl`。
    - 生成 `request_id`。
    - 调用 `POST /api/rooms/{roomId}/control`。
    - 本地执行乐观播放控制。
    - 收到 Ably `sync` 后以服务端状态覆盖本地状态。
- [ ] 队列交互
  - [ ] 添加 URL、加入视频库、上移、下移、删除后，只更新本地草稿队列。
  - [ ] 点击切换或同步时将完整 queue 发给服务端。
  - [ ] 可选新增“保存队列”按钮，避免队列只在本地变化但未广播。
- [ ] 在线成员
  - [ ] 使用 Ably presence 替代仅靠 `room_snapshot`/`room_event` 维护成员列表。
  - [ ] UI 显示连接状态：
    - 已连接
    - 重连中
    - 离线
    - 权限失效
- [ ] 断线恢复
  - [ ] Ably 从 `suspended`/`failed` 恢复后重新调用 `GET /api/rooms/{roomId}/state`。
  - [ ] 重新进入 presence。
  - [ ] 保留最近 30 条实时事件用于调试展示。
- [ ] 权限变化
  - [ ] 如果收到 403 或 token 刷新失败：
    - 禁用控制按钮。
    - 展示“实时权限已失效，请重新进入房间”。

### 3.4 管理员页 `AdminView.vue` 页面改造

- [ ] 将 `connectDownloadSocket()` 替换为 `connectDownloadRealtime()`
  - [ ] 初始化 admin scope Ably token。
  - [ ] 订阅 `admin:downloads` 的 `download_task`。
  - [ ] 收到任务后按 `task.id` upsert 到 `downloads`。
- [ ] 状态文案
  - [ ] 将 `WebSocket {{ wsStatus }}` 改为 `Ably {{ realtimeStatus }}`。
  - [ ] 状态映射：
    - `connecting` -> `连接中`
    - `connected` -> `已连接`
    - `disconnected/suspended` -> `重连中`
    - `failed` -> `连接异常`
    - `closed` -> `已断开`
- [ ] 首屏数据策略
  - [ ] 保留 `loadAll()` 作为初始快照。
  - [ ] Ably 只做后续增量。
  - [ ] 连接恢复后自动 `fetchDownloads()` 防止漏消息。
- [ ] 权限错误
  - [ ] 非管理员无法获取 admin token 时，不重复重连。
  - [ ] 页面显示“无权订阅下载实时进度”。

### 3.5 API 与环境变量文档更新

- [ ] README 更新
  - [ ] 移除旧 WebSocket 接口说明。
  - [ ] 新增 Ably 实时说明：
    - `POST /api/ably/token`
    - `POST /api/rooms/{roomId}/control`
    - Ably channels：`room:{roomId}`、`admin:downloads`
  - [ ] 补充 Vercel 环境变量：
    - `ABLY_ROOT_KEY`：仅后端。
    - `VITE_API_BASE`：前端 API 基础地址。
- [ ] 前端 `.env.example`
  - [ ] 如项目需要，补充 `VITE_API_BASE`。
  - [ ] 不增加任何 Ably root key 的 `VITE_` 变量。

## 4. 迁移顺序建议

- [ ] 第一阶段：后端基础能力
  - [ ] 接入 Ably Go SDK。
  - [ ] 实现 `ABLY_ROOT_KEY` 配置读取。
  - [ ] 实现 `POST /api/ably/token`。
  - [ ] 增加 token scope 权限测试。
- [ ] 第二阶段：管理员下载进度
  - [ ] 服务端下载任务更新时发布 `admin:downloads`。
  - [ ] 前端 `AdminView.vue` 切换到 Ably 订阅。
  - [ ] 验证 Vercel 环境不再依赖 WebSocket。
- [ ] 第三阶段：房间只读实时订阅
  - [ ] 前端房间页订阅 `room:{roomId}`。
  - [ ] presence 替代在线成员 WebSocket 维护。
  - [ ] 保留旧控制发送方式作为临时回滚点。
- [ ] 第四阶段：房间控制链路
  - [ ] 新增 `POST /api/rooms/{roomId}/control`。
  - [ ] 服务端发布 `sync`。
  - [ ] 前端 `sendControl()` 改为 REST + Ably 校准。
- [ ] 第五阶段：移除旧 WebSocket
  - [ ] 删除或禁用 `/ws/room/{roomId}`。
  - [ ] 删除或禁用 `/ws/admin/downloads`。
  - [ ] 删除 Vite dev server 中 `/ws` proxy。
  - [ ] 删除前端 `new WebSocket(...)` 代码。

## 5. 测试与验收清单

- [ ] 后端单元/集成测试
  - [ ] `ABLY_ROOT_KEY` 未配置时返回明确错误。
  - [ ] 普通用户只能获取自己可进入房间的 subscribe/presence token。
  - [ ] 房主/管理员控制房间时，服务端能持久化状态并发布 `sync`。
  - [ ] 非房主普通用户调用控制接口返回 403。
  - [ ] 管理员可获取 `admin:downloads` token。
  - [ ] 普通用户无法获取 `admin:downloads` token。
- [ ] 前端自动化检查
  - [ ] TypeScript 类型检查通过。
  - [ ] Vite build 通过。
  - [ ] Ably connection 状态和错误状态有明确 UI 分支。
- [ ] 手动验收：房间同步
  - [ ] 两个浏览器登录不同用户进入同一房间。
  - [ ] 房主播放、暂停、拖动进度，另一端同步。
  - [ ] 房主切换视频，另一端同步视频与队列。
  - [ ] 普通成员控制按钮禁用，无法通过接口越权控制。
  - [ ] 刷新页面后先恢复 REST 快照，再继续接收 Ably 消息。
  - [ ] 断网/恢复后成员列表和播放状态能重新对齐。
- [ ] 手动验收：管理员下载进度
  - [ ] 管理员打开后台页，状态显示 Ably 已连接。
  - [ ] 创建下载任务后列表实时出现新任务。
  - [ ] 下载进度变化实时更新。
  - [ ] 下载完成/失败/取消状态实时更新。
  - [ ] 非管理员无法订阅下载频道。
- [ ] Vercel 验收
  - [ ] Production/Preview 环境已配置 `ABLY_ROOT_KEY`。
  - [ ] 前端 bundle 中搜索不到 `ABLY_ROOT_KEY` 或真实 Ably root key。
  - [ ] 部署后不存在依赖自建 WebSocket 的功能路径。
  - [ ] 冷启动后 token 签发和发布消息可正常工作。

## 6. 风险与待决策事项

- [ ] 房间控制是否允许客户端直接 publish 到 Ably
  - [ ] 推荐默认不允许，避免绕过服务端权限和状态持久化。
  - [ ] 如为了极低延迟允许房主/管理员 publish，需要额外设计服务端状态回写或 Ably webhook，防止刷新后状态丢失。
- [ ] Ably 消息历史是否启用
  - [ ] 房间同步通常不依赖历史，以 REST 快照为准。
  - [ ] 如果要用 history 做断线补偿，需要在 token capability 中增加 `history` 并限制读取范围。
- [ ] 下载任务发布频率
  - [ ] 需要在实时性和 Ably 消息量之间折中。
  - [ ] 建议按百分比变化和时间窗口节流。
- [ ] 旧 WebSocket 兼容期
  - [ ] 如果当前已有线上用户使用旧前端，需要短期保留旧接口。
  - [ ] 如果只发布新前端，可直接返回 410 并删除旧代理。
