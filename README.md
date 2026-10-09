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
| Activar el jalapeño guardado | `Ctrl` o botón del inventario |
| Pausar o reanudar | `P` o `Esc` |
| Reiniciar | `R` |
| Ampliar la pantalla | Botón **Ampliar** del juego |

En móviles el mundo cambia a formato vertical y los botones superpuestos permiten moverse, disparar y activar el jalapeño con varios dedos a la vez. Al girar el dispositivo la partida se pausa y conserva su progreso.

## Cómo se juega

- Las tropas comienzan con 36 enemigos y aumentan en 4 por oleada hasta 72. Su vida es `1 + floor((oleada - 1) / 3)`; los márgenes iniciales equivalen a 2,5 cabezas por lado.
- Aparecen cuatro guardianes desde la oleada 3 y cinco desde la 5. Tienen `10 + 3 × (oleada - 3)` puntos de vida.
- Un guardián aleatorio de cada oleada es un impostor. Al agotar su primera barra crece a 1,8 veces su tamaño, revela una forma violeta y recupera `ceil(vida inicial × 2,2)` puntos de vida. Su derrota definitiva vale 600 puntos.
- La formación cambia suavemente cada 20 segundos entre **bloque**, **triángulo** y **semiluna**.
- Cada diez segundos los guardianes disparan dos láseres teledirigidos (tres para el impostor revelado), con un segundo de aviso. Persiguen continuamente al cuy con velocidad de giro limitada para permitir esquivarlos.
- Cada cinco guardianes derrotados en total cae un jalapeño. Atrápalo para guardarlo en el inventario; pulsa Ctrl o el botón 🌶 para activar ocho segundos de disparo triple y rápido. No se activa al recogerlo. La primera fase del impostor no cuenta como una derrota.
- Tienes tres puntos de resistencia. Cada impacto resta uno y concede un instante de invulnerabilidad.
- Al despejar una oleada comienza la siguiente de inmediato. La formación enemiga se mueve un 10 % más rápido en cada oleada.
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
