# 行政工作类型与同类聚合 Design

Date: 2026-07-14

## 背景与需求

新增任务类型「行政工作」——回复邮件、处理账单之类杂项工作的统称。这类任务应在**不违背硬约束**(截止时间、执行场景、最小时长、不重叠)的前提下**尽量连续安排在一起**(批处理)。用户选择的强度是"可重排来聚合":允许调整放置顺序把行政任务连成一段,即使这意味着一个低优先级行政任务被提到高优先级行政任务旁边、越过中间优先级的其它任务。

## 目标

- 新增内置类型 `行政工作`,带合理默认值(表单可覆盖)。
- 同类行政任务在窗口内被放置成相邻的一段。
- 硬约束(截止/场景/最小时长/不重叠)绝不因聚合被破坏。
- 不改变没有批处理属性的现有任务的调度结果。

## 设计

### 1. 类型与 batchGroup 字段
- `TASK_TYPE_DEFAULTS` 增加 `行政工作`:`energyDemand: 'low'`、`physicalDemand: 'low'`、`splittable: true`、`minSegmentMinutes: 15`、`executionContext: ANY`、`orderPreference: 'afternoon'`、`externalCommitment: 2`。
- 所有类型默认新增字段 `batchGroup`:`行政工作 → '行政工作'`,其余类型 → `null`。作为可扩展的"成块分组键"。
- `createTask` 透传:`batchGroup: input.batchGroup ?? defaults.batchGroup ?? null`。表单不含该字段,由类型默认推导。

### 2. 聚合机制:组代表优先级排序
窗口内放置排序保持主键不变(截止时间 → 场景受限),仅修改最末的优先级键:
- 对参与排序的任务集合,计算 `groupRep: Map<batchGroup, 组内最高 calculatePriority>`。
- 比较两任务的优先级键时,属于某 batch 组的任务改用 `groupRep.get(batchGroup)`,否则用自身 `calculatePriority`。
- 同组任务的代表优先级相等 → 相邻;组内再按自身优先级降序、名称升序稳定排序。

因主键仍是截止时间与场景,聚合只发生在同一(截止/场景)等价类内的优先级层面:
- 行政任务不会被推迟到自己的截止时间之后(截止是主键,截止任务始终先排);
- 行政任务不会被排进不兼容场景;
- 窗口内贪心前向填充,排序相邻即时间相邻。

### 3. 接口改动
- `placementComparator(now, groupRep = new Map())`:第二参为组代表优先级表,默认空表 → 退化为纯自身优先级(现状)。
- `scheduleWindow`:排序前用窗口任务算出 `groupRep`,传入 `placementComparator`。
- `reclaimWastedCapacity` / `selectBestAssignment` 等仍用 `priorityDescending`(候选选择,不影响聚合);无需改。

### 4. 无回归
无 `batchGroup` 的任务代表优先级=自身优先级,排序与现状完全一致。既有任务与测试不受影响。

### 5. UI / 持久化
- 表单类型下拉遍历 `TASK_TYPE_DEFAULTS`,新类型自动出现;选中时 `applyTaskTypePreset` 填入默认字段。
- `batchGroup` 随任务元数据写入/回读;旧事件缺该字段时由类型默认重新推导。

## 测试策略(TDD)

1. `TASK_TYPE_DEFAULTS['行政工作']` 存在且 `batchGroup==='行政工作'`;`createTask({taskType:'行政工作'}).batchGroup==='行政工作'`;其它类型 `batchGroup` 为 `null`。
2. 调度:同窗口内两个行政任务之间夹一个优先级居中的非行政任务,重排后两个行政任务时间相邻,非行政任务排在其后;无重叠。
3. 硬约束:带较早截止时间的非行政任务不因聚合被推迟到截止后(截止任务仍先排)。
4. 现有测试全绿。

## 应用结构影响

- `src/models.js`:新增类型、`batchGroup` 字段与透传。
- `src/scheduler.js`:`placementComparator` 增参、`scheduleWindow` 计算并传 `groupRep`。
- `scheduler`/`priority` 其余不变;UI 无需结构改动。

## 验收标准

- 可创建「行政工作」任务;多个行政任务在不破硬约束下被排成相邻一段。
- 现有测试全绿,新增测试覆盖类型定义与聚合行为。
