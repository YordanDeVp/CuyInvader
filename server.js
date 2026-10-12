import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDGAME_WAVE, ENDGAME_BOSSES, SUMMON_INTERVAL, MINIONS_PER_SUMMON, MINION_POINTS, guardianCountForWave } from './src/GameRules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const columns = 'id, name, score, wave, created_at';
const RUN_TICKET_TTL_MS = 6 * 60 * 60 * 1000;
// Barrera temporal básica contra publicaciones instantáneas. No certifica una
// partida: un torneo con premios requiere validar una simulación reproducible.
const MIN_RUN_MS = 15_000;
const MIN_MS_PER_WAVE = 15_000;
const MAX_SCORE = Number.MAX_SAFE_INTEGER;

function signPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// El servidor firma un ticket de partida. El secreto nunca se envía al navegador.
export function createGameTicket(secret, issuedAt = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, runId: randomUUID(), issuedAt })).toString('base64url');
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
    if (claims.v !== 1 || !/^[0-9a-f-]{36}$/i.test(claims.runId) || !Number.isSafeInteger(claims.issuedAt)) return null;
    if (claims.issuedAt > now + 30_000 || now - claims.issuedAt > RUN_TICKET_TTL_MS) return null;
    return claims;
  } catch {
    return null;
  }
}

export function minimumRunDurationMs(wave) {
  return MIN_RUN_MS + Math.max(0, wave - 1) * MIN_MS_PER_WAVE;
}

// Cota superior deliberadamente generosa: puntos máximos de todas las tropas,
// guardianes, secuaces y drops que podrían existir hasta la oleada indicada.
export function maximumPlausibleScore(wave, elapsedMs) {
  let ceiling = 0;
  let guardianTotal = 0;
  for (let current = 1; current <= wave; current += 1) {
    const troops = Math.min(72, 36 + (current - 1) * 4);
    ceiling += Math.ceil(troops / 2) * 30 + Math.floor(troops / 2) * 20;
    const guardians = guardianCountForWave(current);
    if (guardians) ceiling += guardians * 250 + 350; // Incluye la forma verdadera del impostor.
    guardianTotal += guardians;
  }
  // El tiempo total da una cota generosa para las invocaciones repetidas de
  // ambos jefes. Evita rechazar puntos legítimos por derrotar muchos secuaces.
  if (wave >= ENDGAME_WAVE) {
    ceiling += Math.floor(Math.max(0, elapsedMs) / (SUMMON_INTERVAL * 1000)) * ENDGAME_BOSSES * MINIONS_PER_SUMMON * MINION_POINTS;
  }
  ceiling += Math.floor(guardianTotal / 5) * 100;
  ceiling += Math.floor(Math.max(0, elapsedMs) / 10_000) * 100; // Máximo de drops temporizados.
  return Math.min(MAX_SCORE, ceiling);
}

// Rechaza coerciones, enteros inseguros y campos que permitirían manipular IDs.
export function validateEntry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const allowed = ['name', 'score', 'wave', 'runToken'];
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
export function createApp(db, { trustProxy = 0, gameSessionSecret, now = Date.now, rateLimitStoreFactory } = {}) {
  if (typeof gameSessionSecret !== 'string' || Buffer.byteLength(gameSessionSecret, 'utf8') < 32) {
    throw new Error('GAME_SESSION_SECRET debe contener al menos 32 bytes aleatorios.');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': null } } }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Cada middleware recibe su propia instancia de store. Por defecto usa
  // MemoryStore; rateLimitStoreFactory permite inyectar Redis sin atar la API a un proveedor.
  const limiter = (limit, name) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.' },
    ...(rateLimitStoreFactory ? { store: rateLimitStoreFactory(name) } : {}),
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/game-session', limiter(20, 'game-session'), (_req, res) => {
    return res.status(201).json({ token: createGameTicket(gameSessionSecret, now()) });
  });

  app.get('/api/leaderboard', limiter(60, 'leaderboard-read'), async (_req, res) => {
    try {
      const { data, error } = await db.from('leaderboard').select(columns)
        .order('score', { ascending: false }).order('created_at', { ascending: true })
        .order('id', { ascending: true }).limit(10).abortSignal(AbortSignal.timeout(8000));
      if (error) return res.status(503).json({ error: 'No se pudo cargar el ranking. Inténtalo más tarde.' });
      return res.json(data);
    } catch {
      return res.status(503).json({ error: 'El ranking no está disponible temporalmente.' });
    }
  });

  app.post('/api/leaderboard', limiter(5, 'leaderboard-write'), (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Envía application/json.' });
    return next();
  }, express.json({ limit: '2kb', strict: true }), async (req, res) => {
    const entry = validateEntry(req.body);
    if (!entry) return res.status(400).json({ error: 'Revisa nombre, puntaje y oleada.' });
    const ticket = verifyGameTicket(req.body.runToken, gameSessionSecret, now());
    if (!ticket) return res.status(401).json({ error: 'La sesión de partida no es válida o venció. Inicia una partida nueva.' });
    const elapsedMs = now() - ticket.issuedAt;
    if (elapsedMs < minimumRunDurationMs(entry.wave)) {
      return res.status(422).json({ error: 'La duración no es suficiente para esa oleada.' });
    }
    if (entry.score > maximumPlausibleScore(entry.wave, elapsedMs)) {
      return res.status(422).json({ error: 'El puntaje supera el máximo posible para esa partida.' });
    }
    try {
      // run_id único en la BD evita reutilizar un ticket para publicar varias veces.
      const { data, error } = await db.from('leaderboard').insert({ ...entry, run_id: ticket.runId })
        .select(columns).single().abortSignal(AbortSignal.timeout(8000));
      if (error?.code === '23505') {
        // Repetir el mismo envío tras perder la respuesta devuelve el resultado
        // ya guardado. Un ticket no puede cambiar el nombre ni el puntaje.
        const existing = await db.from('leaderboard').select(columns)
          .eq('run_id', ticket.runId).maybeSingle().abortSignal(AbortSignal.timeout(8000));
        if (existing.error) return res.status(503).json({ error: 'No se pudo confirmar el guardado. Inténtalo de nuevo.' });
        if (existing.data && existing.data.name === entry.name && existing.data.score === entry.score && existing.data.wave === entry.wave) {
          return res.status(200).json(existing.data);
        }
        return res.status(409).json({ error: 'El ticket ya se usó con otro resultado.' });
      }
      if (error) return res.status(503).json({ error: 'No se pudo guardar el puntaje. Inténtalo más tarde.' });
      return res.status(201).json(data);
    } catch {
      return res.status(503).json({ error: 'No se pudo confirmar el guardado. Consulta el ranking antes de reintentar.' });
    }
  });
  app.all('/api/leaderboard', (_req, res) => res.set('Allow', 'GET, POST').status(405).json({ error: 'Método no permitido.' }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // Lista explícita: nunca servir la raíz completa (contiene .env y server.js).
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(root, 'index.html')));
  app.get('/style.css', (_req, res) => res.sendFile(path.join(root, 'style.css')));
  for (const folder of ['src', 'assets']) {
    app.use('/' + folder, express.static(path.join(root, folder), { dotfiles: 'deny', index: false }));
  }
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
