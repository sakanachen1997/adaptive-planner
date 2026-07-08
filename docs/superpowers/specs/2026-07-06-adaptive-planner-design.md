# Adaptive Planner Design

Date: 2026-07-06

## Goal

Build a functional Chinese-language time management system in a new dedicated folder, intended for deployment on GitHub Pages. The application helps the user plan one day at a time by resizing and rearranging tasks according to available time, priority, deadlines, energy demand, circadian fit, fixed calendar events, and minimum duration constraints.

The first version targets practical use over visual polish. It must work across home and company computers without transferring local files between them. Google Calendar is the synchronization and storage layer.

## Chosen Approach

Use a pure frontend application hosted on GitHub Pages.

- The user opens the same hosted page from any computer.
- The user configures a Google OAuth Client ID in the app.
- The app uses Google Identity Services in the browser.
- The app reads and writes events in the user's primary Google Calendar through the Calendar API.
- Plan task metadata is stored as JSON inside the Google Calendar event description.
- There is no backend, database, server-side secret, file sync, or account system in the first version.

## Security Model

The application uses browser-based OAuth.

- The app stores only the public Google OAuth Client ID.
- No Google OAuth client secret is used or stored.
- Access tokens are kept in memory only and are not saved to localStorage.
- The OAuth scope is `https://www.googleapis.com/auth/calendar.events`.
- The app may read calendar events so existing ordinary events can be treated as unavailable time.
- The app may create, update, and delete only events containing valid Plan metadata.
- Events without valid Plan metadata are protected ordinary calendar events. They can block time, but the app must not modify or delete them.

The user accepts that personal planning information, including task names and task metadata, is stored in Google Calendar event titles and descriptions.

## Google Calendar Data Model

Plan-managed events use a recognizable title prefix and embedded JSON metadata.

Example title:

```text
[Plan] 学英语
```

Example description:

```text
由 Adaptive Planner 创建。

<!-- PLAN_META
{
  "schemaVersion": 1,
  "app": "adaptive-planner",
  "planDate": "2026-07-06",
  "taskId": "task_abc123",
  "segmentId": "segment_001",
  "status": "scheduled",
  "taskName": "学英语",
  "taskType": "复杂学习",
  "desiredMinutes": 200,
  "minimumMinutes": 60,
  "importance": 4,
  "deadline": null,
  "energyDemand": "medium",
  "executionContext": "any",
  "splittable": true,
  "minSegmentMinutes": 25,
  "fixed": false,
  "actualStart": null,
  "actualEnd": null,
  "weekPlanId": null
}
PLAN_META -->
```

The metadata is the source of truth for task attributes. The event start and end time in Google Calendar are the source of truth for the current planned or completed time block.

If the user manually drags or edits a Plan event in Google Calendar, the app trusts the current Google Calendar event time when it next loads.

## Scope

### In Scope

- A new dedicated project folder: `adaptive-planner`.
- Chinese UI.
- GitHub Pages compatible static frontend.
- Google OAuth Client ID configuration screen.
- Google Calendar connection and primary calendar event sync.
- Day plan view with date switching.
- Manual available time blocks with context labels.
- Default workday/home-time rules that can be overridden per day.
- Task creation, editing, deletion, completion, and rescheduling.
- Automatic actual-duration allocation under hard minimum-duration constraints.
- Automatic schedule generation using priority, urgency, desired duration, energy demand, circadian fit, execution context, splittability, and fixed time blocks.
- Conflict reporting with concrete recovery actions.
- Completed tasks are preserved as actual time records.
- Basic local settings storage for non-task preferences.
- Data structures prepared for a future weekly planning layer.

### Out of Scope

- Full weekly planning or automatic multi-day rollover.
- Backend services.
- User accounts outside Google OAuth.
- Database storage outside Google Calendar.
- Polished visual design.
- Advanced mobile layout.
- Team collaboration.
- Company-sensitive task handling beyond the user's accepted personal-use model.

## User Concepts

### Available Time Block

An available time block defines when the user is willing to schedule Plan tasks. The user can enter explicit blocks, and the app can generate default blocks from settings.

Each block has:

- Start time.
- End time.
- Context: `工作时间`, `下班后`, or `任意时间`.

Existing ordinary Google Calendar events are treated as fixed unavailable blocks and are subtracted from available time.

### Task

Each task has:

- Task name.
- Task type.
- Desired duration in minutes. This is a planning weight and ideal target, not a guaranteed scheduled duration.
- Minimum duration in minutes. This is a hard lower bound.
- Importance from 1 to 5.
- Optional deadline.
- Execution context: `任意时间`, `仅工作时间`, `仅下班后`, or custom time window.
- Fixed time setting and optional fixed start/end.
- Optional overrides for energy demand, splittability, and minimum segment length.

