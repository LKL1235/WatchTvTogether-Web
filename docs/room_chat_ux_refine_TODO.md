# 房间页聊天区 UX 优化（折叠位置 / 图标 / 在线成员）

> 创建时间：2026-05-20  
> 状态：**待方案确认，未开始编码**

## 背景与问题

桌面端（≥961px）已实现独立右侧聊天列（`RoomChatPanel` + `useRoomChatPanelLayout`），队列与在线成员仍在 `RoomToolsDrawer` 中。当前体验存在以下不一致：

| 问题 | 现状（代码/样式） | 期望 |
|------|-------------------|------|
| 折叠后展开入口位置 | `.room-chat-collapsed-strip` 使用 `flex: 1` + `align-items: center`，展开按钮在窄条**垂直居中** | 与展开态一致：控制区在**顶部**；若用户在顶部收起，展开也在顶部 |
| 展开按钮形态 | 文案「展开聊天」+ `writing-mode: vertical-rl`（`RoomView.vue` L1472–1480，`styles.css` L631–653） | 使用 **← 方向图标**（或等效 chevron），不用文字；保留 `aria-label` |
| 在线成员位置 | 仅在「队列与成员」抽屉内（`RoomToolsDrawer.vue` L185–205） | 放在**聊天列最上方**，可向下展开 / 向上收起，边看边聊时更易见 |

相关文件：

- `src/views/RoomView.vue` — 桌面聊天列结构、折叠条、header「收起」
- `src/assets/styles.css` — `.room-chat-panel`、`.room-chat-collapsed-strip*`
- `src/components/room/RoomChatPanel.vue` — 消息列表 + 输入区
- `src/components/room/RoomToolsDrawer.vue` — 当前在线成员 UI
- `src/composables/useRoomChatPanelLayout.ts` — 宽度/折叠持久化（`wtt.roomChatPanel.v1`）
- `docs/chat_design.md` — 原 Twitch 风格侧栏设计（成员在工具抽屉为方案 A）

---

## 待确认方案（编码前需用户确认）

- [ ] **成员区块范围**：在线成员是否**仅从工具抽屉迁出**到聊天列顶部，抽屉内是否保留一份（建议：**仅聊天列保留**，抽屉专注队列，避免两处同步维护）
- [ ] **成员折叠默认态**：进房时默认**展开**还是**收起**？是否写入 `localStorage`（例如 `membersExpanded`）与聊天宽度一并持久化
- [ ] **图标来源**：复用播放器 `player-chrome__icon-button` 风格 + 内联 SVG / Unicode，还是新增小型 `IconChevronLeft` 组件（需与全站 UI 一致）
- [ ] **收起按钮对称性**：展开态 header 右侧「收起」是否一并改为 **→** 图标（与 ← 展开对称），还是本期只改折叠条
- [ ] **移动端**：底部 `RoomChatSheet` 是否同样在顶部增加可折叠「在线成员」（用户本次描述偏桌面，但 `chat_design.md` 要求移动/桌面同期交付时需一并定案）

---

## 任务列表

### 1. 折叠 / 展开控制区置顶对齐

- [ ] 调整 `.room-chat-collapsed-strip` 布局：`align-items: flex-start`（或去掉 `flex: 1` 居中），使展开控件贴在聊天列**顶部**，与 `.room-chat-panel__header` 视觉对齐
- [ ] 确认展开后 header 与折叠条占用同一顶部槽位（高度、padding 一致），避免展开时控件「跳动」到其他纵向位置
- [ ] 键盘与无障碍：折叠条按钮保留 `aria-expanded` / `aria-label="展开聊天"`（或等价中文）

### 2. 用文字按钮改为 ← 图标

- [ ] 将 `room-chat-collapsed-strip__btn` 内「展开聊天」替换为 ← 向图标（建议水平箭头指向右侧展开方向，或 chevron-left，以设计稿为准）
- [ ] 移除或不再依赖 `writing-mode: vertical-rl` 竖排文字样式
- [ ] （若方案确认）header「收起」改为配对图标 + `aria-label="收起聊天"`
- [ ] 悬停 / focus-visible 样式与现有 `player-chrome__icon-button` 或 `AppButton ghost` 保持一致

### 3. 在线成员迁入聊天列顶部（可折叠）

- [ ] 新建组件（建议名 `RoomChatMembersBlock.vue`）或在 `RoomView` 聊天列内抽取区块：标题行 + 展开/收起控制 + 成员列表
- [ ] **交互**：默认展示标题行（如「在线成员 (N)」）；点击可**向下展开**列表，再次点击**向上收起**；动画可选 `max-height` / `grid-template-rows` 过渡
- [ ] **数据**：复用 `RoomView` 已有 `members` 与 `displayNameForUser`、`kick` 等逻辑；踢人按钮权限与抽屉内一致（`canControl`）
- [ ] **布局顺序**（桌面 `.room-chat-panel` 内自上而下）：`[可折叠成员]` → `[聊天 header 可选合并]` → `RoomChatPanel`（消息 + 输入）
- [ ] 从 `RoomToolsDrawer` **移除**在线成员 `AppCard`（若确认不双份展示）
- [ ] 更新 `docs/chat_design.md` §5 信息架构图与决策表（成员归宿变更）

### 4. 样式与布局回归

- [ ] 成员展开时，`RoomChatPanel` 消息区仍 `flex: 1; min-height: 0`，不被挤没高度
- [ ] 折叠聊天列（40px 窄条）时：仅显示顶部图标按钮，不预留成员区
- [ ] 检查 `RoomChatResizer` 在 `is-collapsed` 时行为无回归

### 5. 持久化（可选，依方案确认）

- [ ] 若需记住成员折叠态：扩展 `CHAT_PANEL_STORAGE_KEY` JSON 或单独 key；`useRoomChatPanelLayout` 读写
- [ ] 若不做持久化：在 TODO 验收项中注明「每次进房默认 X」

### 6. 文档与验收

- [ ] 更新 `README.md`（若入口文案「队列与成员」改为仅「队列」等**用户可见**变更）
- [ ] 手动验收清单：
  - 桌面：收起聊天 → 展开按钮在列**顶部**，图标可点，无竖排「展开聊天」文案
  - 桌面：展开聊天 → 顶部成员区可展开/收起，列表与踢人功能正常
  - 工具抽屉：队列功能正常，成员不再重复（或按确认方案保留）
  - 全屏：聊天列仍隐藏，退出后状态恢复
  - 移动（若纳入范围）：Sheet 内成员交互符合方案

---

## 实现提示（供确认后编码参考）

```
.room-chat-panel（展开）
├─ .room-chat-members（可折叠，默认 ?）
│   ├─ 标题 + chevron
│   └─ 成员列表（v-for members）
├─ .room-chat-panel__header（聊天 + [←/→] 收起）
└─ .room-chat-panel__body → RoomChatPanel

.room-chat-panel.is-collapsed
└─ .room-chat-collapsed-strip（顶部对齐）
    └─ button[aria-label=展开聊天] → 「←」图标
```

---

## 非目标（本期不做，除非另行确认）

- 后端 / Ably Presence API 变更
- 未读角标、@、表情等聊天增强
- 聊天列左右位置切换

---

## 进度备注

（编码开始后在此追加 PR 链接、关键 commit、验证命令）
