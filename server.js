import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_VERSION, SIMULATION_STEP } from './src/RunReplay.js';
import { validateReplay } from './src/Simulation.js';
import { verifyRun } from './backend/verify-run.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(root, 'dist');
const columns = 'id, name, score, wave, created_at';
const RUN_TICKET_TTL_MS = 6 * 60 * 60 * 1000;
function signPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// El servidor firma un ticket de partida. El secreto nunca se envía al navegador.
export function createGameTicket(secret, issuedAt = Date.now(), seed = randomInt(0, 4294967296)) {
  const payload = Buffer.from(JSON.stringify({ v: 2, runId: randomUUID(), issuedAt,
    rules: RULES_VERSION, seed })).toString('base64url');
  return payload + '.' + signPayload(payload, secret);
}

export function verifyGameTicket(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const supplied = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(signPayload(payload, secret), 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.v !== 2 || claims.rules !== RULES_VERSION || !Number.isInteger(claims.seed) || claims.seed < 0 || claims.seed > 4294967295 ||
        !/^[0-9a-f-]{36}$/i.test(claims.runId) || !Number.isSafeInteger(claims.issuedAt)) return null;
    // Ambos tiempos proceden de Node.js; no aceptamos tickets del futuro.
    if (claims.issuedAt > now || now - claims.issuedAt > RUN_TICKET_TTL_MS) return null;
    return claims;
  } catch {
    return null;
  }
}

// Rechaza coerciones, enteros inseguros y campos que permitirían manipular IDs.
export function validateEntry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const allowed = ['name', 'score', 'wave', 'runToken', 'replay'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return null;
  if (typeof body.name !== 'string') return null;
  const name = body.name.normalize('NFC').trim();
  if (!name || name.length > 30 || /[\p{Cc}\p{Cf}<>]/u.test(name) ||
      !Number.isSafeInteger(body.score) || body.score < 0 ||
      !Number.isInteger(body.wave) || body.wave < 1 || body.wave > 10000 ||
      (body.runToken !== undefined && (typeof body.runToken !== 'string' || body.runToken.length > 1024))) return null;
  return { name, score: body.score, wave: body.wave };
}

