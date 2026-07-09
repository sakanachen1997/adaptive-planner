# 按场景窗口隔离调度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让调度器按场景(work/home)隔离时间窗口:各窗口内独立分配与压缩,富余互不输送;任意场景任务对每个窗口生成计划、按总压缩量择优落窗口。

**Architecture:** 抽出 `scheduleWindow` 单窗口调度核心;`scheduleDay` 改为"划分窗口 → 分类任务 → 枚举/贪心分配浮动任务 → 各窗口独立调度 → 择优汇总"。修复 `distributeCompression` 的跨轮部分收敛。

**Tech Stack:** 纯 ES modules,`node --test`,无依赖。

## Global Constraints

- 纯前端、无后端、无新依赖。
- 冲突输出结构不变(`kind` / `belowMinimum` / `deadlineViolations` / `actions`)。
- 现有全部测试(`npm test`)必须保持绿。
- 浮动任务枚举阈值 = 8,超过退化为贪心。

---

### Task 1: 修复 distributeCompression 跨轮部分收敛

**Files:**
- Modify: `src/scheduler.js`(`distributeCompression`)
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Produces: `distributeCompression(deficit, donors, now)` — 当本轮 slack 不足以覆盖缺口时,返回**已压下的部分**(`taken>0` 的项)而非 `null`;仅当完全无 slack 可压时返回 `null`。

- [ ] **Step 1: 写失败测试** — 单窗口内需多轮压缩才收敛(高优先弹性任务撑满、最低优先任务差几分钟,靠逐步压回高优先任务解决)。

```js
test('window compression converges across rounds instead of giving up one minute short', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    availableBlocks: [
      block('09:00', '11:00', CONTEXTS.WORK),
      block('18:00', '23:40', CONTEXTS.HOME)
    ],
    protectedBlocks: [],
    tasks: [
      task({ taskName: '晚高优', taskType: '绘画委托副业', desiredMinutes: 90, minimumMinutes: 60, importance: 5, executionContext: CONTEXTS.HOME, splittable: true, minSegmentMinutes: 30 }),
      task({ taskName: '晚健身', taskType: '运动健身', desiredMinutes: 140, minimumMinutes: 140, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '晚低优', taskType: '打游戏', desiredMinutes: 30, minimumMinutes: 15, importance: 2, executionContext: CONTEXTS.HOME, splittable: true, minSegmentMinutes: 15 }),
      task({ taskName: '工作弹性', taskType: '编码工作', desiredMinutes: 200, minimumMinutes: 40, importance: 3 })
    ]
  });
  const mins = new Map();
  for (const s of scheduledSegments(result)) mins.set(s.taskName, (mins.get(s.taskName) ?? 0) + s.allocatedMinutes);
  assert.notEqual(result.status, 'conflict');
  assert.ok(mins.get('晚低优') >= 15);
});
```

- [ ] **Step 2: 运行确认失败** — `node --test tests/scheduler.test.js`,预期该用例报 `conflict`(现有行为)。
- [ ] **Step 3: 改实现** — `distributeCompression` 中把循环内 `return null;` 改为 `break;`,循环末尾改为:

```js
  const taken = pool.filter((item) => item.taken > 0);
  return taken.length > 0 ? taken : null;
```

- [ ] **Step 4: 运行确认通过** — 该用例 + 全套 `npm test` 绿。
- [ ] **Step 5: 提交** — `git commit -m "fix: converge window compression across rounds"`

---

### Task 2: 抽出 scheduleWindow 单窗口调度核心(纯重构)

**Files:**
- Modify: `src/scheduler.js`

**Interfaces:**
- Produces: `scheduleWindow({ tasks, blocks, planDate, now })` → `{ scheduled, unscheduled, failure, allocations, compression }`。`failure` 非空表示放不下某任务最小时长;`compression = Σ(effectiveDesired − 实际已排)`;失败时 `compression` 记为 `Infinity`。
- Consumes(现有): `allocateDurations` / `attemptPlacement` / `competingDonors` / `distributeCompression` / `withAllocationCaps` / `placementComparator` / `isUserFixed` / `totalMinutes`。

- [ ] **Step 1: 实现 scheduleWindow**(把 `scheduleDay` 现有的 while 循环整体搬进来,作用域改为传入的单窗口 `tasks`/`blocks`):

