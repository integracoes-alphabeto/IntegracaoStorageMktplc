const crypto = require("crypto");

const TASK_TTL_MS = 30 * 60 * 1000;
const tasks = new Map();

function nowIso() {
  return new Date().toISOString();
}

function clampPercent(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}

function scheduleCleanup(taskId) {
  setTimeout(() => {
    tasks.delete(taskId);
  }, TASK_TTL_MS).unref?.();
}

function createTask(type = "generic", seed = {}) {
  const taskId = seed.id || crypto.randomUUID();
  const task = {
    id: taskId,
    type,
    status: "pending",
    percent: 0,
    stage: "",
    detail: "",
    totalItems: 0,
    completedItems: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    error: "",
    ...seed,
  };

  tasks.set(taskId, task);
  scheduleCleanup(taskId);

  return task;
}

function ensureTask(taskId, type = "generic", seed = {}) {
  if (!taskId) {
    return null;
  }

  if (!tasks.has(taskId)) {
    return createTask(type, {
      id: taskId,
      ...seed,
    });
  }

  const currentTask = tasks.get(taskId);

  if (type && currentTask.type !== type) {
    currentTask.type = type;
  }

  Object.assign(currentTask, seed, {
    updatedAt: nowIso(),
  });

  return currentTask;
}

function getTask(taskId) {
  return taskId ? tasks.get(taskId) || null : null;
}

function updateTask(taskId, updates = {}) {
  const task = ensureTask(taskId);

  if (!task) {
    return null;
  }

  if ("percent" in updates) {
    task.percent = clampPercent(updates.percent);
  }

  if ("stage" in updates) {
    task.stage = updates.stage || "";
  }

  if ("detail" in updates) {
    task.detail = updates.detail || "";
  }

  if ("completedItems" in updates) {
    task.completedItems = Number(updates.completedItems) || 0;
  }

  if ("totalItems" in updates) {
    task.totalItems = Number(updates.totalItems) || 0;
  }

  if ("status" in updates) {
    task.status = updates.status;
  }

  if ("error" in updates) {
    task.error = updates.error || "";
  }

  task.updatedAt = nowIso();

  return task;
}

function startTask(taskId, type, seed = {}) {
  const task = ensureTask(taskId, type, {
    status: "running",
    percent: 0,
    error: "",
    ...seed,
  });

  if (task) {
    task.updatedAt = nowIso();
  }

  return task;
}

function completeTask(taskId, updates = {}) {
  return updateTask(taskId, {
    status: "completed",
    percent: 100,
    ...updates,
  });
}

function failTask(taskId, error, updates = {}) {
  return updateTask(taskId, {
    status: "failed",
    error: error?.message || String(error || "Erro desconhecido."),
    ...updates,
  });
}

module.exports = {
  completeTask,
  createTask,
  ensureTask,
  failTask,
  getTask,
  startTask,
  updateTask,
};