Task types provide defaults:

| Type | Cognitive Load | Physical Load | Splittability | Default Segment | Preferred Time | Scheduling Bias |
| --- | --- | --- | --- | --- | --- | --- |
| 编码工作 | High | Low | Low | 45 min | Morning high-energy blocks | Prefer long continuous blocks |
| 复杂教程和学习 | High | Low | Medium | 25 min | Morning and early afternoon | Prefer high-energy blocks |
| 背单词 | Medium-low | Low | High | 10 min | Fragmented or medium/low-energy blocks | Fill small gaps |
| 打游戏 | Low | Low | Medium | 30 min | Evening | Low priority unless explicitly important |
| 运动健身 | Medium | High | Low | 30 min | Afternoon/evening | Avoid too-late scheduling |
| 绘画委托副业 | Medium-high | Low | Medium-low | 30 min | High-energy or creative blocks | Deadline and external commitment matter |
| 生活杂务 | Low | Variable | Medium | 15 min | Low-energy blocks | Fill practical gaps |
| 自定义 | Medium | Low | Medium | 20 min | Any compatible block | User overrides decide |

The defaults are editable globally and overridable per task.

## Priority Model

The final priority is calculated by the app rather than directly entered by the user.

Inputs:

- User importance.
- Desired duration.
- Deadline urgency.
- Task type.
- External commitment implied by task type.
- Energy demand.
- Execution context.
- Splittability.
- Minimum duration.
- Circadian fit for each candidate time slot.

High-level scoring:

- Importance contributes the largest stable value signal.
- Deadline urgency increases as the deadline approaches.
- Desired duration contributes planning weight but does not dominate alone.
- Work tasks and commissioned work receive external-commitment weight.
- A task receives a placement bonus when its energy demand matches the time slot.
- Low-friction splittable tasks receive a gap-filling bonus for short compatible gaps.

The exact formula can be tuned during implementation, but it must stay explainable in the UI. The app should show why a task was placed or why it failed.

## Circadian Energy Model

The first version uses a fixed default energy curve:

- Morning: best for high-cognitive tasks.
- Early afternoon: medium energy, suitable for learning or lower-intensity work.
- Afternoon slump: better for low/medium cognitive tasks and small fragments.
- Evening: suitable for exercise, games, light tasks, or creative work depending on context.

The first version does not require the user to manually define a custom energy curve, but the model should be isolated so custom curves can be added later.

## Scheduling Rules

1. Load the selected day.
2. Read primary Google Calendar events for the day.
3. Split events into protected ordinary events and Plan-managed events.
4. Build available time windows from user blocks/default blocks.
5. Subtract protected ordinary events from available time.
6. Place fixed Plan tasks first.
7. Put incomplete, missed, and newly added tasks into the unscheduled task pool.
8. Preserve completed tasks at their actual completed times.
9. For an in-progress task, preserve elapsed time before the current time and reschedule only the remaining portion from the current time onward.
10. Calculate available capacity after fixed events and protected ordinary events.
11. Check hard minimum durations.
12. If minimum durations cannot fit, stop and show a conflict panel.
13. Compute an actual duration for every schedulable task.
14. Place tasks into compatible time blocks using context, energy fit, fixed constraints, splittability, and minimum segment length.
15. Insert 5-10 minute buffers between high/medium cognitive tasks by default.
16. Buffer blocks are internal gaps by default and are not written to Google Calendar unless the user enables that setting.
17. Show a sync preview before writing changes to Google Calendar.
18. Create/update/delete only Plan-managed events needed to match the accepted schedule.

## Actual Duration Behavior

The `调度` button is the normal scheduling action. Pressing it recomputes both task order and actual task duration.

Desired duration is an input to priority and allocation. It is not a commitment that must fit in the day.

Actual duration is computed as follows:

1. Reserve every active task's minimum duration.
2. If the sum of minimum durations is greater than available time, report a conflict.
3. Treat tasks whose minimum duration equals desired duration as incompressible.
4. Distribute remaining time across flexible tasks using desired-minus-minimum slack, importance, deadline urgency, task type, and other priority signals.
5. Use the computed actual duration for schedule placement.

The day plan should always show each task's desired duration, minimum duration, and actual duration.

Example:

- A: incompressible, 70 minutes.
- B: desired 180 minutes, minimum 120 minutes.
- C: desired 30 minutes, minimum 10 minutes.
- D: desired 40 minutes, minimum 20 minutes.
- E: incompressible, 30 minutes.

If available time is lower than the ideal total but higher than the minimum total, A and E keep their fixed durations while B/C/D receive computed actual durations.

