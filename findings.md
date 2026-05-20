# Findings: 房间聊天侧边栏

## 现状（main）

- `RoomView.vue` ~1900 行：播放器、队列、聊天、成员全在一文件
- `.room-layout` 为 grid `1fr | 300-400px`；`.room-sidebar` 含队列+聊天+成员
- `.room-chat-log { max-height: 14rem }` 限制聊天高度
- 移动 ≤960px：整块侧栏右滑 drawer，按钮「队列与成员」
- 无 `requestFullscreen` / 全屏相关代码，需新增监听
- 聊天数据：`useRoomRealtime.chatMessages` + HTTP history/send

## 设计约束（chat_design.md）

- 桌面：flex 布局，聊天右列 280–480px/38vw，localStorage `wtt.roomChatPanel.v1`
- 移动：65vh Sheet + 工具 drawer 互斥
- Enter 发送、Shift+Enter 换行、新消息滚动提示
- 不改 api.ts / useRoomRealtime 契约
