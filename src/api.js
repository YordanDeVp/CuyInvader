// El cliente solo habla con nuestro proxy. No contiene SDK ni claves de Supabase.
const SCORES_PATH = '/api/scores';
const SESSION_PATH = '/api/start-session';

async function request(options = {}) {
  const { url = SCORES_PATH, expectedStatuses, ...fetchOptions } = options;
  let response;
  try {
    const timeout = AbortSignal.timeout(12000);
    const signal = fetchOptions.signal && AbortSignal.any
      ? AbortSignal.any([fetchOptions.signal, timeout])
      : fetchOptions.signal ?? timeout;
    response = await fetch(url, { ...fetchOptions,
      headers: { Accept: 'application/json', ...fetchOptions.headers },
      signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (cause) {
    const error = new Error(options.method === 'POST'
      ? 'No se pudo confirmar el envío. Consulta el ranking antes de reintentar.'
      : 'No hay conexión con el ranking. Inténtalo de nuevo.');
    // Conserva el error de red/CORS real para que el log temporal del flujo de
    // sesión permita distinguirlo de un 404 o de una respuesta HTTP inválida.
    error.cause = cause;
    error.endpoint = url;
    error.method = fetchOptions.method ?? 'GET';
    throw error;
  }
  const contentType = response.headers?.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    const error = new Error('La API respondió una página en lugar de JSON. Comprueba que Express atiende /api en el Web Service.');
    error.status = response.status;
    error.endpoint = url;
    throw error;
  }
  const data = await response.json().catch(() => null);
  const accepted = expectedStatuses ? expectedStatuses.includes(response.status) : response.ok;
  if (!accepted) {
    const error = new Error(data?.error || 'El ranking no está disponible.');
    error.status = response.status;
    throw error;
  }
  if (data === null) throw new Error('Respuesta inválida del ranking.');
  return data;
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

export async function submitScore({ name, score, wave, runToken }) {
  const saved = await request({ method: 'POST', expectedStatuses: [200, 201], headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score, wave, runToken }) });
  if (saved.name !== name || saved.score !== score || saved.wave !== wave) {
    throw new Error('La confirmación del servidor no coincide con esta partida. Puedes reintentar el mismo envío.');
  }
  return saved;
}
