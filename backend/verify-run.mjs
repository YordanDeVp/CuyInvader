import { Worker } from 'node:worker_threads';
let active = 0;

// CPU acotada y fuera del event loop de Express; no exige servicios de pago.
export function verifyRun(token, replay) {
  if (active >= 2) return Promise.reject(Object.assign(new Error('busy'), { status: 503 }));
  active += 1;
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) { try { await worker.terminate(); } catch { /* El worker ya terminó. */ } }
      active -= 1;
      if (error) reject(error); else resolve(result);
    };
    try {
      worker = new Worker(new URL('./replay-worker.mjs', import.meta.url), {
        workerData: { token, replay }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      timer = setTimeout(() => finish(Object.assign(new Error('verification-timeout'), { status: 503 })), 5000);
      worker.once('message', (message) => message.invalid
        ? finish(Object.assign(new Error('invalid-replay'), { status: 422 })) : finish(null, message.result));
      worker.once('error', () => finish(Object.assign(new Error('worker-failed'), { status: 503 })));
      worker.once('exit', () => { if (!settled) finish(Object.assign(new Error('worker-exited'), { status: 503 })); });
    } catch (error) { finish(Object.assign(error, { status: 503 })); }
  });
}
