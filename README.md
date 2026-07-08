# Adaptive Planner

Adaptive Planner 是一个中文日程规划应用。它会根据当天可用时间、任务权重、最短执行时长、截止时间、任务类型、精力需求、工作或居家场景，以及 Google Calendar 中已有的固定事件，重新安排当天仍可调整的任务。

## 调度模型

页面中的 `调度` 按钮会重新计算当天计划。系统不会把“想要时长”当成必须满足的承诺，而是把它作为权重参数之一。

每次调度都会为任务计算实际时长：

- `想要时长`：参与优先级和弹性空间计算。
- `最小时长`：硬下限，实际时长不能低于它。
- `实际时长`：系统根据可用时间、重要性、deadline、任务类型、精力匹配和弹性空间计算出的排程时长。

调度流程（每次点击 `调度` 或增删改任务时执行）：

1. **构建可用时间**：取当天启用的可用时间块，减去普通 Google Calendar 事件（受保护，不可修改），再裁掉当前时刻之前的部分。
2. **任务分类**：已完成任务按实际时间原样保留；已跳过任务不参与；日历中状态为 scheduled 的 Plan 事件回读后按其当前日历时间视为固定任务。
3. **全局最小检查**：所有活动任务的最小时长之和大于可用时间总量时，报 `minimum_overflow` 冲突并停止。
4. **计算实际时长**：先为每个任务保留最小时长；剩余容量在弹性任务（想要 > 最小）之间按 `优先级 × 弹性空间` 加权分配，上限为想要时长。`最小 = 想要` 的任务不可压缩。
5. **放置固定任务**（按优先级从高到低）：固定任务的未来时段必须完整落在某个空闲块内，放置后从空闲块中扣除。
6. **放置弹性任务**（按优先级从高到低）：只考虑场景兼容的块（工作/下班后/任意）；候选块按精力匹配度评分排序。可拆分任务优先选能完整容纳的块，其次选拆分后剩余仍不小于最小分段的块，最后才允许留下无法放置的尾巴；不可拆分任务优先找能放下全部时长的块，否则放入能满足最小时长的最大块并截短。
7. **截止时间约束**：填写了截止时间的任务，其时段一律安排在截止时间之前；块内超出截止时间的部分不计入该任务的可用容量。
8. **冲突与部分完成**：某任务连最小时长都放不下时，报 `placement_failure` 冲突并指明该任务；仅超出部分放不下时，标记为部分完成并列出未安排的剩余分钟数。
9. **同步预览**：无冲突时生成对 Google Calendar 的创建/更新/删除操作预览，等待用户确认同步。

优先级公式：`重要性 × 10 + 紧迫度 × 6 + √想要时长 + 外部承诺 × 4`。紧迫度由截止时间距离决定（已过期 6，≤6 小时 5，≤24 小时 4，≤72 小时 2，更远 1，无截止 0）。

精力曲线（用于块评分）：8-12 点为高精力，12-14 点和 17-21 点为中精力，其余为低精力。任务的精力需求与时段精力越匹配，评分越高。

冲突面板会按优先级从低到高列出所有未完成任务，每个任务可直接 `编辑` 或 `删除并重排`。删除本地任务立即移除；删除已同步到日历的任务会先标记跳过，下次同步时删除对应日历事件。

## 本地运行

在项目根目录运行：

```bash
python -m http.server 5173
```

然后打开：

```text
http://localhost:5173
```

## 测试

运行：

```bash
npm test
```

## Google OAuth 设置

1. 打开 Google Cloud Console，并创建或选择一个项目。
2. 在该项目中启用 Google Calendar API。
3. 创建 OAuth Client，应用类型选择 Web application。
4. 在 Authorized JavaScript origins 中添加 GitHub Pages 来源，例如 `https://<user>.github.io`。
5. 本地测试时，在 Authorized JavaScript origins 中添加 `http://localhost:5173`。
6. 将生成的 OAuth Client ID 填入应用并保存。

应用使用的 Google Calendar scope 是：

```text
https://www.googleapis.com/auth/calendar.events
```

## 日历数据规则

- 普通 Google Calendar 事件没有 `PLAN_META`，应用只把它们视为受保护的不可用时间。
- 应用只会创建、更新、删除元数据有效的 `[Plan]` 事件。
- 计划任务属性保存在事件 description 的 JSON 中。
- 访问令牌只保存在浏览器内存中，不写入 `localStorage`。

## GitHub Pages 部署

1. 将代码推送到 GitHub 仓库。
2. 在仓库 Settings 中打开 Pages。
3. Source 选择要发布的分支，目录选择项目所在目录或根目录。
4. 保存 Pages 设置，等待 GitHub 生成站点地址。
5. 将生成的站点来源添加到 Google OAuth 的 Authorized JavaScript origins 中。
6. 使用 GitHub Pages 地址打开应用，并在应用中保存 OAuth Client ID。

## GitLab Pages 部署

项目已包含 `.gitlab-ci.yml`。推送到 GitLab 后，默认分支会自动执行：

1. 使用 Node.js 运行 `npm test`。
2. 将 `index.html` 和 `src/` 复制到 `public/`。
3. 通过 GitLab Pages 发布静态站点。

部署步骤：

1. 在 GitLab 创建一个仓库。
2. 将本项目推送到该仓库的默认分支。
3. 等待 GitLab CI/CD pipeline 完成。
4. 在 GitLab 项目中打开 Deploy -> Pages 查看站点地址。

普通项目的 Pages 地址通常是：

```text
https://<namespace>.gitlab.io/<project-name>/
```

如果你想使用根域名形式：

```text
https://<username>.gitlab.io/
```

GitLab 项目名需要是：

```text
<username>.gitlab.io
```

部署到 GitLab Pages 后，也要把对应 origin 加到 Google OAuth 的 Authorized JavaScript origins。普通项目示例：

```text
https://<namespace>.gitlab.io
```

注意这里只填写 origin，不包含 `/<project-name>/` 路径。

## 数据安全

任务名称可能会同步到 Google Calendar 事件中。涉及敏感公司项目、客户名称、内部代号或个人隐私时，建议避免填写真实名称，或先进行匿名化处理。
