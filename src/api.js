// El cliente solo habla con nuestro proxy. No contiene SDK ni claves de Supabase.
async function request(options = {}) {
  const { url, expectedStatuses, ...fetchOptions } = options;
  let response;
  try {
    const timeout = AbortSignal.timeout(12000);
    const signal = fetchOptions.signal && AbortSignal.any
      ? AbortSignal.any([fetchOptions.signal, timeout])
      : fetchOptions.signal ?? timeout;
    response = await fetch(url ?? '/api/leaderboard', { ...fetchOptions, signal, cache: 'no-store' });
  } catch {
    throw new Error(options.method === 'POST'
      ? 'No se pudo confirmar el envío. Consulta el ranking antes de reintentar.'
      : 'No hay conexión con el ranking. Inténtalo de nuevo.');
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

export async function startGameSession() {
  const result = await request({ url: '/api/game-session', method: 'POST' });
  if (typeof result.token !== 'string') throw new Error('No se pudo validar la partida.');
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
