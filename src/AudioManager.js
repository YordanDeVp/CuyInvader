// HTMLAudioElement: pistas sustituibles sin cambiar la lógica del juego.
const FILES = {
  bgmNormal: 'bgm-normal.wav', bgmBoss: 'bgm-boss.wav', bgmPowerUp: 'bgm-powerup.wav',
  shootSound: 'shoot.wav', explosionSound: 'explosion.wav',
  powerupCollectSound: 'powerup-collect.wav', powerupUseSound: 'powerup-use.wav',
};

export class AudioManager {
  constructor() {
    this.unlocked = false;
    this.muted = false;
    this.playing = false;
    this.track = null;
    this.rate = 1;
    this.jingling = false;
    this.destroyed = false;
    this.pending = new WeakSet();
    this.failed = new WeakSet();
    this.lastEffect = new Map();
    this.controller = new AbortController();
    this.tracks = Object.fromEntries(Object.keys(FILES).filter((key) => key.startsWith('bgm')).map((key) => [key, this.createAudio(key)]));
    this.tracks.bgmNormal.loop = this.tracks.bgmBoss.loop = true;
    // Un pool limitado evita crear elementos de audio por cada choclo o enemigo.
    this.effects = Object.fromEntries(Object.keys(FILES).filter((key) => !key.startsWith('bgm')).map((key) => [key, Array.from({ length: 3 }, () => this.createAudio(key))]));
    this.tracks.bgmPowerUp.addEventListener('ended', () => this.finishJingle(), { signal: this.controller.signal });
    this.tracks.bgmPowerUp.addEventListener('error', () => this.finishJingle(), { signal: this.controller.signal });
    this.setVolumes();
  }

  createAudio(key) {
    const audio = new Audio(new URL('../assets/audio/' + FILES[key], import.meta.url).href);
    audio.preload = 'auto';
    audio.addEventListener('error', () => this.failed.add(audio), { signal: this.controller.signal });
    return audio;
  }

  // Solo se llama desde un gesto real: el navegador decide si autoriza play().
  unlock() {
    if (this.destroyed) return;
    this.unlocked = true;
    this.resumeMusic();
  }

  safePlay(audio) {
    if (!this.unlocked || this.muted || !this.playing || this.destroyed || this.failed.has(audio) || this.pending.has(audio)) return;
    this.pending.add(audio);
    const finish = () => {
      this.pending.delete(audio);
      // Una promesa tardía no debe reactivar audio tras pausar, silenciar o cambiar de pista.
      if (!this.playing || this.muted || this.destroyed ||
        ([this.tracks.bgmNormal, this.tracks.bgmBoss].includes(audio) && audio !== this.tracks[this.track])) audio.pause();
    };
    try {
      Promise.resolve(audio.play()).then(finish, (error) => {
        if (error.name === 'NotAllowedError') this.unlocked = false;
        if (audio === this.tracks.bgmPowerUp) this.finishJingle();
        finish();
      });
    } catch {
      this.failed.add(audio);
      if (audio === this.tracks.bgmPowerUp) this.finishJingle();
      finish();
    }
  }

  update({ playing, wave, boss }) {
    const nextTrack = boss && wave >= 7 ? 'bgmBoss' : 'bgmNormal';
    const wasPlaying = this.playing;
    const changedTrack = this.track !== nextTrack;
    this.playing = playing;
    // +1,5% por oleada, con un límite musical de 1,35×.
    this.rate = Math.min(1.35, 1 + Math.max(0, wave - 1) * .015);
    this.tracks.bgmNormal.playbackRate = this.rate;
    if (changedTrack) {
      if (this.track) this.tracks[this.track].pause();
      this.track = nextTrack;
    }
    if (!playing && wasPlaying) this.pauseAll();
    if (playing && (!wasPlaying || changedTrack)) this.resumeMusic();
  }

  resumeMusic() {
    if (this.track) this.safePlay(this.tracks[this.track]);
  }

  pauseAll() {
    Object.values(this.tracks).forEach((audio) => audio.pause());
    Object.values(this.effects).flat().forEach((audio) => audio.pause());
    this.tracks.bgmPowerUp.currentTime = 0;
    this.finishJingle();
  }

  setVolumes() {
    this.tracks.bgmNormal.volume = this.tracks.bgmBoss.volume = this.jingling ? .07 : .24;
    this.tracks.bgmPowerUp.volume = .32;
    Object.values(this.effects).flat().forEach((audio) => { audio.volume = .18; });
  }

  finishJingle() { this.jingling = false; this.setVolumes(); }

  playPowerUpJingle() {
    if (!this.playing || !this.unlocked || this.muted || this.failed.has(this.tracks.bgmPowerUp)) return;
    this.jingling = true;
    this.setVolumes();
    this.tracks.bgmPowerUp.currentTime = 0;
    this.safePlay(this.tracks.bgmPowerUp);
  }

  playEffect(key, gap = 70) {
    if (!this.playing || !this.unlocked || this.muted || this.destroyed) return;
    const now = performance.now();
    if (now - (this.lastEffect.get(key) ?? -Infinity) < gap) return;
    this.lastEffect.set(key, now);
    const audio = this.effects[key].find((item) => (item.paused || item.ended) && !this.pending.has(item) && !this.failed.has(item));
    if (!audio) return;
    audio.currentTime = 0;
    this.safePlay(audio);
  }

  shootSound() { this.playEffect('shootSound'); }
  explosionSound() { this.playEffect('explosionSound'); }
  powerupCollectSound() { this.playEffect('powerupCollectSound'); }
  powerupUseSound() { this.playEffect('powerupUseSound'); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) this.pauseAll();
    else this.unlock();
    return this.muted;
  }

  destroy() {
    this.destroyed = true;
    this.pauseAll();
    this.controller.abort();
    for (const audio of [...Object.values(this.tracks), ...Object.values(this.effects).flat()]) {
      audio.removeAttribute('src');
      audio.load();
    }
  }
}