## Conflict Handling

When constraints cannot be satisfied, the app shows a red conflict state and offers exactly these recovery actions:

1. Increase available time and reschedule.
2. Lower some tasks' minimum durations and reschedule.
3. Delete or skip low-priority tasks and reschedule.

The app should provide enough context for the user to make the decision:

- Total available minutes.
- Total required minimum minutes.
- Which fixed or protected blocks consume time.
- Which tasks cause the conflict.
- Which tasks are low-priority candidates for skipping.

## Task Completion

The app has a completion button for each active Plan task.

Default completion behavior:

- Actual start defaults to the event's current start time.
- Actual end defaults to the current time.
- The user can edit actual start/end before or after completing.
- Completion updates the Google Calendar event to the actual time range.
- Metadata status becomes `completed`.
- Completed tasks are not rescheduled.

If completion causes later planned tasks to conflict with available time, the affected future tasks are shown in red. The user can manually adjust or ask the app to recalculate from the current time.

## Missed and In-Progress Tasks

If a task's planned time is in the past and it is still incomplete, the app automatically returns it to the unfinished task pool when rescheduling from the current time.

If a task is currently in progress and rescheduling occurs:

- Time before the current time is treated as already consumed.
- The remaining portion participates in the new allocation from the current time onward.

## Google Calendar Sync Rules

The app must never modify ordinary events.

An event is Plan-managed only if:

- It contains a valid `PLAN_META` block.
- The metadata `app` field equals `adaptive-planner`.
- The schema version is supported.
- The metadata parses as valid JSON.

Sync operations:

- Create new Plan events for new schedule segments.
- Update existing Plan events for changed schedule segments.
- Mark completed events as completed with actual time.
- Delete or cancel only Plan events that the user explicitly deletes/skips or that are obsolete generated segments.
- Do not modify ordinary events, invited meetings, or events missing valid metadata.

Before sync, the app shows a preview of planned creates, updates, and deletes.

## Local Settings

Task data lives in Google Calendar. Local settings can live in browser localStorage because they are preferences rather than the cross-computer source of truth.

Local settings include:

- Google OAuth Client ID.
- Default work/home time rules.
- Whether buffer blocks are written to Google Calendar.
- Task type default overrides.
- Last selected date.

If settings are missing on a new computer, the app can still read Plan tasks from Google Calendar after OAuth is configured, but local preferences must be re-entered unless a future export/import feature is added.

## Weekly Planning Extension Point

The first version is day-plan only. However, metadata includes optional fields such as `weekPlanId` and `planDate` so future weekly planning can group daily plans, roll over unfinished tasks, and allocate work across several days.

No first-version behavior depends on weekly planning.

## Application Structure

The implementation should keep boundaries clear:

- `calendarClient`: Google Identity Services and Calendar API calls.
- `metadata`: parse, validate, and serialize `PLAN_META`.
- `models`: task, time block, event, schedule segment, settings types.
- `scheduler`: pure scheduling and conflict detection logic.
- `priority`: priority and placement scoring.
- `storage`: local settings persistence.
- `ui`: forms, day plan view, conflict panel, sync preview, completion controls.

The scheduler should be testable without Google Calendar or browser UI.

## Testing Strategy

Manual browser testing is required because Google OAuth is involved.

Automated tests should cover pure logic:

- Metadata parsing rejects invalid or foreign events.
- Ordinary events are protected.
- Existing events subtract from available time.
- Minimum duration conflicts are detected.
- Actual durations are computed from desired duration, minimum duration, priority, urgency, and available capacity.
- Fixed tasks occupy time before flexible tasks.
- Context constraints prevent work-only tasks from being placed after work and home-only tasks from being placed during work.
- Splittable tasks can fill short gaps while non-splittable tasks cannot.
- Completed tasks are excluded from rescheduling.
- Missed incomplete tasks return to the task pool.
- In-progress tasks preserve elapsed time and reschedule remaining time.

## Acceptance Criteria

- The project exists in a dedicated `adaptive-planner` folder.
- The app runs locally as a static frontend and can be deployed to GitHub Pages.
- The UI is in Chinese.
- The user can configure OAuth Client ID and connect to Google Calendar.
- The app reads primary calendar events for a selected day.
- Ordinary events block time and are never modified.
- The user can create tasks with the agreed fields.
- The app produces a same-day schedule respecting fixed events, contexts, minimum durations, and task type defaults.
- The app detects impossible schedules and offers only the three agreed recovery actions.
- The app writes Plan tasks to Google Calendar with `PLAN_META` JSON.
- The user can complete a task and record actual start/end.
- Recalculation affects only unfinished work from the current time onward.
- The code structure leaves a clear extension point for weekly planning.
