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
| Pausar o reanudar | `P` o `Esc` |
| Reiniciar | `R` |
| Ampliar la pantalla | Botón **Ampliar** del juego |

En pantallas táctiles aparecen botones para moverse y disparar.

## Cómo se juega

- Supera una formación de 36 enemigos y tres guardianes con armadura. Los choclos dañan a los enemigos y las barras muestran la resistencia restante de cada jefe.
- La formación cambia suavemente cada 20 segundos entre **bloque**, **triángulo** y **semiluna**.
- Cada guardián anuncia su descarga con un segundo de anticipación. Cada diez segundos, los jefes disparan láseres hacia la posición que ocupaba el cuy al comenzar el aviso; desplázate para esquivarlos.
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

## Sprites opcionales

Coloca los PNG en `assets/` para reemplazar los gráficos geométricos de respaldo:

| Archivo | Gráfico |
| --- | --- |
| `cuy-ametralladora.png` | Cuy sentado en la ametralladora |
| `cuy.png` | Piloto del cuy para la ametralladora de respaldo |
| `choclo.png` | Proyectil del jugador |
| `cabeza-clava.png` | Enemigos de Chavín |
| `huaco.png` | Enemigos Moche |
| `jefe-chavin.png` | Guardianes jefes |

Si falta una imagen o no termina de cargar, el juego dibuja los personajes y proyectiles con rectángulos de colores y puede empezar de inmediato. Para los sprites se recomienda PNG con transparencia y una vista de frente.

## Tecnologías

JavaScript puro, módulos ES6 y HTML5 Canvas. No utiliza bibliotecas externas ni un proceso de compilación.
