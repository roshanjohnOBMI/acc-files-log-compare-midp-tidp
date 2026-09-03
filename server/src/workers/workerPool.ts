import os from "node:os";
import { Worker } from "node:worker_threads";
import { logEntry } from "../services/errorLog.service.js";
import type { LogSeverity } from "../types/domain.js";
import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  WorkerTaskName,
  WorkerTaskPayloadMap,
  WorkerTaskResultMap,
} from "./tasks.js";

// `.js` here (not `.ts`) matches every other same-project import in this codebase (NodeNext
// resolution: the specifier names the emitted file, and tsx's dev-mode loader resolves it back to
// the sibling .ts source) - see taskWorker.ts, which sits right next to this file either way.
const WORKER_ENTRY = new URL("./taskWorker.js", import.meta.url);

// One background thread per spare CPU core, capped - this is a modest internal tool used by a
// handful of people at once, not a high-concurrency service, so more threads than real cores
// bought back nothing but scheduling overhead. Always at least 1, for a single-core host.
const POOL_SIZE = Math.max(1, Math.min(4, os.cpus().length - 1));

interface PendingTask {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface QueuedTask {
  id: number;
  task: WorkerTaskName;
  payload: unknown;
}

interface PoolSlot {
  worker: Worker;
  /** The task id currently running on this worker, if any - used to fail that one task (rather
   * than every in-flight task across the whole pool) if the worker crashes. */
  currentTaskId: number | null;
}

let nextTaskId = 1;
const pending = new Map<number, PendingTask>();
const queue: QueuedTask[] = [];
const slots: PoolSlot[] = [];
let shuttingDown = false;

function spawnSlot(): PoolSlot {
  const worker = new Worker(WORKER_ENTRY, {
    // Belt-and-suspenders: Node already inherits execArgv into new Worker threads by default, but
    // passing it explicitly means a dev-mode TypeScript loader (tsx) keeps working here too even
    // if some future Node/tsx version changes that default.
    execArgv: process.execArgv,
  });
  const slot: PoolSlot = { worker, currentTaskId: null };

  worker.on("message", (message: WorkerResponseMessage) => {
    if (message.__log) {
      // A logEntry() call forwarded from inside the worker (see errorLog.service.ts) - re-run it
      // for real, on the main thread, which is the only thread anything ever reads it back from.
      logEntry(message.stage, message.severity as LogSeverity, message.message, message.context);
      return;
    }

    slot.currentTaskId = null;
    const task = pending.get(message.id);
    if (task) {
      pending.delete(message.id);
      if (message.ok) task.resolve(message.result);
      else task.reject(new Error(message.error));
    }
    dispatch(slot);
  });

  worker.on("error", (err) => {
    // Whatever this worker was running is unrecoverable - fail just that one task, then replace
    // the worker so the pool's overall capacity doesn't shrink every time one thread has a bad day.
    if (slot.currentTaskId !== null) {
      const task = pending.get(slot.currentTaskId);
      pending.delete(slot.currentTaskId);
      task?.reject(err instanceof Error ? err : new Error(String(err)));
    }
    logEntry("worker-pool", "error", `Worker thread error: ${err.message}`);
    replaceSlot(slot);
  });

  worker.on("exit", (code) => {
    if (shuttingDown) return;
    if (code !== 0 && slot.currentTaskId !== null) {
      const task = pending.get(slot.currentTaskId);
      pending.delete(slot.currentTaskId);
      task?.reject(new Error(`Worker thread exited unexpectedly (code ${code})`));
    }
    if (code !== 0) replaceSlot(slot);
  });

  // Idle pool threads shouldn't be the reason the process stays alive (e.g. under `tsx watch`,
  // or a plain `node dist/index.js` waiting only on the HTTP server to be told to stop).
  worker.unref();

  return slot;
}

function replaceSlot(slot: PoolSlot) {
  const index = slots.indexOf(slot);
  if (index === -1 || shuttingDown) return;
  slots[index] = spawnSlot();
  dispatch(slots[index]);
}

function dispatch(slot: PoolSlot) {
  if (slot.currentTaskId !== null || shuttingDown) return;
  const next = queue.shift();
  if (!next) return;
  slot.currentTaskId = next.id;
  // QueuedTask.payload is `unknown` because the queue holds every task type at once - the
  // task/payload pairing itself is guaranteed correct by construction, since the only way to add
  // to the queue is runTask<T>()'s own generic signature below, which enforces it per call.
  const message = { id: next.id, task: next.task, payload: next.payload } as WorkerRequestMessage;
  slot.worker.postMessage(message);
}

function ensurePool() {
  if (slots.length > 0) return;
  for (let i = 0; i < POOL_SIZE; i++) slots.push(spawnSlot());
}

/** Runs one CPU-heavy job (parsing a workbook, matching rows, building the QA/QC export) on a
 * worker thread instead of blocking the main thread's event loop - which would otherwise stall
 * every other request (and the Activity log's own polling) for however long that job takes. */
export function runTask<T extends WorkerTaskName>(
  task: T,
  payload: WorkerTaskPayloadMap[T]
): Promise<WorkerTaskResultMap[T]> {
  ensurePool();
  const id = nextTaskId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    queue.push({ id, task, payload });
    const idleSlot = slots.find((s) => s.currentTaskId === null);
    if (idleSlot) dispatch(idleSlot);
  });
}

/** Best-effort cleanup on process shutdown - lets every worker thread's own Node runtime tear
 * down instead of leaving it dangling until the parent process exits on its own. */
export async function shutdownWorkerPool(): Promise<void> {
  shuttingDown = true;
  await Promise.all(slots.map((slot) => slot.worker.terminate()));
  slots.length = 0;
}