```js
function scheduleWindow({ tasks, blocks, planDate, now }) {
  const capacity = totalMinutes(blocks);
  const ordered = [...tasks].sort(placementComparator(now));
  const fixedTasks = ordered.filter((task) => task.fixed && task.fixedStart && task.fixedEnd);
  const flexibleTasks = ordered.filter((task) => !fixedTasks.includes(task));
  const compressionCaps = new Map();
  let allocations = null;
  let attempt = null;

  while (true) {
    allocations = withAllocationCaps(allocateDurations(tasks, capacity, now), compressionCaps);
    attempt = attemptPlacement({ fixedTasks, flexibleTasks, allocations, available: blocks, planDate, now });

    if (!attempt.failure) {
      break;
    }

    const failedTask = attempt.failure.task;
    const deficit = failedTask.effectiveMinimumMinutes - attempt.failure.scheduledMinutes;
    const compression = isUserFixed(failedTask)
      ? null
      : distributeCompression(
          deficit,
          competingDonors(failedTask, tasks, allocations, blocks, attempt.scheduled),
          now
        );

    if (!compression) {
      return {
        scheduled: attempt.scheduled,
        unscheduled: attempt.unscheduled,
        failure: attempt.failure,
        allocations,
        compression: Infinity
      };
    }

    for (const item of compression) {
      const current = allocations.get(item.task.taskId) ?? item.task.effectiveMinimumMinutes;
      compressionCaps.set(item.task.taskId, current - item.taken);
    }
  }

  const placedByTask = new Map();
  for (const segment of attempt.scheduled) {
    placedByTask.set(segment.taskId, (placedByTask.get(segment.taskId) ?? 0) + segment.allocatedMinutes);
  }
  const compression = tasks.reduce((sum, task) => (
    sum + Math.max(0, task.effectiveDesiredMinutes - (placedByTask.get(task.taskId) ?? 0))
  ), 0);

  return { scheduled: attempt.scheduled, unscheduled: attempt.unscheduled, failure: null, allocations, compression };
}
```

- [ ] **Step 2: 运行全套测试确认无回归** — `scheduleDay` 尚未改用它,但函数应无语法错误。`npm test` 绿。
- [ ] **Step 3: 提交** — `git commit -m "refactor: extract scheduleWindow core"`

---

### Task 3: 窗口划分与任务分类辅助函数

**Files:**
- Modify: `src/scheduler.js`

**Interfaces:**
- Produces:
  - `partitionWindows(blocks)` → `Map<context, blocks[]>`(保序:按块首次出现的 context 顺序)。
  - `fixedWindowContext(task, windowsMap, planDate, now)` → 固定时段所在窗口的 context,找不到返回 `null`。
  - `classifyWindowTasks(schedulable, windowsMap, planDate, now)` → `{ fixedByWindow, dedicatedByWindow, floating }`,其中 `floating = [{ task, candidates: context[] }]`。

- [ ] **Step 1: 实现三个纯函数**

```js
function partitionWindows(blocks) {
  const byContext = new Map();
  for (const block of blocks) {
    if (!byContext.has(block.context)) {
      byContext.set(block.context, []);
    }
    byContext.get(block.context).push(block);
  }
  return byContext;
}

function fixedWindowContext(task, windowsMap, planDate, now) {
  const interval = fixedFutureInterval(task, planDate, now);
  if (!interval) {
    return null;
  }
  for (const [context, blocks] of windowsMap) {
    if (blocks.some((block) => block.start <= interval.start && block.end >= interval.end)) {
      return context;
    }
  }
  return null;
}

function classifyWindowTasks(schedulable, windowsMap, planDate, now) {
  const contexts = [...windowsMap.keys()];
  const fixedByWindow = new Map(contexts.map((context) => [context, []]));
  const dedicatedByWindow = new Map(contexts.map((context) => [context, []]));
  const floating = [];

  for (const task of schedulable) {
    if (task.fixed && task.fixedStart && task.fixedEnd) {
      const compat = contexts.filter((context) => contextCompatible(task, { context }));
      const context = fixedWindowContext(task, windowsMap, planDate, now)
        ?? compat[0]
        ?? contexts[0];
      fixedByWindow.get(context)?.push(task);
      continue;
    }

    const candidates = contexts.filter((context) => contextCompatible(task, { context }));
    if (candidates.length <= 1) {
      const context = candidates[0] ?? contexts[0];
      dedicatedByWindow.get(context)?.push(task);
    } else {
      floating.push({ task, candidates });
    }
  }

  return { fixedByWindow, dedicatedByWindow, floating };
}
```

