# Auditoría de Cuy Invaders — rama del monolito

**Resultado: 58/100, estado riesgoso. El ranking global publicado y el uso del ranking para premios tienen bloqueos pendientes.**

Fecha local: 12 de octubre de 2026. Rama auditada: `codex/server-session-monolith`. Commit del código: `cc0ea08`. Se revisaron cliente ES6, física, controles, audio, HTML/CSS, API, servidor, build, Git, configuración de Render y metadatos de Supabase. Esta auditoría añade únicamente documentación y reproducciones; no modifica el juego, `main`, el despliegue ni datos de producción.

## M01 — P1: la URL publicada no está atendiendo la API del monolito

Las consultas HTTP de lectura a `https://cuyinvader.onrender.com` devolvieron:

| Ruta | HTTP | Respuesta |
| --- | --- | --- |
| `/` | 200 | HTML del juego |
| `/api/health` | 404 | Texto, sin JSON |
| `/api/start-session` | 404 | Texto, sin ticket |
| `/api/scores` | 404 | Texto, sin ranking |
| `/server.js` | 200 | Código JavaScript del backend |
| `/.env` | 404 | No se observó exposición del archivo |

La URL compartida no sirve el monolito de esta rama. La evidencia no permite afirmar que otro Web Service en otra URL esté mal configurado: el bloqueo afecta al origen público comprobado. Publicar archivos del repositorio en un sitio estático no ejecuta las rutas Express. La exposición de `server.js` revela código interno; no se encontró una clave incrustada en ese archivo.

**Acción:** verificar el Web Service correcto y el origen público antes de anunciar ranking global. Debe ejecutar `npm ci && npm run build`, arrancar con `npm start` y servir `dist/`. Comprobar JSON en `/api/health`, `/api/start-session` y `/api/scores`, y 404 en `/server.js`. La configuración local de esta rama ya prepara ese modelo, pero aún no está desplegada.

Referencias: [render.yaml](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/render.yaml:7), [server.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:174).

## M02 — P1: el mínimo temporal rechaza resultados producidos por la física real

`minimumRunDurationMs(3)` exige 45.000 ms. Una simulación del Game Loop real, usando solo dirección -1/0/1 y Space, termina en Game Over antes de ese mínimo. El diagnóstico no cambia posiciones directamente, ni vida, daño o puntuación.

| Canvas | Tiempo de partida | Oleada | Puntaje | Resultado de `POST /api/scores` local |
| --- | --- | --- | --- | --- |
| 1200×800 | 50.974 ms | 3 | 1.900 | 201 |
| 600×800 | 50.616 ms | 3 | 1.900 | 201 |
| 600×500 | 43.783 ms | 3 | 1.400 | **422** |
| 600×400 | 40.466 ms | 3 | 800 | **422** |

El ticket es válido en todos los casos. Los rechazos se deben al mínimo de tiempo, no a Supabase ni a una discrepancia de firma. Un área de juego más corta permite una partida real más breve. El cliente comienza a jugar antes de recibir el ticket; la latencia de emisión también puede reducir el tiempo medido por el servidor.

**Acción:** derivar las cotas de una simulación verificable y contemplar el área de juego y el instante de emisión. Añadir regresiones con estos resultados. Evitar cambiar una cifra arbitraria y considerarla una prueba de legitimidad.

Reproducción: `node audit/monolith-probes.mjs`.
Referencia: [server.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:139).

## M03 — P1 para premios: un ticket firmado no demuestra que se jugó

En un servidor aislado se solicita una sesión, se adelanta el reloj de prueba 120 segundos y se envían 15.000 puntos en oleada 8 sin ejecutar el juego. La API responde **201** y el cliente de base simulado registra el resultado. En 5 segundos la misma pretensión se rechaza con 422.

El HMAC protege UUID y hora de inicio; `score` y `wave` siguen siendo afirmaciones del navegador. Esperar el mínimo y mantenerse dentro de la cota evita el filtro. No se publicaron resultados falsos en Supabase real.

**Acción:** antes de entregar premios, validar una simulación autoritativa o una reproducción de entradas con estado controlado por servidor. Hasta entonces, considerar el ranking casual. No introducir un secreto compartido en el JavaScript público.

Reproducción: `node audit/probes.mjs`, salida `unplayed-score`.
Referencia: [server.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:142).

## M04 — P2: el respaldo local impide recuperar un envío global incierto

