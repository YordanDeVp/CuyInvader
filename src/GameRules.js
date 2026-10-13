// Reglas compartidas: el servidor valida puntos con el mismo balance del juego.
export const ENDGAME_WAVE = 5;
export const EXTREME_WAVE = 10;
export const ENDGAME_BOSSES = 2;
export const SUMMON_INTERVAL = 3;
export const MINION_POINTS = 15;

export function guardianCountForWave(wave) {
  return wave >= ENDGAME_WAVE ? ENDGAME_BOSSES : wave >= 3 ? 4 : 0;
}

export function laserIntervalForWave(wave) {
  return wave >= EXTREME_WAVE ? 5 : wave >= ENDGAME_WAVE ? 7 : 10;
}

export function bossHealthForWave(wave) {
  // Conserva el HP base progresivo; desde la oleada 10 lo triplica.
  const baseHealth = 10 + (wave - 3) * 3;
  return baseHealth * (wave >= EXTREME_WAVE ? 3 : 1);
}

export function minionsPerSummonForWave(wave) {
  return wave >= EXTREME_WAVE ? 4 : 2;
}

export function minionHealthMultiplierForWave(wave) {
  return wave >= EXTREME_WAVE ? 3 : 2;
}