- [ ] **Step 2: 写单元测试** — 验证工作任务/下班后任务判为 dedicated、any 任务判为 floating(两候选)、固定任务按时段归窗口。(用 `scheduleDay` 内部不导出的函数不便直测 → 通过 Task 5 的集成测试覆盖;此步可跳过独立测试,标注由集成测试覆盖。)
- [ ] **Step 3: 运行全套测试确认无回归** — `npm test` 绿(新函数未被调用)。
- [ ] **Step 4: 提交** — `git commit -m "feat: add window partition and task classification"`

---

### Task 4: 浮动任务择优(路线甲枚举 + 路线乙贪心)+ 择优比较

**Files:**
- Modify: `src/scheduler.js`

**Interfaces:**
- Produces:
  - `FLOATING_ENUMERATION_LIMIT = 8`
  - `evaluateAssignment(assignment, ctx)` → `{ perWindow: Map<context,windowResult>, conflicts: failure[], totalCompression }`,`assignment` 为 `Map<context, task[]>`(仅浮动任务)。`ctx` 打包 `{ fixedByWindow, dedicatedByWindow, windowsMap, planDate, now }`。
  - `betterEvaluation(a, b)` → 更优者(冲突少 → 总压缩小 → 先到者)。
  - `selectBestAssignment(ctx, floating)` → 最优 `evaluation`。

- [ ] **Step 1: 实现评估与择优**

```js
const FLOATING_ENUMERATION_LIMIT = 8;

function evaluateAssignment(assignment, ctx) {
  const perWindow = new Map();
  for (const [context, blocks] of ctx.windowsMap) {
    const tasks = [
      ...ctx.fixedByWindow.get(context),
      ...ctx.dedicatedByWindow.get(context),
      ...(assignment.get(context) ?? [])
    ];
    perWindow.set(context, scheduleWindow({ tasks, blocks, planDate: ctx.planDate, now: ctx.now }));
  }
  const conflicts = [...perWindow.values()].filter((w) => w.failure).map((w) => w.failure);
  const totalCompression = [...perWindow.values()].reduce((sum, w) => (
    sum + (w.failure ? 0 : w.compression)
  ), 0);
  return { perWindow, conflicts, totalCompression };
}

function betterEvaluation(current, candidate) {
  if (!current) {
    return candidate;
  }
  if (candidate.conflicts.length !== current.conflicts.length) {
    return candidate.conflicts.length < current.conflicts.length ? candidate : current;
  }
  if (candidate.totalCompression !== current.totalCompression) {
    return candidate.totalCompression < current.totalCompression ? candidate : current;
  }
  return current;
}

function assignmentFromIndices(floating, indices) {
  const assignment = new Map();
  floating.forEach((item, k) => {
    const context = item.candidates[indices[k]];
    assignment.set(context, [...(assignment.get(context) ?? []), item.task]);
  });
  return assignment;
}

function bruteForceBest(ctx, floating) {
  const total = floating.reduce((product, item) => product * item.candidates.length, 1);
  let best = null;
  for (let i = 0; i < total; i += 1) {
    let n = i;
    const indices = floating.map((item) => {
      const idx = n % item.candidates.length;
      n = Math.floor(n / item.candidates.length);
      return idx;
    });
    best = betterEvaluation(best, evaluateAssignment(assignmentFromIndices(floating, indices), ctx));
  }
  return best;
}

function greedyBest(ctx, floating) {
  const sorted = [...floating].sort((a, b) => (
    calculatePriority(b.task, ctx.now) - calculatePriority(a.task, ctx.now)
      || a.task.taskName.localeCompare(b.task.taskName)
  ));
  const assignment = new Map();
  for (const item of sorted) {
    let bestContext = item.candidates[0];
    let bestEval = null;
    for (const context of item.candidates) {
      const trial = new Map(assignment);
      trial.set(context, [...(assignment.get(context) ?? []), item.task]);
      const ev = evaluateAssignment(trial, ctx);
      if (betterEvaluation(bestEval, ev) === ev) {
        bestEval = ev;
        bestContext = context;
      }
    }
    assignment.set(bestContext, [...(assignment.get(bestContext) ?? []), item.task]);
  }
  return evaluateAssignment(assignment, ctx);
}

function selectBestAssignment(ctx, floating) {
  if (floating.length === 0) {
    return evaluateAssignment(new Map(), ctx);
  }
  return floating.length <= FLOATING_ENUMERATION_LIMIT
    ? bruteForceBest(ctx, floating)
    : greedyBest(ctx, floating);
}
```

