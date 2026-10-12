// Reglas compartidas: el servidor valida puntos con el mismo balance del juego.
export const ENDGAME_WAVE = 7;
export const ENDGAME_BOSSES = 2;
export const SUMMON_INTERVAL = 3;
export const MINIONS_PER_SUMMON = 2;
export const MINION_POINTS = 15;

export function guardianCountForWave(wave) {
  return wave >= ENDGAME_WAVE ? ENDGAME_BOSSES : wave >= 5 ? 5 : wave >= 3 ? 4 : 0;
}

export function laserIntervalForWave(wave) {
  return wave >= ENDGAME_WAVE ? 7 : 10;
}
