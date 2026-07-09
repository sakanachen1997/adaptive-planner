# 撤销任务完成 Design

Date: 2026-07-09

## 背景与问题

当前把任务标记完成后没有任何撤销路径,误点完成无法回退:

1. **无"取消完成"入口**:完成后详情面板只有"编辑""删除并重排",没有恢复按钮。用户只能删除任务(彻底丢失),无法把它退回计划。
2. **未来任务被完成会蒸发**:`completeTask` 把 `actualStart` 设为任务计划开始时间、`actualEnd` 设为当前时刻。若计划开始时间晚于当前时刻(误点一个更晚的任务),`actualStart > actualEnd`,区间为负,调度器 `completedSegments` 会丢弃该完成段;而任务状态为 `completed`,既不进活动任务也不进"错过"列表,于是从时间轴彻底消失,连恢复的抓手都没有。

仅针对桌面网页端。

## 目标

- 提供"撤销/恢复完成"——把已完成任务退回未完成状态并重新参与调度。
- 保证**任何**已完成任务都能被找到并恢复,包括时间轴上不可见(区间退化)的那种。
- 不引入完成前的确认弹框(撤销比确认更适合高频完成操作)。

## 设计

### 1. 恢复动作 `uncompleteTask`（纯函数 + 编排）

新增纯函数 `uncompleteTaskInList(tasks, key)`(与现有 `removeTaskForReschedule` 同风格),对匹配 `taskEditKey` 的任务:

- `status` 改为 `TASK_STATUSES.PENDING`;
- `actualStart` / `actualEnd` 置为 `null`;
- 保留 `taskId` / `calendarEventId` / `segmentId` / `planDate`;
- 若有 `calendarEventId`,置 `localOverride: true`(确保本地覆盖胜过日历回读的 completed 状态)。

返回新的 tasks 数组(不可变更新)。UI 侧 `uncompleteTask(key)` 调用它更新 `state.tasks`,`recalculate()`,并 `showMessage('已恢复为未完成,已重新排入计划。')`。

恢复后任务状态为 pending → 重新进入 `scheduleDay` 的活动任务集,正常排程。已同步到日历的任务在下次同步时,由现有 `buildSyncOperations` 依据 scheduled 状态把事件从"已完成"改回"计划中",无需新逻辑。

### 2. "已完成"列表区（当天计划面板）

在 `当天计划` 面板、时间轴下方新增一个区块 `#completedList`,渲染 `allTasks()` 中 `status === completed` 的任务,**不依赖时间轴几何**:

- 每项显示:任务名 + 实际时间(有有效 `actualStart/actualEnd` 时显示 `HH:MM - HH:MM`,否则显示"已完成");
- 每项一个按钮 `恢复为未完成`,`dataset.uncompleteTaskKey = taskEditKey(task)`;
- 无已完成任务时不渲染该区块。

这是恢复的**兜底入口**:即使完成段因区间退化在时间轴上消失,任务仍会出现在此列表中,可被恢复。

### 3. 时间轴详情面板的便捷入口

`renderTimelineTaskDetail` 中,当所选项 `status === completed` 时,在动作区追加同样的 `恢复为未完成` 按钮(与"已完成"列表复用同一 `uncompleteTaskKey` 数据属性与点击处理)。

### 4. 事件绑定

`scheduleList` 的既有点击委托中,识别 `dataset.uncompleteTaskKey` → 调用 `uncompleteTask(key)`(与现有 `editTaskKey` / `removeTaskKey` 分支并列)。

## 边界情况

- **区间退化的完成任务**:仍出现在"已完成"列表(显示"已完成"),可恢复。恢复后 `actualStart/actualEnd` 清空,按计划重排。
- **日历回读的已完成任务**:恢复时 `localOverride: true` 覆盖回读状态;下次同步把事件改回计划中。
- **找不到 key**:`showMessage('找不到要恢复的任务。', true)`,不改状态。

## 测试策略(TDD)

1. `uncompleteTaskInList` 把 completed 任务改回 pending、清空 actual 时间、保留 id、日历任务置 localOverride —— 纯函数单测。
2. `uncompleteTaskInList` 对不存在的 key 原样返回。
3. 恢复后任务重新参与调度(集成:一个 completed 任务恢复后出现在 schedule 的 scheduled 段中)——可用现有 scheduler 能力在 ui 层验证,或最小化为纯函数覆盖。
4. 现有测试全绿。

## 应用结构影响

改动集中在 `src/ui.js`(新增 `uncompleteTaskInList` 导出、`uncompleteTask` 编排、`#completedList` 渲染、详情面板按钮、点击委托分支)与 `index.html`(时间轴下方 `#completedList` 容器)。`scheduler.js` 不变。

## 验收标准

- 误点完成后,可在"已完成"列表或时间轴详情里一键恢复为未完成并重新排入计划。
- 计划开始时间晚于当前时刻的任务被完成后不会永久消失——仍可在"已完成"列表中恢复。
- 不新增完成确认弹框。
- 现有测试全绿,新增测试覆盖恢复逻辑。