- [ ] **Step 2: 运行全套测试确认无回归** — 新函数未被 `scheduleDay` 调用。`npm test` 绿。
- [ ] **Step 3: 提交** — `git commit -m "feat: add floating task assignment selection"`

---

### Task 5: scheduleDay 改用窗口编排

**Files:**
- Modify: `src/scheduler.js`(`scheduleDay` 主流程 736–804 行区间)
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Consumes: `partitionWindows` / `classifyWindowTasks` / `selectBestAssignment` / `scheduleWindow`。
- 返回结构不变(`status` / `segments` / `unscheduled` / `durationPlan` / `conflict`)。

- [ ] **Step 1: 写集成测试(用户精确场景 + 隔离性 + 任意任务择优)**

```js
test('context windows are isolated so extending a work task does not starve evening tasks', () => {
  const eveningTask = (over) => task({ executionContext: CONTEXTS.HOME, ...over });
  const base = {
    planDate: PLAN_DATE,
    availableBlocks: [block('10:15', '16:30', CONTEXTS.WORK), block('17:20', '23:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      task({ taskName: '晨读1', taskType: '复杂教程和学习', desiredMinutes: 80, minimumMinutes: 50, importance: 3 }),
      task({ taskName: '晨读2', taskType: '复杂教程和学习', desiredMinutes: 60, minimumMinutes: 40, importance: 3 }),
      eveningTask({ taskName: '吃饭', taskType: '生活杂务', desiredMinutes: 60, minimumMinutes: 60, importance: 3 }),
      eveningTask({ taskName: '莉莉安娜', taskType: '绘画委托副业', desiredMinutes: 90, minimumMinutes: 60, importance: 5 }),
      eveningTask({ taskName: '健身', taskType: '运动健身', desiredMinutes: 140, minimumMinutes: 140, importance: 3 }),
      eveningTask({ taskName: '卷子', taskType: '复杂教程和学习', desiredMinutes: 40, minimumMinutes: 40, importance: 3 }),
      eveningTask({ taskName: '开车', taskType: '打游戏', desiredMinutes: 30, minimumMinutes: 15, importance: 2 })
    ]
  };
  const early = scheduleDay({ ...base, now: `${PLAN_DATE}T09:00:00` });
  const late = scheduleDay({ ...base, now: `${PLAN_DATE}T11:45:00` });
  const drive = (r) => scheduledSegments(r).filter((s) => s.taskName === '开车').reduce((a, s) => a + s.allocatedMinutes, 0);
  assert.notEqual(early.status, 'conflict');
  assert.notEqual(late.status, 'conflict');
  assert.ok(drive(early) >= 15);
  assert.ok(drive(late) >= 15);
});

test('any-context task lands in the window with less total compression', () => {
  const result = scheduleDay({
    planDate: PLAN_DATE,
    now: NOW,
    // work window roomy, home window tight
    availableBlocks: [block('09:00', '13:00', CONTEXTS.WORK), block('18:00', '20:00', CONTEXTS.HOME)],
    protectedBlocks: [],
    tasks: [
      task({ taskName: '晚满', taskType: '运动健身', desiredMinutes: 120, minimumMinutes: 120, importance: 3, executionContext: CONTEXTS.HOME }),
      task({ taskName: '灵活阅读', taskType: '复杂教程和学习', desiredMinutes: 90, minimumMinutes: 30, importance: 4, executionContext: CONTEXTS.ANY })
    ]
  });
  const readingStart = scheduledSegments(result).find((s) => s.taskName === '灵活阅读')?.start ?? '';
  assert.notEqual(result.status, 'conflict');
  assert.ok(readingStart < `${PLAN_DATE}T18:00:00`); // placed in the roomy work window
});
```

