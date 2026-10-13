import { parentPort, workerData } from 'node:worker_threads';
import { replayRun } from '../src/Simulation.js';
try { parentPort.postMessage({ result: replayRun(workerData.token, workerData.replay) }); }
catch { parentPort.postMessage({ invalid: true }); }
