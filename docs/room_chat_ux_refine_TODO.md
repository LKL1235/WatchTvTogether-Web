# 房间页聊天区 UX 优化（折叠位置 / 图标 / 在线成员）

> 创建时间：2026-05-20  
> 状态：**已实现**

## 已确认方案（2026-05-20）

| 项 | 决定 |
|----|------|
| 成员位置 | 仅从工具抽屉迁出；抽屉**只保留队列** |
| 成员默认态 | **默认展开**；不持久化折叠态 |
| 收起/展开图标 | 内联 SVG：折叠条 **←** 展开，header **→** 收起 |
| 移动端 | `RoomChatSheet` 顶部同样加成员区 |
| 成员列表高度 | **固定高度**（`7.5rem`），超出在区内滚动 |

---

## 任务列表

### 1. 折叠 / 展开控制区置顶对齐

- [x] `.room-chat-collapsed-strip` 顶部对齐（`align-items: flex-start`）
- [x] `aria-label` 保留

### 2. 用文字按钮改为 ← / → 图标

- [x] 折叠条：内联 SVG ← + `aria-label="展开聊天"`
- [x] header：内联 SVG → + `aria-label="收起聊天"`
- [x] `.room-chat-icon-btn` 统一样式（`styles.css`）

### 3. 在线成员迁入聊天列顶部（可折叠）

- [x] 新建 `RoomChatMembersBlock.vue`
- [x] 桌面 `RoomView` 聊天列、移动 Sheet 均接入
- [x] 从 `RoomToolsDrawer` 移除成员卡片
- [x] 入口文案「队列与成员」→「队列」；抽屉标题「视频队列」

### 4. 样式与布局回归

- [x] 成员列表固定高度 + `overflow-y: auto`
- [x] `RoomChatPanel` 仍 `flex: 1`
- [x] 折叠聊天列不显示成员区

### 5. 持久化

- [x] 不做成员折叠态持久化（每次进房默认展开）

### 6. 文档与验收

- [x] `README.md` 补充房间页布局说明
- [ ] 手动验收（进房后由使用者确认）

---

## 进度备注

- PR #27 → 实现提交于分支 `cursor/room-chat-ux-refine-todo-aad5`
- 验证：`npm run build`
