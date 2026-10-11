# Cuy Invaders

Un arcade de supervivencia inspirado en *Space Invaders*, con sabor andino. Maneja a un cuy sentado en una ametralladora que dispara choclos, derrota guardianes preincas y evita que las reliquias lleguen al valle.

## Jugar

El proyecto no necesita instalar dependencias. Sirve la carpeta del proyecto mediante HTTP para cargar los módulos de JavaScript:

```bash
# Windows (PowerShell o CMD)
py -m http.server 8000

# macOS o Linux
python3 -m http.server 8000
```

Abre [http://localhost:8000](http://localhost:8000) en el navegador. En VS Code también puedes abrir `index.html` con la extensión Live Server.

## Controles

| Acción | Teclado |
| --- | --- |
| Iniciar | `Enter` o `Espacio` |
| Mover la ametralladora | `←` / `→` o `A` / `D` |
| Disparar choclos | Mantener `Espacio` |
| Activar jalapeño | `Q` o su slot del inventario |
| Lanzar choclo misil | `E` o su slot del inventario |
| Pausar o reanudar | `P` o `Esc` |
| Reiniciar | `R` |
| Iniciar en pantalla completa | **Jugar en pantalla completa** en el menú |
| Ampliar la pantalla durante la partida | Botón **Ampliar** del juego |

En móviles el mundo cambia a formato vertical. El gamepad tiene dos direcciones a la izquierda y, a la derecha, Fuego grande debajo de dos poderes circulares con contador. Aparece en una franja debajo del canvas para que los controles no cubran la partida. El botón de pantalla completa solicita ocultar la interfaz del navegador antes de iniciar. Si el navegador no admite la API o rechaza la solicitud, el menú muestra un aviso y permite usar **Jugar**. Al girar el dispositivo la partida se pausa y conserva su progreso.

## Cómo se juega

- El número objetivo de tropas empieza en 36 y aumenta en 4 por oleada hasta 72. Si no caben, se reduce la cantidad antes de generarlas: todas las formas respetan el límite `jugador.y - 96`. Comienzan a 8 píxeles del borde superior (los guardianes ocupan la primera fila), con al menos 12 píxeles entre sprites. Su vida es `1 + floor((oleada - 1) / 3)`; los márgenes laterales iniciales equivalen a 2,5 cabezas por lado.
- Aparecen cuatro guardianes desde la oleada 3 y cinco desde la 5. Tienen `10 + 3 × (oleada - 3)` puntos de vida.
- Un guardián aleatorio de cada oleada es un impostor. Al agotar su primera barra crece a 1,8 veces su tamaño, revela una forma oscura con ojos y bordes rojos y recupera `ceil(vida inicial × 2,2)` puntos de vida. Su derrota definitiva vale 600 puntos.
- Desde la oleada 7, si el impostor sobrevive 12 segundos tras revelarse, invoca cuatro secuaces una sola vez. Descienden hacia el cuy, pueden destruirse con choclos y causan daño por contacto. Su tamaño sube un 8 % por oleada hasta el límite de 2,2×; ganan un punto de vida cada dos oleadas. No cuentan como guardianes para el jalapeño. La oleada termina cuando no quedan tropas, guardianes ni secuaces.
- La formación cambia suavemente cada **7 segundos** entre **bloque**, **triángulo** y **semiluna**, conservando el reloj entre oleadas y sin contar las pausas. Todas usan la misma franja vertical: cambiar de forma no adelanta el límite inferior hacia el cuy.
- Cada **10 segundos** los guardianes disparan dos láseres teledirigidos (tres para el impostor revelado), con un segundo de aviso. Su giro se limita a 0,72 radianes por segundo y su rastreo dura como máximo **1,5 segundos**; después conservan el rumbo hasta impactar o salir del lienzo.
- Cada cinco guardianes derrotados en total cae un jalapeño. Atrápalo para guardarlo en el inventario; pulsa Q o el botón 🌶 para activar ocho segundos de disparo triple y rápido de **choclos en llamas**, con aura de fuego. No se activa al recogerlo. La primera fase del impostor no cuenta como una derrota.
- Desde la **oleada 8**, cae una burbuja desde arriba cada **10–15 segundos**, con un intervalo nuevo al azar tras cada caída y un 50 % de probabilidad para cada poder: jalapeño o **choclo misil gigante**. El reloj se conserva entre oleadas y se detiene en las pausas y mejoras. El jugador guarda hasta 3 cargas de cada poder por separado. Los drops excedentes se consumen y dan 100 puntos. Las cargas persisten entre oleadas y se vacían al reiniciar. Q durante el jalapeño activo no consume otra carga.
- El misil se lanza con **E / botón del misil** y causa **4× el daño actual del choclo** en un área de **3×3 celdas del bloque** centrada en el enemigo impactado. Afecta también a guardianes y secuaces; respeta la revelación del impostor, la puntuación y los drops. Su explosión es instantánea y se dibuja durante 0,35 segundos.
- Tienes tres puntos de resistencia. Cada impacto resta uno y concede un instante de invulnerabilidad.
- Al despejar una oleada comienza la siguiente de inmediato, salvo cuando toca elegir una mejora. La formación enemiga se mueve lateralmente un 10 % más rápido en cada oleada. Al rebotar baja 8 píxeles, con un mínimo de tres segundos entre descensos para que los márgenes estrechos no precipiten la derrota.
- Antes de las oleadas **4, 7, 10…**, cuando aumenta la vida de las tropas, el juego ofrece una mejora: **+20 % de velocidad** del cuy o **+1 de daño** por choclo. La partida continúa tras elegir una.
- Si los enemigos alcanzan el valle o te quedas sin resistencia, termina la partida.

## Estructura

```text
.
├── index.html
├── style.css
├── assets/
└── src/
    ├── main.js
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

JavaScript puro, módulos ES6 y HTML5 Canvas. No utiliza bibliotecas externas ni un proceso de compilación.

## Pruebas de jugabilidad

Con Node.js, ejecuta `node --test tests/gameplay.test.mjs tests/audio.test.mjs`. Las pruebas simulan la física real en móvil y PC: cambios de formación cerca del valle, espaciado y barrera de generación, ritmo de descenso, rastreo a 30/60/120 FPS, temporizador de drops, inventario, daño 3×3, fases del impostor y conservación del progreso hasta la oleada 12.

## Audio y tarjetas de mejoras

`src/AudioManager.js` usa HTMLAudioElement. El primer gesto del usuario habilita la reproducción. La BGM normal acelera un 1,5 % por oleada hasta 1,35×. Al revelarse un impostor desde la oleada 7 cambia a BGM de jefe; vuelve a la normal cuando muere. Al activar Q/E suenan el efecto y un jingle que atenúa temporalmente la BGM. Pausa, mejoras, derrota y pestaña oculta detienen el audio; el botón SONIDO permite silenciarlo.

Las pistas WAV originales incluidas se sintetizan con `node scripts/generate-audio.mjs`, sin dependencias ni descargas. Se pueden reemplazar por grabaciones propias manteniendo las rutas, o editar el mapa FILES de AudioManager:

- `assets/audio/bgm-normal.wav`, `bgm-boss.wav`, `bgm-powerup.wav`.
- `assets/audio/shoot.wav`, `explosion.wav`, `powerup-collect.wav`, `powerup-use.wav`.

Las tarjetas usan exactamente los PNG suministrados: `assets/upgrade-speed.png` y `assets/upgrade-damage.png`, dentro de botones con `<img>` y `object-fit: contain`. El área completa es clicable y se conserva el modal compacto. Las mejoras siguen siendo +20 % de movimiento o +1 de daño por choclo; el texto artístico de los PNG menciona disparos rápidos y bombas, pero el ataque 3×3 sigue siendo el poder del misil, no una mejora permanente.
