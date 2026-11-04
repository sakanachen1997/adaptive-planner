// Timeline reordering expressed as predecessor (前置任务) relations.
//
// Dropping a task block between two others means "after the block above,
// before the block below". That is recorded with the same dependencyTaskIds
// the task form edits, so the order is visible, editable, synced, and enforced
// by the scheduler like any other predecessor. Pure functions, no DOM.

function centerOf(segment) {
  return (segment.startMinute + segment.endMinute) / 2;
}

// segments: the scheduled (not completed) task segments on the timeline, as
// { taskId, startMinute, endMinute }. The dragged task's own segments are
// ignored. Returns the immediate neighbours of the drop position plus the
// tasks that now lie entirely before / after it.
export function dropNeighbors(segments, {
  taskId,
  dropStartMinute,
  durationMinutes,
  originalStartMinute = dropStartMinute
}) {
  const center = dropStartMinute + durationMinutes / 2;
  const movedUp = dropStartMinute < originalStartMinute;
  const others = segments
    .filter((segment) => segment.taskId !== taskId)
    .map((segment) => ({ taskId: segment.taskId, center: centerOf(segment) }))
    .sort((left, right) => left.center - right.center);
  const above = others.filter((segment) => segment.center < center);
  const below = others.filter((segment) => segment.center >= center);
  let predecessorId = above.at(-1)?.taskId ?? null;
  let successorId = below[0]?.taskId ?? null;

  // Dropped into the gap of a split task: a predecessor relation covers the
  // whole task, so pick the side the user moved towards.
  if (predecessorId && predecessorId === successorId) {
    const splitTaskId = predecessorId;
    if (movedUp) {
      predecessorId = above.filter((segment) => segment.taskId !== splitTaskId).at(-1)?.taskId ?? null;
    } else {
      successorId = below.find((segment) => segment.taskId !== splitTaskId)?.taskId ?? null;
    }
  }

  const aboveIds = new Set(above.map((segment) => segment.taskId));
  const belowIds = new Set(below.map((segment) => segment.taskId));
  const beforeIds = [...aboveIds].filter((id) => !belowIds.has(id) && id !== successorId);
  const afterIds = [...belowIds].filter((id) => !aboveIds.has(id) && id !== predecessorId);

  return { predecessorId, successorId, beforeIds, afterIds };
}

function closure(startId, nextIds) {
  const seen = new Set();
  const stack = startId ? [startId] : [];

  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    stack.push(...nextIds(id));
  }

  return seen;
}

function hasCycle(graph) {
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 'done') {
      return false;
    }
    if (state.get(id) === 'active') {
      return true;
    }
    state.set(id, 'active');
    for (const dependencyId of graph.get(id) ?? []) {
      if (graph.has(dependencyId) && visit(dependencyId)) {
        return true;
      }
    }
    state.set(id, 'done');
    return false;
  };

  return [...graph.keys()].some(visit);
}

function changedEntries(before, after) {
  const changes = new Map();
  for (const [id, deps] of after) {
    const previous = before.get(id) ?? [];
    if (previous.length !== deps.length || previous.some((dep, index) => dep !== deps[index])) {
      changes.set(id, deps);
    }
  }
  return changes;
}

// dependencies: Map taskId -> dependencyTaskIds. Returns { changes, error }
// where changes maps each task whose predecessor list changed to its new list.
// Only relations that contradict the new position are removed; everything
// else the user set up stays.
export function reorderDependencies(dependencies, {
  taskId,
  predecessorId = null,
  successorId = null,
  beforeIds = [],
  afterIds = []
}) {
  if (!predecessorId && !successorId) {
    return { changes: new Map(), error: 'no_neighbors' };
  }

  const graph = new Map([...dependencies].map(([id, deps]) => [id, [...(deps ?? [])]]));
  if (!graph.has(taskId)) {
    graph.set(taskId, []);
  }
  const dependents = (id) => [...graph].filter(([, deps]) => deps.includes(id)).map(([other]) => other);
  // Tasks that (transitively) wait for the successor must not be predecessors
  // of the moved task any more, and vice versa for the predecessor's own
  // predecessors.
  const afterSuccessor = closure(successorId, dependents);
  const beforePredecessor = closure(predecessorId, (id) => graph.get(id) ?? []);
  const after = new Set([...afterSuccessor, ...afterIds]);
  const before = new Set([...beforePredecessor, ...beforeIds]);

  after.delete(taskId);
  before.delete(taskId);

  const ownDeps = graph.get(taskId).filter((id) => !after.has(id));
  if (predecessorId && !ownDeps.includes(predecessorId)) {
    ownDeps.push(predecessorId);
  }
  graph.set(taskId, ownDeps);

  for (const [id, deps] of graph) {
    if (id !== taskId && before.has(id) && deps.includes(taskId)) {
      graph.set(id, deps.filter((dep) => dep !== taskId));
    }
  }

  if (successorId) {
    const successorDeps = graph.get(successorId) ?? [];
    if (!successorDeps.includes(taskId)) {
      graph.set(successorId, [...successorDeps, taskId]);
    }
  }

  if (hasCycle(graph)) {
    return { changes: new Map(), error: 'cycle' };
  }

  return { changes: changedEntries(dependencies, graph), error: null };
}

// When a task is deleted or skipped, tasks that waited for it inherit its own
// predecessors, so the remaining chain keeps its order instead of failing on
// a missing reference.
export function bridgeRemovedTask(dependencies, removedId) {
  const inherited = (dependencies.get(removedId) ?? []).filter((id) => id !== removedId);
  const changes = new Map();

  for (const [id, deps] of dependencies) {
    if (id === removedId || !(deps ?? []).includes(removedId)) {
      continue;
    }
    const next = [];
    for (const dep of deps) {
      for (const replacement of dep === removedId ? inherited : [dep]) {
        if (replacement !== id && !next.includes(replacement)) {
          next.push(replacement);
        }
      }
    }
    changes.set(id, next);
  }

  return changes;
}
