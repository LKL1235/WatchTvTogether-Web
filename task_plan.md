# Task Plan: Twitch 风格房间聊天侧边栏

> 依据 `docs/chat_design.md` v1.0

## Goal

将房间页聊天改为视频右侧可伸缩全高聊天列（桌面）+ 底部 Sheet（移动），队列/成员迁入独立工具抽屉；不改后端 API。

## Current Phase

Phase 5 — Delivery

## Phases

### Phase 1: Requirements & Discovery
- [x] 阅读 chat_design.md 与 RoomView.vue 现状
- [x] 确认数据层无需改动
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 定义组件与 composable 拆分
- [x] 创建 planning 文件
- **Status:** complete

### Phase 3: Implementation
- [x] useRoomChatPanelLayout + useChatScroll
- [x] RoomChatPanel、RoomChatResizer、RoomToolsDrawer、RoomChatSheet
- [x] 重构 RoomView.vue + styles.css
- **Status:** complete

### Phase 4: Testing & Verification
- [x] vue-tsc + npm test + npm run build
- [x] 对照 chat_design.md §13 核心项（自动化；UI 需人工点验）
- **Status:** complete

### Phase 5: Delivery
- [ ] 提交、推送、更新 PR
- **Status:** in_progress

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 新分支 `cursor/room-chat-sidebar-impl-2957` | 与仅文档的 design PR 分离 |
| 全屏监听绑在 `document` + `video` | 代码库尚无全屏逻辑，需新增 |
| overlay 状态 `chat \| tools \| null` | 移动互斥；桌面 tools 独立 boolean |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| session-catchup.py 不存在 | 1 | 跳过，直接读 chat_design |
