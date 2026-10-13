import { access, cp, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(projectRoot, 'dist');
const publicEntries = ['index.html', 'style.css', 'src', 'assets'];

// Antes de limpiar, comprobamos el destino absoluto y rechazamos enlaces.
// El borrado se limita a la carpeta generada dist/ de este proyecto.
if (path.relative(projectRoot, destination) !== 'dist') throw new Error('Destino de build no válido.');
try {
  const stat = await lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('dist debe ser una carpeta local del proyecto.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const entry of publicEntries) await access(path.join(projectRoot, entry));
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
for (const entry of publicEntries) {
  await cp(path.join(projectRoot, entry), path.join(destination, entry), {
    recursive: true,
    // Nunca publicar archivos ocultos, aunque se añadieran a src/ o assets/.
    filter: async (source) => {
      if (path.basename(source).startsWith('.')) return false;
      if ((await lstat(source)).isSymbolicLink()) throw new Error('No se publican enlaces simbólicos: ' + source);
      return true;
    },
  });
}
console.log('Cliente preparado en dist/; backend y configuración permanecen privados.');