Se simula perder la respuesta de un POST después de que la base haya guardado el resultado. El cliente cambia a `sent=true`, abre el ranking local y el segundo intento de `submit()` no realiza otro POST. La reproducción muestra `requests:["POST"]`. El botón «REINTENTAR» del ranking llama a `refresh()`, que solo consulta el Top 10.

Además, «No se publicó en el ranking global» es una afirmación incorrecta cuando la escritura se completó y únicamente se perdió su respuesta. El servidor sí admite reenvío idempotente del mismo ticket y payload; el cliente ya no permite aprovecharlo.

**Acción:** separar «guardado local», «publicado globalmente» y «confirmación pendiente». Conservar el payload del resultado y permitir reintentar el POST idempotente; diferenciar errores permanentes de errores de red, 429 y 503. Para un resultado incierto, no afirmar que la publicación no ocurrió.

Referencias: [Leaderboard.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/Leaderboard.js:252), [respaldo local](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/Leaderboard.js:281).

Reproducción adicional: `node audit/monolith-probes.mjs`, salida `uncertain-save-cannot-retry`, con escritura persistida en un servidor simulado, un solo intento y estado local definitivo.

## M05 — P2: el botón de pantalla completa sigue oculto en móvil

Los media queries esconden `.hud .expand`, incluido el bloque final para ancho máximo de 768 px. `#fullscreen` es el único botón conectado a `toggleFullscreen()`; el botón interno se eliminó anteriormente. Por tanto, el jugador móvil no tiene un botón de pantalla completa dentro del juego.

**Acción:** volver a mostrar y ubicar el botón superior en el HUD compacto, y probarlo en dispositivos donde la Fullscreen API esté disponible. Comprobar también safe areas y teclado virtual en un teléfono real.

Referencia: [style.css](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/style.css:195).

## M06 — P2: las cuotas por IP penalizan un evento con Wi-Fi compartido

El límite es 20 sesiones y 5 guardados por minuto por IP. La reproducción acepta 20 sesiones desde la misma IP y responde 429 a la siguiente. Las pruebas confirman que el sexto guardado recibe 429. Jugadores distintos detrás de la misma red consumen estas cuotas conjuntamente; el respaldo local puede convertir esos rechazos temporales en resultados nunca publicados.

**Acción:** ajustar las cuotas al evento y combinar límites por partida y por IP con reintentos que respeten `Retry-After`. El índice único del ticket ya limita el uso repetido de una partida. Si se añaden réplicas, conectar un store compartido: la fábrica para Redis existe, pero el store actual es memoria del proceso. Mantener una sola instancia Free no exige provisionar un servicio adicional para esta auditoría.

Referencia: [server.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:102).

## M07 — P2: falta el timeout cuando no existe `AbortSignal.any`

Si el llamador aporta `signal` y el navegador no implementa `AbortSignal.any`, el código elige únicamente el signal del llamador y descarta el timeout. Esto ocurre en `getTopScores()` desde `Leaderboard.refresh()`. Una petición puede quedar cargando hasta que se reinicie el juego o termine la conexión.

La reproducción usa un timeout configurado de 5 ms y una respuesta simulada a los 40 ms: la petición se completa pese al plazo, porque utiliza el signal del llamador. No es una prueba contra un servidor de producción.

**Acción:** combinar cancelación y plazo con un AbortController compatible cuando falta `AbortSignal.any`, y limpiar el temporizador y listeners en `finally`.

Reproducción: `node audit/monolith-probes.mjs`, salida `timeout-without-AbortSignal-any`.
Referencia: [src/api.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/api.js:10).

## M08 — P2 de balance: el misil 3×3 afecta demasiadas filas en triángulo

En oleada 8 y canvas 1200×800, el área calculada alcanza 9 tropas/3 filas en bloque, pero **20 tropas/7 filas en triángulo**. `activatePowerUp()` usa el paso vertical del bloque para todas las formaciones; la altura probada de explosión es 406 px. El daño individual y la revelación del impostor sí reutilizan la lógica correcta.

**Acción:** definir si «3×3» significa vecindad lógica o área física. Si debe conservar el tamaño por filas, calcular el paso de la formación vigente. Añadir pruebas del área creada por `activatePowerUp()` en bloque, triángulo y semiluna.

Referencias: [Game.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/Game.js:349), [detonación](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/Game.js:486).

## M09 — P2 operativo: falta readiness y diagnóstico del fallo de Supabase