// Inyección del cliente para comprobar la API sin credenciales ni una BD real.
export function createApp(db, { trustProxy = 0, gameSessionSecret, now = Date.now, rateLimitStoreFactory,
  runVerifier = verifyRun, logger = (record) => console.warn(JSON.stringify(record)) } = {}) {
  if (typeof gameSessionSecret !== 'string' || Buffer.byteLength(gameSessionSecret, 'utf8') < 32) {
    throw new Error('GAME_SESSION_SECRET debe contener al menos 32 bytes aleatorios.');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => { req.requestId = randomUUID(); res.set('X-Request-ID', req.requestId); next(); });
  const logFailure = (req, operation, error) => logger({ level: 'error', operation, requestId: req.requestId,
    code: /^[A-Za-z0-9_-]{1,40}$/.test(error?.code ?? '') ? error.code : 'upstream_failure' });
  // Cada middleware recibe su propia instancia de store. Por defecto usa
  // MemoryStore; rateLimitStoreFactory permite inyectar Redis sin atar la API a un proveedor.
  const limiter = (limit, name, keyGenerator) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.' },
    ...(keyGenerator ? { keyGenerator } : {}),
    ...(rateLimitStoreFactory ? { store: rateLimitStoreFactory(name) } : {}),
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', limiter(120, 'readiness'), async (req, res) => {
    try {
      const { error } = await db.from('leaderboard').select(columns + ', run_id').limit(1).abortSignal(AbortSignal.timeout(3000));
      if (error) throw error;
      res.json({ status: 'ready', rules: RULES_VERSION });
    } catch (error) { logFailure(req, 'readiness', error); res.status(503).json({ status: 'unavailable' }); }
  });

  // Cortafuegos por IP amplio para redes de una competencia. El límite fino
  // de escritura pertenece a cada ticket, no a todos los jugadores del Wi-Fi.
  const sessionLimiter = limiter(300, 'game-session');
  const issueSession = (req, res) => res.status(req.method === 'POST' ? 201 : 200)
    .json({ token: createGameTicket(gameSessionSecret, now()) });
  // El cliente recibe un ticket temporal, nunca el secreto que lo firma.
  app.get('/api/start-session', sessionLimiter, issueSession);
  // Se conservan las rutas anteriores; el contrato exige el replay nuevo.
  app.post('/api/game-session', sessionLimiter, issueSession);

  const scoreRoutes = ['/api/scores', '/api/leaderboard'];
  app.get(scoreRoutes, limiter(600, 'leaderboard-read'), async (req, res) => {
    try {
      const { data, error } = await db.from('leaderboard').select(columns)
        .order('score', { ascending: false }).order('created_at', { ascending: true })
        .order('id', { ascending: true }).limit(10).abortSignal(AbortSignal.timeout(8000));
      if (error) { logFailure(req, 'leaderboard-read', error); return res.status(503).json({ error: 'No se pudo cargar el ranking. Inténtalo más tarde.' }); }
      return res.json(data);
    } catch (error) {
      logFailure(req, 'leaderboard-read', error);
      return res.status(503).json({ error: 'El ranking no está disponible temporalmente.' });
    }
  });

  app.post(scoreRoutes, limiter(300, 'leaderboard-write-ip'), (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envía application/json.' });
    return next();
  }, express.json({ limit: '512kb', strict: true }), (req, res, next) => {
    const ticket = verifyGameTicket(req.body?.runToken, gameSessionSecret, now());
    if (!ticket) return res.status(401).json({ error: 'La sesión de partida no es válida o venció. Inicia una partida nueva.' });
    res.locals.ticket = ticket;
    next();
  }, limiter(6, 'leaderboard-write-run', (_req, res) => res.locals.ticket.runId), async (req, res) => {
    const entry = validateEntry(req.body);
    if (!entry) return res.status(400).json({ error: 'Revisa nombre, puntaje y oleada.' });
    const ticket = res.locals.ticket;
    const elapsedMs = now() - ticket.issuedAt;
    if (!validateReplay(req.body.replay) || req.body.replay.steps * SIMULATION_STEP * 1000 > elapsedMs + 1000) {
      return res.status(422).json({ error: 'El registro de acciones o su duración no es válido.' });
    }
    try {
      const existing = await db.from('leaderboard').select(columns)
        .eq('run_id', ticket.runId).maybeSingle().abortSignal(AbortSignal.timeout(8000));
      if (existing.error) throw existing.error;
      if (existing.data) {
        if (existing.data.name === entry.name && existing.data.score === entry.score && existing.data.wave === entry.wave) return res.json(existing.data);
        return res.status(409).json({ error: 'El ticket ya se usó con otro resultado.' });
      }
      const verified = await runVerifier(req.body.runToken, req.body.replay, entry);
      if (verified.score !== entry.score || verified.wave !== entry.wave) return res.status(422).json({ error: 'El resultado no coincide con la reproducción de la partida.' });
      // run_id único en la BD evita reutilizar un ticket para publicar varias veces.
      const { data, error } = await db.from('leaderboard').insert({ ...entry, run_id: ticket.runId })
        .select(columns).single().abortSignal(AbortSignal.timeout(8000));
      if (error?.code === '23505') {
        // Repetir el mismo envío tras perder la respuesta devuelve el resultado
        // ya guardado. Un ticket no puede cambiar el nombre ni el puntaje.
        const existing = await db.from('leaderboard').select(columns)
          .eq('run_id', ticket.runId).maybeSingle().abortSignal(AbortSignal.timeout(8000));
        if (existing.error) { logFailure(req, 'leaderboard-confirm', existing.error); return res.status(503).json({ error: 'No se pudo confirmar el guardado. Inténtalo de nuevo.' }); }
        if (existing.data && existing.data.name === entry.name && existing.data.score === entry.score && existing.data.wave === entry.wave) {
          return res.status(200).json(existing.data);
        }
        return res.status(409).json({ error: 'El ticket ya se usó con otro resultado.' });
      }
      if (error) { logFailure(req, 'leaderboard-write', error); return res.status(503).json({ error: 'No se pudo guardar el puntaje. Inténtalo más tarde.' }); }
      return res.status(201).json(data);
    } catch (error) {
      if (error.status === 422) return res.status(422).json({ error: 'No se pudo reproducir esta partida.' });
      logFailure(req, 'leaderboard-write', error);
      return res.set('Retry-After', '10').status(503).json({ error: 'No se pudo confirmar el guardado. Reintenta el mismo envío.' });
    }
  });
  app.all(scoreRoutes, (_req, res) => res.set('Allow', 'GET, POST').status(405).json({ error: 'Método no permitido.' }));
  app.all('/api/start-session', (_req, res) => res.set('Allow', 'GET').status(405).json({ error: 'Método no permitido.' }));
  app.all('/api/game-session', (_req, res) => res.set('Allow', 'POST').status(405).json({ error: 'Método no permitido.' }));
  // La API responde JSON incluso si la ruta no existe: nunca cae en el HTML.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // npm run build copia solo index.html, style.css, src/ y assets/ a dist/.
  // La raíz del repositorio contiene secretos y código privado: no es pública.
  app.use(express.static(frontendRoot, { dotfiles: 'deny', index: 'index.html', redirect: false }));
  app.use((_req, res) => res.status(404).type('text').send('No encontrado.'));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    // Nunca enviar detalles del SDK, configuración o credenciales al cliente.
    res.status(status).json({ error: status === 413 ? 'Solicitud demasiado grande.' : status === 400 ? 'JSON inválido.' : 'Error del servidor.' });
  });
  return app;
}

export function startServer() {
  dotenv.config({ path: path.join(root, '.env'), quiet: true });
  if (!existsSync(path.join(frontendRoot, 'index.html'))) {
    throw new Error('No se encontró dist/index.html. Ejecuta npm run build antes de npm start.');
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, GAME_SESSION_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_KEY en el servidor.');
  if (!GAME_SESSION_SECRET || Buffer.byteLength(GAME_SESSION_SECRET, 'utf8') < 32) {
    throw new Error('Configura GAME_SESSION_SECRET con al menos 32 bytes aleatorios.');
  }
  const trustProxy = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 0 y 5.');
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  return createApp(db, { trustProxy, gameSessionSecret: GAME_SESSION_SECRET })
    .listen(port, '0.0.0.0', () => console.log('Cuy Invaders listo en el puerto ' + port));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
