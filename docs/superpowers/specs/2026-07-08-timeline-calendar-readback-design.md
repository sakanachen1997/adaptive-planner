# Timeline, Fixed-Time Duration, Calendar Readback Design

## Goal

Add four user-facing improvements to Adaptive Planner:

- Show the day plan as a visual timeline.
- Let fixed-time tasks omit desired/minimum duration and derive both from the fixed time range.
- Display tasks and protected ordinary events read from Google Calendar in the web page.
- Add a deadline shortcut that fills today's date.

The scope stays within same-day planning. No drag-and-drop editing is included in this feature.

## Timeline View

The current "当天计划" area becomes a two-column planning view.

Left column:

- A vertical time axis for the selected plan date.
- Blocks are placed by actual start/end time and scaled by duration.
- Plan task blocks are editable/selectable.
- Ordinary Google Calendar events appear as gray protected blocks.
- Completed task blocks are visually de-emphasized.
- Conflict or invalid blocks are highlighted in red.

Right column:

- Shows details for the selected timeline block.
- For Plan tasks, exposes the existing actions: edit, complete, delete/skip and reschedule context.
- For ordinary Calendar events, shows read-only summary, start/end time, and a protected/unavailable explanation.
- Keeps sync preview and conflict/unscheduled summaries visible near the detail area.

If no block is selected, the right column shows the current schedule summary and next actionable state.

## Fixed-Time Duration Behavior

If a task is marked fixed and has both `fixedStart` and `fixedEnd`, the fixed time range is authoritative for duration.

Rules:

- `desiredMinutes` and `minimumMinutes` are no longer required in the form for such a task.
- On save, both fields are computed from `fixedEnd - fixedStart`.
- If the user entered conflicting duration values, the fixed time range overwrites them.
- The computed duration must be positive. Zero or negative fixed ranges are rejected.
- Existing non-fixed tasks still require desired and minimum duration.
- Fixed-time duration calculation uses the selected plan date's local wall-clock time rules, matching the existing scheduler conventions.

Example:

- `fixedStart = 19:30`
- `fixedEnd = 21:20`
- Computed `desiredMinutes = 110`
- Computed `minimumMinutes = 110`

This keeps fixed tasks incompressible and prevents contradictions between their locked time block and duration fields.

## Google Calendar Readback Display

Clicking `读取日历` reads primary calendar events for the selected day.

Events split into two display classes:

- Plan-managed events: events with valid Adaptive Planner metadata. These become Plan tasks and are shown in the timeline and detail panel as editable Plan task blocks.
- Ordinary calendar events: events without valid Plan metadata. These become protected blocks and are shown in the timeline as gray read-only unavailable time.

Ordinary events are never modified or deleted by the app. They block available time and explain why some visible time cannot be scheduled.

Plan-managed events remain the cross-computer source of truth for task metadata. When the app reads them back, their current Google Calendar start/end time is preserved as the last planned block for timeline display, completion matching, and updating the same Calendar event. It does not make a task hard fixed unless the stored task metadata already says `fixed: true`.

## Deadline Today Shortcut

The deadline input gets a nearby `今日` button.

Button behavior:

- Uses the browser's local current date.
- If the deadline already has a time component, keep that time and replace only the date.
- If the deadline is empty, fill today's date with a conservative default time of `23:59`, because `datetime-local` requires both date and time to hold a valid value.
- The user can still edit the deadline manually after using the shortcut.

## Testing Requirements

Automated tests should cover:

- Timeline view exposes both Plan task blocks and protected Calendar blocks.
- Protected Calendar blocks render as read-only items.
- Calendar readback tasks appear in the page data used for rendering, not only in sync internals.
- Fixed tasks with both fixed times can be saved without desired/minimum input.
- Fixed time duration overwrites conflicting desired/minimum values.
- Invalid fixed ranges are rejected.
- Non-fixed tasks still require desired/minimum duration.
- Deadline `今日` helper preserves existing time and uses the browser's local current date.

## Out of Scope

- Drag-and-drop rescheduling in the timeline.
- Week planning.
- Writing ordinary Calendar events.
- Creating or editing Google Calendar events that were not created by Adaptive Planner.