Con la base simulada caída, `/api/health` devuelve 200 y la lectura de puntajes 503. El endpoint actual comprueba que el proceso está vivo, no que el ranking funciona. Los handlers también descartan errores del SDK sin registrar un código sanitizado o un identificador de petición.

**Acción:** conservar liveness y añadir readiness o una comprobación de conexión/esquema durante el despliegue. Registrar operación, código de error y request ID sin claves, tokens, payloads personales ni mensajes internos sensibles.

Referencias: [health](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:107), [errores de lectura](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:123), [errores de guardado](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/server.js:160).

## Observaciones menores y evidencia pendiente

- **P3, memoria local:** `sessionScores` agrega cada registro a un array sin límite. Los 100 registros de límite solo se aplican a la lista combinada y a persistencia, no al array original. Limitar también el buffer de sesión. Referencia: [Leaderboard.js](C:/Users/YORDAN-TUF/Desktop/YordanDeVp/CuyInvader/src/Leaderboard.js:36).
- No hay workflows de CI versionados en `.github/`; no se verificó un pipeline externo. Añadir build, pruebas y una comprobación HTTP de la versión desplegada, junto con un procedimiento de rollback documentado.
- La configuración efectiva local carece de `SUPABASE_SERVICE_KEY`. Se comprobó que `startServer()` falla antes de arrancar con el mensaje de configuración correspondiente. Esto es un bloqueo del entorno local, no una validación de las variables privadas de Render. No se leyeron ni publicaron claves del panel de Render.
- Falta comprobar un guardado real en Supabase desde un Web Service de pruebas configurado, recuperación real de conexiones interrumpidas, móvil físico/iOS, teclado virtual y carga de participantes detrás de una IP común.
- La consulta de vulnerabilidades de npm fue **offline**: cero avisos en la caché. No se consultó un scanner externo ni se considera una revisión actualizada de todos los avisos.

## Comprobaciones satisfactorias

- **47/47 pruebas pasan**, incluyendo formaciones y descenso en oleadas 4/7/10, invulnerabilidad, láseres limitados a 1,5 s, inventarios, secuaces, audio, firmas, vencimiento, reenvíos, entradas, texto sin XSS y cancelación de respuestas tardías al reiniciar. Los nuevos casos anteriores muestran límites que esa suite todavía no cubre.
- La rama usa rutas relativas; no se encontraron URLs de localhost ni claves privadas en el frontend. La firma HMAC vive en Node.js y el ticket se conserva en memoria del cliente.
- El build copia únicamente `index.html`, `style.css`, `src/` y `assets/` a `dist/`; rechaza enlaces simbólicos y archivos ocultos. En el Express local, las rutas privadas probadas responden 404. El fallback geométrico y los sprites usan la estructura pública correcta.
- Se verificó Supabase CuyInvader mediante consultas de metadatos de solo lectura: columnas `id`, `name`, `score`, `wave`, `created_at`, `run_id`; ya no hay requisito de apellido. RLS activo, ninguna policy y SELECT/INSERT/UPDATE/DELETE denegados a `anon` y `authenticated`. `service_role` dispone solo de SELECT/INSERT. El índice descendente del ranking y el índice único de `run_id` están presentes.
- El único aviso del asesor de seguridad es [RLS habilitado sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), de nivel informativo e intencional para este proxy privado. No crear una política pública para silenciarlo.
- No se observaron claves de producción incrustadas en los archivos de código revisados. `.env`, `supabase/` y `dist/` están ignorados por Git.

## Reproducción y orden recomendado

```bash
npm test
node audit/probes.mjs
node audit/monolith-probes.mjs
npm audit --offline --omit=dev --json
```

Los probes levantan Express exclusivamente en loopback y utilizan bases simuladas; no insertan en Supabase real. Las consultas al sitio publicado fueron GET y las consultas a la base real fueron únicamente SELECT de metadatos.

1. Corregir M02 y M04 con regresiones antes de probar la publicación real de puntajes.
2. Verificar el monolito en un entorno de prueba y el origen público, resolviendo M01 sin exponer la raíz del repositorio.
3. Resolver M05–M09 y probar la red compartida y el móvil físico.
4. Resolver M03 antes de utilizar el ranking para premios. Las firmas de sesión y las cotas temporales no sustituyen una validación de la partida.

La auditoría anterior se conserva en `audit/AUDIT-2026-10-12.md` como historial. Este documento refleja el estado de `cc0ea08` y las comprobaciones realizadas ahora.
