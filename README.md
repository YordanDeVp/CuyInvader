# Cuy Invaders

Un arcade de supervivencia inspirado en *Space Invaders*, con sabor andino. Maneja a un cuy sentado en una ametralladora que dispara choclos, derrota guardianes preincas y evita que las reliquias lleguen al valle.

## Jugar

El juego y la API del ranking se sirven desde el mismo proceso de Node.js (22 o superior):

```bash
npm ci
# Configura SUPABASE_URL, SUPABASE_SERVICE_KEY y GAME_SESSION_SECRET en el entorno local.
npm run build
npm start
```

Abre [http://localhost:3000](http://localhost:3000). La base de producción CuyInvader ya tiene aplicadas las migraciones de nombre único y permisos; los scripts SQL de administración no se incluyen en el repositorio público ni en el despliegue del juego. Conserva una copia privada si necesitas inicializar otra base. El ranking requiere una base configurada; el juego sigue siendo JavaScript y Canvas sin compilación.

## Leaderboard global y despliegue

- `server.js`: Express + SDK oficial `@supabase/supabase-js`. Usa `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` solo en servidor; `.env` está ignorado por Git. Nunca coloques la clave en `src/`, HTML o assets.
- SQL: UUID automático, nombre, puntaje BIGINT, oleada y fecha UTC. Índice por `score DESC, created_at ASC, id ASC`. RLS sin políticas y sin permisos para `anon`, `authenticated` ni `PUBLIC`; `service_role` solo recibe SELECT/INSERT en esta tabla. El permiso EXECUTE directo de esos roles sobre `public.rls_auto_enable()` también está revocado; su event trigger sigue activo como `postgres`.
- `GET /api/start-session` emite un ticket HMAC-SHA256 con UUID, hora, semilla aleatoria y versión de reglas. Solo Node.js conoce `GAME_SESSION_SECRET`; el navegador espera el ticket antes de comenzar la física. Los tickets caducan a las seis horas.
- `POST /api/scores` recibe `{name,score,wave,runToken,replay}`. El replay contiene el tamaño del mundo y cambios de movimiento, disparo, poderes, mejoras y tamaño, numerados por pasos de 1/120 s. El servidor reproduce esas entradas con las mismas clases del juego y compara el resultado final. Esperar un tiempo y fabricar un puntaje ya no basta. Se comprueba que la simulación no dure más que la sesión, sin imponer un mínimo arbitrario por oleada.
- La comprobación corre fuera del event loop, con un máximo de dos workers, 64 MB de heap por worker y cinco segundos por intento. Un servidor ocupado devuelve 503 y `Retry-After`, conservando la posibilidad de reintentar. El registro admite hasta una hora de juego y 20 000 eventos, dentro de un body de 512 KB. Partidas fuera de estos límites no se publican globalmente.
- `run_id` único en Supabase hace idempotente el mismo envío, incluso después de reiniciar Node.js o perder la respuesta. Un ticket usado no puede cambiar el nombre ni el resultado. `GET /api/scores` devuelve diez filas, ordenadas por puntaje, fecha y UUID. Nombre libre de 1–30 caracteres, sin exigir apellido.
- `POST /api/game-session` y `GET/POST /api/leaderboard` conservan sus rutas, con la validación nueva. Clientes antiguos sin replay deben recargar e iniciar otra partida. Al cambiar física o balance, incrementa `RULES_VERSION` en `src/RunReplay.js`; no mezcles cliente y servidor de versiones diferentes.
- `src/api.js` usa exclusivamente rutas relativas y combina cancelación y timeout sin depender de `AbortSignal.any`. Las respuestas JSON también tienen plazo. Reiniciar aborta consultas y envíos pendientes; sus respuestas tardías no abren el ranking encima de otra partida.
- `src/Leaderboard.js` muestra el formulario solo al perder. Un HTTP 200/201 confirmado cierra el formulario y abre el Top 10. Si una respuesta se pierde, conserva el payload original y permite confirmar el mismo POST. Una copia local no equivale a confirmación global. Si el juego empieza sin conexión y sin ticket, Guardar muestra únicamente el Top 10 local. El historial local y su copia en memoria están limitados a cien resultados.
- Límites por minuto: 300 sesiones, 600 lecturas y 300 intentos de escritura por IP; seis escrituras por ticket. Varios jugadores en el mismo Wi-Fi no comparten el límite fino. Se respeta `Retry-After`. La instancia Free usa MemoryStore; `rateLimitStoreFactory` permite conectar stores persistentes separados por middleware si se escala. La unicidad de partidas ya es persistente en Supabase.
- `GET /api/health` comprueba que Express vive. `GET /api/ready` comprueba conexión y columnas de Supabase; devuelve 503 si falla. Los logs contienen operación, código y request ID, sin nombres, tokens ni mensajes privados del SDK.
- Esta validación certifica un resultado alcanzable por la física compartida; no demuestra que lo haya producido una persona. No detecta bots, asistencia automática ni identidades duplicadas. Para premios se requieren reglas de participación y pruebas en navegadores/dispositivos reales, además de la validación del resultado.

El despliegue monolítico usa un único **Web Service** en Render: runtime Node 22, plan Free, build `npm ci && npm run build`, start `npm start`, health check `/api/ready`. En el panel de Render configura:

| Variable | Valor |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS del proyecto Supabase CuyInvader |
| `SUPABASE_SERVICE_KEY` | Clave secreta de servidor `service_role`; nunca la clave `anon` ni una clave `sb_publishable` |
| `GAME_SESSION_SECRET` | Secreto aleatorio único de al menos 32 bytes. Genera con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
| `TRUST_PROXY_HOPS` | `1` en Render para que el límite use la IP real detrás del proxy |

En Render conecta el **Web Service** al repositorio y rama correctos, o usa Blueprint con `render.yaml`. Pon `npm ci && npm run build` como **Build Command** y `npm start` como **Start Command**. Render inyecta `PORT`; no fijes uno manual. El servidor escucha en `0.0.0.0`. Las rutas `/`, `/src/`, `/assets/` y `/api/*` salen del mismo origen, así que no se necesita CORS ni un proxy de navegador adicional. Comprueba `/api/ready` y `/api/start-session`: deben responder HTTP 200 con JSON. Un Static Site no ejecuta Node.js; devolver HTML o 404 en esos endpoints indica que se está usando el servicio equivocado o que existe un rewrite externo.

En Render configura `SUPABASE_URL` (URL HTTPS del proyecto), `SUPABASE_SERVICE_KEY` (clave secreta de servidor, nunca `anon`/publishable), `GAME_SESSION_SECRET` (32 bytes aleatorios o más) y `TRUST_PROXY_HOPS=1`. `NODE_VERSION=22` ya está en `render.yaml`; Render proporciona `PORT` automáticamente. Para desarrollo local, define esas variables en `.env`, pon `TRUST_PROXY_HOPS=0` y no subas `.env` a Git.

`npm run build` copia únicamente `index.html`, `style.css`, `src/` y `assets/` a `dist/`, sin empaquetar ni modificar los módulos ES6. Express sirve esa carpeta con `app.use(express.static(frontendRoot, { dotfiles: 'deny', index: 'index.html', redirect: false }))`. La ruta es absoluta y no depende del directorio desde el que se ejecute Node.js. La API se registra antes del middleware estático; las rutas desconocidas de `/api/*` devuelven un 404 JSON, nunca la página del juego. No se copian `.env`, SQL, archivos del servidor, tests ni `node_modules`.

Verifica en Supabase, después de ejecutar la migración: RLS activo, cero filas en `pg_policies` para `public.leaderboard`, ningún SELECT/INSERT permitido a `anon` o `authenticated`. Ejecutar el SQL es un paso de configuración real, distinto de las pruebas locales con cliente simulado.

## Controles

| Acción | Teclado |
| --- | --- |
| Iniciar | `Enter` o `Espacio` |
| Mover la ametralladora | `←` / `→` o `A` / `D` |
| Disparar choclos | Mantener `Espacio` |
| Activar jalapeño | `Q` o `Ctrl`, o su slot del inventario |
| Lanzar choclo misil | `E` o `Shift`, o su slot del inventario |
| Pausar o reanudar | `P` o `Esc` |
| Reiniciar | `R` |
| Ampliar la pantalla durante la partida | Botón **Ampliar** del juego |

En móviles el mundo cambia a formato vertical. Si se gira el teléfono a horizontal, se pausa la partida, se oculta el canvas y se pide volver a vertical; al girarlo de nuevo, el jugador puede continuar desde el menú de pausa.

## Cómo se juega

- El número objetivo de tropas empieza en 36 y aumenta en 4 por oleada hasta 72. Si no caben, se reduce la cantidad antes de generarlas: todas las formas respetan el límite `jugador.y - 96`. Comienzan a 8 píxeles del borde superior (los guardianes ocupan la primera fila), con al menos 12 píxeles entre sprites. Su vida es `1 + floor((oleada - 1) / 3)`; los márgenes laterales iniciales equivalen a 2,5 cabezas por lado.
- Aparecen cuatro guardianes en oleadas 3–4, cinco en oleadas 5–6 y exactamente dos jefes desde la oleada 7. Tienen `10 + 3 × (oleada - 3)` puntos de vida.
- Un guardián aleatorio de cada oleada es un impostor. Al agotar su primera barra crece a 1,8 veces su tamaño, revela una forma oscura con ojos y bordes rojos y recupera `ceil(vida inicial × 2,2)` puntos de vida. Su derrota definitiva vale 600 puntos.
- Desde la oleada 7, cada jefe activo invoca exactamente dos secuaces cada tres segundos. Su HP es el doble del HP de un huaco de esa oleada. Su tamaño parte del 70 % de una tropa y su multiplicador sube un 8 % por oleada hasta 2,2×. Descienden hacia el cuy, pueden destruirse con choclos y causan daño por contacto. No cuentan como guardianes para el jalapeño. La oleada termina cuando no quedan tropas, guardianes ni secuaces.
- La formación cambia suavemente cada **7 segundos** entre **bloque**, **triángulo** y **semiluna**, conservando el reloj entre oleadas y sin contar las pausas. Todas usan la misma franja vertical: cambiar de forma no adelanta el límite inferior hacia el cuy.
- Los guardianes disparan cada **10 segundos** antes de la oleada 7 y cada **7 segundos** desde esa oleada, con un segundo de aviso. Cada salva tiene dos láseres teledirigidos (tres para el impostor revelado). Su giro se limita a 0,72 radianes por segundo y su rastreo dura como máximo **1,5 segundos**; después conservan el rumbo hasta impactar o salir del lienzo.
- Cada cinco guardianes derrotados en total cae un jalapeño. Atrápalo para guardarlo en el inventario; pulsa Q o Ctrl, o el botón 🌶, para activar ocho segundos de disparo triple y rápido de **choclos en llamas**, con aura de fuego. No se activa al recogerlo. La primera fase del impostor no cuenta como una derrota.
- Desde la **oleada 8**, cae una burbuja desde arriba cada **10–15 segundos**, con un intervalo nuevo al azar tras cada caída y un 50 % de probabilidad para cada poder: jalapeño o **choclo misil gigante**. El reloj se conserva entre oleadas y se detiene en las pausas y mejoras. El jugador guarda hasta 3 cargas de cada poder por separado. Los drops excedentes se consumen y dan 100 puntos. Las cargas persisten entre oleadas y se vacían al reiniciar. Q durante el jalapeño activo no consume otra carga.
- El misil se lanza con **E**, **Shift** o el botón del misil y causa **4× el daño actual del choclo** en un área de **3×3 celdas de la formación actual** centrada en el enemigo impactado. Afecta como máximo nueve tropas en tres filas, incluso en triángulo o semiluna y durante las transiciones. Afecta también a guardianes y secuaces; respeta la revelación del impostor, la puntuación y los drops. Su explosión es instantánea y se dibuja durante 0,35 segundos.
- Tienes tres puntos de resistencia. Cada impacto resta uno y concede un instante de invulnerabilidad.
- Al despejar una oleada comienza la siguiente de inmediato, salvo cuando toca elegir una mejora. La formación enemiga se mueve lateralmente un 10 % más rápido en cada oleada. Al rebotar baja 8 píxeles, con un mínimo de tres segundos entre descensos para que los márgenes estrechos no precipiten la derrota.
- Antes de las oleadas **4, 7, 10…**, cuando aumenta la vida de las tropas, el juego ofrece una mejora: **+20 % de velocidad** del cuy o **+1 de daño** por choclo. La partida continúa tras elegir una.
- Si los enemigos alcanzan el valle o te quedas sin resistencia, termina la partida.

## Estructura

```text
.
├── index.html
├── style.css
├── server.js
├── package.json
├── render.yaml
├── backend/ (verificación de replays; no se publica como archivo estático)
├── scripts/build-client.mjs
├── dist/ (generado e ignorado por Git)
├── assets/
└── src/
    ├── main.js
    ├── api.js
    ├── RunReplay.js
    ├── Simulation.js
    ├── Leaderboard.js
    ├── Game.js
    ├── AudioManager.js
    ├── InputHandler.js
    └── entities/
        ├── Player.js
        ├── Enemy.js
        └── Projectile.js
```

`main.js` inicia el bucle de animación; `Game.js` coordina el estado, el puntaje, las colisiones y las oleadas. Las clases en `entities/` manejan el cuy y sus proyectiles, y `InputHandler.js` reúne los controles de teclado y táctiles.

## Hoja de sprites

`assets/sprites-andinos.jpg` contiene la hoja proporcionada para el cuy, choclo, jalapeño, Cabeza Clava y Huaco Retrato. `FRAMES` en `src/Game.js` define los recortes, sin incluir los rótulos. Al cargar, se elimina del recorte el fondo negro conectado a sus bordes; los detalles oscuros internos se conservan. El original permanece intacto.

Cada entidad usa `ctx.drawImage()` y conserva un dibujo con rectángulos de colores si la hoja tarda en cargar o falta. El cuy de la hoja se dibuja sentado en la ametralladora geométrica. Los guardianes usan la Cabeza Clava; el impostor modifica su tamaño y color al revelarse.

## Tecnologías

Cliente: JavaScript puro, módulos ES6 y HTML5 Canvas, sin compilación. Servidor: Node.js, Express, dotenv, Supabase JS, Helmet y express-rate-limit.

## Pruebas de jugabilidad

Ejecuta `npm test`. Las pruebas simulan la física real en móvil y PC, el audio y la API de ranking con un cliente Supabase simulado (no necesitan claves ni escriben en producción). Incluyen firma, vencimiento, reproducción real de partidas de móvil y PC, puntajes manipulados, cambios de tamaño, confirmación tras una respuesta perdida, orden/límite del Top 10, errores, rate limiting por ticket y bloqueo de rutas privadas. La CI de GitHub ejecuta el build y estas pruebas sin credenciales.

## Audio y tarjetas de mejoras

`src/AudioManager.js` usa HTMLAudioElement. El primer gesto del usuario habilita la reproducción. La BGM normal acelera un 1,5 % por oleada hasta 1,35×. Al revelarse un impostor desde la oleada 7 cambia a BGM de jefe; vuelve a la normal cuando muere. Al activar Q/E suenan el efecto y un jingle que atenúa temporalmente la BGM. Pausa, mejoras, derrota y pestaña oculta detienen el audio; el botón SONIDO permite silenciarlo.

Las pistas WAV originales incluidas se sintetizan con `node scripts/generate-audio.mjs`, sin dependencias ni descargas. Se pueden reemplazar por grabaciones propias manteniendo las rutas, o editar el mapa FILES de AudioManager:

- `assets/audio/bgm-normal.wav`, `bgm-boss.wav`, `bgm-powerup.wav`.
- `assets/audio/shoot.wav`, `explosion.wav`, `powerup-collect.wav`, `powerup-use.wav`.

Las tarjetas usan exactamente los PNG suministrados: `assets/upgrade-speed.png` y `assets/upgrade-damage.png`, dentro de botones con `<img>` y `object-fit: contain`. El área completa es clicable y se conserva el modal compacto. Las mejoras siguen siendo +20 % de movimiento o +1 de daño por choclo; el texto artístico de los PNG menciona disparos rápidos y bombas, pero el ataque 3×3 sigue siendo el poder del misil, no una mejora permanente.

La configuración y el procedimiento de rollback están en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). La rama de corrección es `codex/server-session-monolith`; el Blueprint apunta a esa rama y conserva el plan Free.
