# Despliegue de la corrección

El código local de `codex/server-session-monolith` es un monolito. Un Static Site de Render no ejecuta sus rutas `/api/*`. En la auditoría del 12 de octubre, `cuyinvader.onrender.com` respondía 404 en esas rutas y servía `server.js` como archivo; esa publicación no demuestra que funcione este backend.

## Configuración del Web Service

| Campo | Valor |
| --- | --- |
| Repositorio | `YordanDeVp/CuyInvader` |
| Rama de pruebas | `codex/server-session-monolith` |
| Tipo | Web Service, Node |
| Plan | Free |
| Root Directory | raíz del repositorio, vacío |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/ready` |
| Puerto | `PORT` lo proporciona Render; Express escucha en `0.0.0.0` |

La configuración corresponde al [despliegue de Express](https://render.com/docs/deploy-node-express-app) y a los [health checks de Render](https://render.com/docs/health-checks). No necesitas CORS ni servicios adicionales: frontend y API comparten origen.

Variables privadas: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` real de servidor y `GAME_SESSION_SECRET` aleatorio de al menos 32 bytes. Variables de configuración: `NODE_VERSION=22`, `TRUST_PROXY_HOPS=1`. En local usa `TRUST_PROXY_HOPS=0`. No copies claves a código, Git, comentarios de PR o capturas de pantalla. `.env` y `supabase/` continúan ignorados. No se necesita `.env.example`.

## Verificación antes de publicar

1. Ejecuta `npm ci` y `npm test`. La suite usa una base simulada y el verificador real de partidas; no inserta datos en producción.
2. Comprueba que `leaderboard` tiene `name`, `score`, `wave`, `created_at`, `id`, `run_id` y el índice único de `run_id`. RLS debe seguir activado, sin políticas públicas; el backend usa permisos de servicio para SELECT/INSERT.
3. Con las claves reales, ejecuta `npm start` y comprueba `/api/ready`: HTTP 200, JSON `status: ready`. Si devuelve 503, usa el request ID y el código de los logs para diagnosticar Supabase.
4. Juega una partida completa en el navegador. Guardar debe registrar el mismo nombre, puntaje y oleada y mostrar el Top 10. Prueba reiniciar durante una consulta, reintentar tras cortar conexión y ambas orientaciones móviles.
5. Sube únicamente la rama de corrección cuando se haya revisado. Despliega esa rama en el Web Service Free. Recarga el navegador: la versión nueva exige un replay; una partida antigua no puede publicarse con este contrato.
6. Comprueba en la URL del **Web Service** `/`, `/api/ready`, `/api/start-session` y `/api/scores`. Deben responder correctamente. `/server.js`, `/backend/replay-worker.mjs`, `/.env`, `/render.yaml` y `/supabase/*` deben dar 404.

El Blueprint no convierte un Static Site existente en Web Service. Crear un servicio nuevo puede producir una URL distinta. Conserva el sitio anterior durante las pruebas; no borres servicios ni cambies dominios sin verificar el servicio nuevo.

## Rollback

Conserva el SHA del último **Web Service verificado** y usa el rollback de Render sobre ese servicio si falla el despliegue. No uses como rollback del backend un commit que solo se comprobó como Static Site. Cliente y servidor deben retroceder juntos. El contrato de tokens/replays cambia al actualizar reglas: las partidas abiertas deberán recargarse. Las claves y el esquema de Supabase permanecen fuera del build; este parche no elimina registros ni cambia RLS.

## Alcance de la validación

El servidor recalcula movimientos, impactos, drops y puntuación con una semilla firmada. No confía en el total enviado por el navegador. La verificación está acotada a una hora de juego, veinte mil eventos y cinco segundos de tiempo de comprobación por intento. No demuestra identidad ni participación humana; automatizar entradas válidas sigue siendo posible. Antes de un torneo deben comprobarse los dispositivos objetivo y la capacidad del servicio Free con tráfico representativo.

Mensaje de commit previsto: `fix: verify runs and recover leaderboard saves`.
