# 从当前时间调度开关 Design

Date: 2026-07-13

## 背景与问题

当前调度锚定当天午夜(`scheduleStart = planDate T00:00`),整天计划稳定:时间流逝不会让任务自动前移,计划时间已过却未完成的任务显示为"已错过",不会重排到未来。

用户场景:任务 A 排在前,因故提前做了排在后的任务 B。勾选 B 完成后,希望以**当前时间**为起点重排剩余未完成任务,包括原计划在 B 之前、被跳过的 A——把 A 挪到未来,而不是留作"已错过"。

## 目标

- 提供一个可选的"从当前时间调度"模式:打开时以当前时间为调度起点,把所有未完成任务(含原本会变"已错过"的)重排到现在之后。
- 保留现有午夜锚定的稳定整天计划作为默认。
- 完成任务与该模式自然联动:模式打开时,勾选完成即触发从现在起的重排。

仅桌面网页端;调度器核心不改。

## 设计

### 1. 全局开关（持久化设置）
- 顶部操作区新增复选框 **「从当前时间调度」**,绑定 `state.settings.scheduleFromNow`,默认 `false`,存入 localStorage(与其他偏好一致)。

### 2. 调度起点选择
- 纯函数 `resolveScheduleStart({ scheduleFromNow, planDate, now })`:
  - `scheduleFromNow` 为真且 `now` 的日期部分等于 `planDate` → 返回 `now`;
  - 否则返回 `planDate T00:00:00`(午夜)。
- `recalculate()` 与 `currentDebugReport()` 均改用它计算 `scheduleStart`。查看非今天日期时自动退回午夜锚点。

### 3. 效果
调度起点为当前时间时,`scheduleDay` 已有行为即可满足:当前时刻之前的时间块被裁掉,已完成任务的过去时段保留,未完成任务(含 A)重排到现在之后。调度器无需改动。

### 4. 完成联动
`completeTask` 已经在完成后调用 `recalculate()`;因 `recalculate` 现按开关选择起点,模式打开时完成 B 即以当前时间重排,A 前移。开关是持续模式,期间每次重排都以当前时间为起点。

### 5. "已错过"抑制
- `buildTimelineItems` 增加参数 `suppressMissed`(默认 `false`)。为真时跳过 `missedTimelineItems`。
- `renderSchedule` 在 `scheduleFromNow` 模式(且看今天)下传 `suppressMissed: true`,避免被重排到未来的任务同时残留一个"已错过"幽灵块。

### 6. 边界
- 用户手动固定的任务,若固定时段已完全早于当前时间且未完成,在该模式下落在起点之前而无法排入未来 → 被丢弃(与现有 `fixedFutureInterval` 行为一致),不特殊处理。

## 测试策略(TDD)

1. `resolveScheduleStart`:开+今天→now;开+非今天→午夜;关→午夜。
2. `buildTimelineItems({ suppressMissed: true })` 不产出 `status: 'missed'` 项;默认仍产出。
3. 调度器层 A/B 场景:`scheduleStart = now` 时,原计划在前、未完成的 A 被排到 now 之后(回归/文档用例)。
4. 设置往返:`scheduleFromNow` 能存取。
5. 现有测试全绿。

## 应用结构影响

- `src/storage.js`:`DEFAULT_SETTINGS` 增加 `scheduleFromNow: false`,校验与读取相应处理。
- `src/ui.js`:新增 `resolveScheduleStart` 导出;`recalculate`/`currentDebugReport` 使用它;`buildTimelineItems` 增 `suppressMissed`;`renderSchedule` 传参;开关渲染与事件绑定;`createState` 读取设置。
- `index.html`:开关复选框。
- 调度器 `scheduler.js` 不变。

## 验收标准

- 打开"从当前时间调度"并完成 B 后,A 被重排到当前时间之后,不再显示为"已错过"。
- 关闭时行为与现状一致。
- 设置持久化;现有测试全绿,新增测试覆盖上述逻辑。
