// El cliente solo habla con nuestro proxy. No contiene SDK ni claves de Supabase.
const SCORES_PATH = '/api/scores';
const SESSION_PATH = '/api/start-session';

export async function request(options = {}) {
  const { url = SCORES_PATH, expectedStatuses, timeoutMs = 12000, ...fetchOptions } = options;
  const controller = new AbortController();
  const caller = fetchOptions.signal;
  const cancel = () => controller.abort(caller.reason);
  if (caller?.aborted) cancel(); else caller?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado.', 'TimeoutError')), timeoutMs);
  const aborted = new Promise((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason);
    else controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  let response;
  try {
    // El plazo cubre también el JSON, sin depender de AbortSignal.any/timeout.
    response = await Promise.race([aborted, fetch(url, { ...fetchOptions,
      headers: { Accept: 'application/json', ...fetchOptions.headers },
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin' })]);
    const contentType = response.headers?.get('content-type');
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      throw Object.assign(new Error('La API respondió una página en lugar de JSON. Comprueba que Express atiende /api en el Web Service.'), { status: response.status });
    }
    const data = await Promise.race([aborted, response.json()]);
    const accepted = expectedStatuses ? expectedStatuses.includes(response.status) : response.ok;
    if (!accepted) {
      const retry = response.headers?.get('retry-after');
      const retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
      throw Object.assign(new Error(data?.error || 'El ranking no está disponible.'), {
        status: response.status, retryAfterMs: Math.max(0, Math.min(60000, retryAfterMs || 0)),
      });
    }
    if (data === null) throw new Error('Respuesta inválida del ranking.');
    return data;
  } catch (cause) {
    const error = cause?.status ? cause : Object.assign(new Error(fetchOptions.method === 'POST'
      ? 'No se pudo confirmar el envío. Puedes reintentar el mismo resultado.'
      : 'No hay conexión con el ranking. Inténtalo de nuevo.'), { cause });
    error.endpoint = url;
    error.method = fetchOptions.method ?? 'GET';
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

export async function startGameSession({ signal } = {}) {
  const result = await request({ url: SESSION_PATH, method: 'GET', expectedStatuses: [200], signal });
  if (typeof result.token !== 'string' || !result.token || result.token.length > 1024) {
    throw new Error('El servidor no entregó un ticket de partida válido.');
  }
  return result.token;
}

export async function getTopScores({ signal } = {}) {
  const scores = await request({ signal });
  if (!Array.isArray(scores)) throw new Error('Respuesta inválida del ranking.');
  return scores.slice(0, 10);
}

export async function submitScore({ name, score, wave, runToken, replay }, { signal } = {}) {
  const saved = await request({ method: 'POST', expectedStatuses: [200, 201], signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score, wave, runToken, replay }) });
  if (saved.name !== name || saved.score !== score || saved.wave !== wave) {
    throw new Error('La confirmación del servidor no coincide con esta partida. Puedes reintentar el mismo envío.');
  }
  return saved;
}
