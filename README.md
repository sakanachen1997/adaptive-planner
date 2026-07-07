# Adaptive Planner

Adaptive Planner 是一个中文日程规划应用。它会根据当天可用时间、任务权重、最短执行时长、截止时间、任务类型、精力需求、工作或居家场景，以及 Google Calendar 中已有的固定事件，重新安排当天仍可调整的任务。

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
