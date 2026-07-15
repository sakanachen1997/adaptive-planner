# 手动紧迫度 + 过期截止拦截 + 冲突原因细化 — 设计

日期：2026-07-15

## 背景

当前 `截止时间` 承担两个作用：(1) 推导紧迫度（0–6）参与优先级；(2) 硬约束（任务须排在截止前）。
由此产生两个体验问题：

1. 紧迫度无法由用户直接控制，只能通过截止时间间接影响。
2. 已过期的截止时间使“排在截止前”不可能满足，任务报 `placement_failure`，且连带阻塞整天计划，报错信息也不够具体。

## 目标

1. **紧迫度与截止时间脱钩**：紧迫度改为用户手动填写的字段。
2. **过期截止 → 明确拦截报错**：清楚标明截止时间在过去，要求用户修改。
3. **`placement_failure` 精确区分原因**：区分“场景不匹配 / 固定任务重叠 / 截止太紧 / 容量不足”，并指明具体任务与冲突时段。

## 决策

- 紧迫度取值：整数 0–6，默认 0（保留现有优先级公式权重 `重要性×10 + 紧迫度×6 + √想要时长 + 外部承诺×4`）。
- 截止时间脱钩后**仅保留硬约束**：`usableMinutes` 仍裁剪到截止前，`placementComparator` 仍让早截止的先挑位置；不再影响优先级。
- 过期判定：`截止时间 < now`（真实此刻，非 `scheduleStart`）。

## 改动 1：手动紧迫度

- `models.js`：新增字段 `urgency`（整数 0–6，越界 `RangeError`），`createTask` 缺省填 0（与 `importance` 一样是逐任务字段，不随任务类型预设变化）。
- `priority.js`：`calculatePriority` 用 `Number(task.urgency ?? 0)` 取代 `calculateUrgency(deadline, now)`；删除 `calculateUrgency` 及其单测。
- `index.html` / `ui.js`：任务表单新增“紧迫度 0–6”输入；`taskInputFromFormData`、`formInputForTask`、`fillTaskForm`、任务类型默认填充均带 `urgency`。
- 同步：`urgency` 经 `...taskMetadata` 自动写入/回读，`schemaVersion` 维持 1（旧事件缺该字段 → 读回默认 0，向后兼容）。

## 改动 2：过期截止拦截冲突 `deadline_in_past`

- `scheduler.js`：`scheduleDay` 在依赖校验之后、其它冲突之前，收集活动任务中 `有效截止时间 < now` 者，返回 `conflict.kind = 'deadline_in_past'`，携带 `deadlineViolations: [{taskId, taskName, deadline}]` 并停止调度。
- `ui.js`：`conflictSummaryLines` 新增文案：`任务「X」的截止时间 YYYY-MM-DD hh:mm 已过去。请修改或清除该任务的截止时间后重排。`

## 改动 3：`placement_failure` 原因细化

在 `scheduleDay` 顶层拿到失败任务后，用完整 `available` 块、受保护事件、其它固定任务分类原因，写入该 belowMinimum 记录的 `reason` 及细节：

| reason | 判定 | 文案要点 |
|---|---|---|
| `no_compatible_context` | 该任务执行场景在当天无任何兼容可用块 | 指明执行场景标签 |
| `fixed_overlap` | 用户固定任务的固定时段无可用块可完整容纳（被受保护事件/另一固定任务遮挡，或落在可用块外） | 指明固定时段与重叠对象 |
| `deadline_too_tight` | 有兼容块但裁到截止前可用分钟 < 最小时长 | 指明截止时间与最小时长 |
| `insufficient_capacity` | 兼容块与时间均足够，被挤占/碎片化（默认） | 沿用现有文案 |

## 测试

- `priority.test.js`：手动 urgency 参与优先级；无 deadline 也能有高紧迫度；deadline 不再影响优先级。
- `models.test.js`：`urgency` 校验（默认 0、边界 0/6、越界报错）。
- `scheduler.test.js`：过期截止返回 `deadline_in_past`；各 `placement_failure` 原因分类正确。
- `ui.test.js`：新冲突文案；表单 urgency 往返；类型默认填充 urgency。
- `html.test.js`：表单含 `urgency` 输入。

## 向后兼容

- 旧日历事件无 `urgency` → 默认 0。
- 过期截止之前报 `placement_failure`，现改报更明确的 `deadline_in_past`；`shouldShowRecoveryActions` 不变（仅 `minimum_overflow` 显示通用恢复动作）。
