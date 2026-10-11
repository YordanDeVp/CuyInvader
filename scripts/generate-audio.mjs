// Sonidos originales sintetizados. Ejecutar: node scripts/generate-audio.mjs
// No descarga pistas ni necesita paquetes. Produce WAV PCM mono para HTMLAudio.
import { mkdir, writeFile } from 'node:fs/promises';
const rate = 22050;
const folder = new URL('../assets/audio/', import.meta.url);
await mkdir(folder, { recursive: true });
const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const triangle = (phase) => 2 / Math.PI * Math.asin(Math.sin(phase));

async function wav(name, seconds, sample) {
  const length = Math.round(seconds * rate);
  const bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i += 1) {
    const value = Math.max(-1, Math.min(1, sample(i / rate)));
    bytes.writeInt16LE(Math.round(value * 32760), 44 + i * 2);
  }
  await writeFile(new URL(name + '.wav', folder), bytes);
}

async function melody(name, notes, beat, bass) {
  await wav(name, notes.length * beat, (t) => {
    const step = Math.floor(t / beat), local = t % beat;
    // Ataque y salida suaves en cada nota, incluido el punto de repetición.
    const env = Math.min(1, local / .008) * Math.min(1, (beat - local) / .03);
    return env * (.25 * triangle(2 * Math.PI * hz(notes[step]) * local)
      + .12 * Math.sin(2 * Math.PI * hz(bass[Math.floor(step / 4) % bass.length]) * local));
  });
}

await melody('bgm-normal', [76,79,81,79,76,74,72,74,76,79,84,81,79,76,74,72,
  69,72,76,79,81,79,76,74,72,74,76,79,76,74,72,69], .25, [48,45,53,43]);
await melody('bgm-boss', [57,64,60,64,57,64,60,67,56,63,59,63,56,63,59,66,
  57,64,60,67,57,64,60,69,56,63,59,66,56,63,59,68], .2, [33,32,33,32]);
await melody('bgm-powerup', [72,76,79,84,79,84,88,91], .15, [48,55]);
await wav('shoot', .085, (t) => .28 * Math.exp(-t * 45) * Math.sin(2 * Math.PI * (1300 * t - 4500 * t * t)));
let noise = 12345;
await wav('explosion', .32, (t) => {
  noise = (1664525 * noise + 1013904223) >>> 0;
  return .4 * Math.exp(-t * 14) * (noise / 2147483648 - 1) * Math.min(1, t / .005);
});
await melody('powerup-collect', [79,84,88], .085, [60]);
await melody('powerup-use', [48,60,72], .06, [36]);
console.log('Audio generado en assets/audio/');