- [ ] **Step 2: 运行确认失败** — 隔离性/择优用例在旧全局逻辑下可能失败(晚窗口被撑或阅读被塞进晚窗口)。`node --test tests/scheduler.test.js`。
- [ ] **Step 3: 改 scheduleDay 主流程**(替换 729–804 行的 `schedulableTasks` 之后逻辑):

```js
  const schedulableTasks = active.filter((task) => (
    task.effectiveDesiredMinutes > 0 || fixedFutureInterval(task, planDate, schedulingNow)
  ));

  const windowsMap = partitionWindows(available);

  if (windowsMap.size === 0) {
    return {
      status: 'ok',
      planDate,
      segments: sortSegments(completed),
      unscheduled: [],
      durationPlan: withPlacedActualDurations(
        durationPlanSummary(schedulableTasks, new Map(), availableMinutes),
        []
      )
    };
  }

  const { fixedByWindow, dedicatedByWindow, floating } = classifyWindowTasks(
    schedulableTasks, windowsMap, planDate, schedulingNow
  );
  const best = selectBestAssignment(
    { fixedByWindow, dedicatedByWindow, windowsMap, planDate, now: schedulingNow },
    floating
  );

  if (best.conflicts.length > 0) {
    const failure = best.conflicts[0];
    return conflictResult(planDate, completed, availableMinutes, requiredMinimumMinutes,
      placementFailure(failure.task, failure.scheduledMinutes, failure.plannedMinutes, failure.candidateBlocks));
  }

  const windowResults = [...best.perWindow.values()];
  const scheduled = windowResults.flatMap((w) => w.scheduled);
  const unscheduled = windowResults.flatMap((w) => w.unscheduled);
  const mergedAllocations = new Map();
  for (const w of windowResults) {
    for (const [taskId, minutes] of w.allocations) {
      mergedAllocations.set(taskId, minutes);
    }
  }
  const durationPlan = durationPlanSummary(schedulableTasks, mergedAllocations, availableMinutes);

  return {
    status: unscheduled.length > 0 ? 'partial' : 'ok',
    planDate,
    segments: sortSegments([...completed, ...scheduled]),
    unscheduled,
    durationPlan: withPlacedActualDurations(durationPlan, scheduled)
  };
}
```

删除 736–794 行原来的 `orderedTasks`/`fixedTasks`/`flexibleTasks`/`compressionCaps`/while 循环(已被 `scheduleWindow` 取代)。

- [ ] **Step 4: 运行确认通过** — 新集成测试 + `npm test` 全绿。
- [ ] **Step 5: 提交** — `git commit -m "feat: schedule per context window with floating task selection"`

---

### Task 6: 文档更新与最终校验

**Files:**
- Modify: `README.md`(调度流程第 6 条附近,补充"按场景窗口隔离 + 任意任务择优")

- [ ] **Step 1: 更新 README** 调度流程说明,加入窗口隔离与浮动任务择优两段。
- [ ] **Step 2: 全套测试** — `npm test` 全绿。
- [ ] **Step 3: 提交** — `git commit -m "docs: document context-window scheduling"`

---

## Self-Review

- **Spec coverage:** 窗口划分(T3)、窗口内隔离调度(T2)、浮动择优路线甲+乙(T4)、scheduleDay 编排(T5)、压缩收敛修复(T1)、冲突输出不变(T5 沿用 `placementFailure`)、文档(T6)、测试策略(T1/T5)。全覆盖。
- **Placeholder scan:** 无 TODO/TBD;代码步骤均给出完整代码。
- **Type consistency:** `scheduleWindow` 返回 `{scheduled,unscheduled,failure,allocations,compression}` 在 T2 定义、T4 `evaluateAssignment` 消费一致;`evaluation` 的 `{perWindow,conflicts,totalCompression}` 在 T4 定义、T5 消费一致;`floating=[{task,candidates}]` 在 T3 产出、T4 消费一致。
