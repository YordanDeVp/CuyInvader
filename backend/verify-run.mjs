import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
let active = 0;
const pending = new Map();
const completed = new Map();
export const VERIFICATION_TIMEOUT_MS = 30000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 100;

function failure(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

// CPU acotada y fuera del event loop de Express; no exige servicios de pago.
export function verifyRun(token, replay) {
  // Misma prueba + mismo ticket: los reintentos comparten el trabajo en curso.
  // El hash evita guardar tokens o registros completos en la caché.
  const key = createHash('sha256').update(token).update('\0').update(JSON.stringify(replay)).digest('hex');
  for (const [cachedKey, entry] of completed) if (entry.expiresAt <= Date.now()) completed.delete(cachedKey);
  if (completed.has(key)) return Promise.resolve(completed.get(key).result);
  if (pending.has(key)) return pending.get(key);
  if (active >= 2) return Promise.reject(failure('verification_busy'));
  active += 1;
  const promise = new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) { try { await worker.terminate(); } catch { /* El worker ya terminó. */ } }
      active -= 1;
      pending.delete(key);
      if (!error) {
        if (completed.size >= CACHE_LIMIT) completed.delete(completed.keys().next().value);
        completed.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      if (error) reject(error); else resolve(result);
    };
    try {
      worker = new Worker(new URL('./replay-worker.mjs', import.meta.url), {
        workerData: { token, replay }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      // Partidas largas necesitan más tiempo de CPU en una instancia Free.
      timer = setTimeout(() => finish(failure('verification_timeout')), VERIFICATION_TIMEOUT_MS);
      worker.once('message', (message) => message.invalid
        ? finish(failure('invalid_replay', 422)) : finish(null, message.result));
      worker.once('error', () => finish(failure('verification_worker_failed')));
      worker.once('exit', () => { if (!settled) finish(failure('verification_worker_exited')); });
    } catch { finish(failure('verification_worker_start')); }
  });
  pending.set(key, promise);
  // También limpia un fallo síncrono al crear el worker.
  promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}
