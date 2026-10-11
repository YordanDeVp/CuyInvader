import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/AudioManager.js';

class FakeAudio extends EventTarget {
  constructor(src) { super(); this.src = src; this.paused = true; this.currentTime = 0; this.calls = 0; }
  play() { this.calls += 1; this.paused = false; return this.result ?? Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  load() {}
}

function manager(t) {
  t.mock.property(globalThis, 'Audio', FakeAudio);
  const audio = new AudioManager();
  t.after(() => audio.destroy());
  return audio;
}

// Node no tiene HTMLAudioElement; el doble permite comprobar promesas y estados.
globalThis.Audio = FakeAudio;
test('BGM espera un gesto, cambia con el jefe y se detiene en pausa', async (t) => {
  const audio = manager(t);
  audio.update({ playing: true, wave: 1, boss: false });
  assert.equal(audio.tracks.bgmNormal.calls, 0);
  audio.unlock();
  await Promise.resolve();
  assert.equal(audio.tracks.bgmNormal.paused, false);
  audio.update({ playing: true, wave: 6, boss: true });
  assert.equal(audio.track, 'bgmNormal');
  assert.equal(audio.tracks.bgmNormal.playbackRate, 1.075);
  audio.update({ playing: true, wave: 7, boss: true });
  assert.equal(audio.track, 'bgmBoss');
  assert.equal(audio.tracks.bgmNormal.paused, true);
  audio.update({ playing: false, wave: 7, boss: true });
  await Promise.resolve();
  assert.equal(audio.tracks.bgmBoss.paused, true);
  audio.update({ playing: true, wave: 40, boss: false });
  assert.equal(audio.track, 'bgmNormal');
  assert.equal(audio.tracks.bgmNormal.playbackRate, 1.35);
});

test('el jingle baja BGM, la restaura al terminar y silencio detiene todos los canales', async (t) => {
  const audio = manager(t);
  audio.unlock(); audio.update({ playing: true, wave: 8, boss: false });
  audio.playPowerUpJingle();
  audio.shootSound();
  assert.equal(audio.tracks.bgmNormal.volume, .07);
  audio.tracks.bgmPowerUp.dispatchEvent(new Event('ended'));
  assert.equal(audio.tracks.bgmNormal.volume, .24);
  audio.toggleMute();
  await Promise.resolve();
  assert.ok([...Object.values(audio.tracks), ...Object.values(audio.effects).flat()].every((item) => item.paused));
  audio.toggleMute();
  await Promise.resolve();
  assert.equal(audio.tracks.bgmNormal.paused, false);
});

test('autoplay rechazado o archivo ausente no propagan errores al juego', async (t) => {
  const audio = manager(t);
  audio.tracks.bgmNormal.result = Promise.reject(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
  audio.unlock(); audio.update({ playing: true, wave: 1, boss: false });
  await Promise.resolve();
  assert.equal(audio.unlocked, false);
  audio.tracks.bgmNormal.result = Promise.resolve();
  audio.unlock();
  await Promise.resolve();
  assert.equal(audio.unlocked, true);
  audio.tracks.bgmPowerUp.dispatchEvent(new Event('error'));
  audio.playPowerUpJingle();
  assert.equal(audio.tracks.bgmPowerUp.calls, 0);
  assert.equal(audio.tracks.bgmNormal.volume, .24);
});
