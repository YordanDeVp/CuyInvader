export class InputHandler {
  // Centraliza los controles y permite retirar todos los eventos al destruirse.
  constructor(onAction) {
    this.keys = new Set();
    this.pointers = new Map();
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    const codes = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'Enter', 'KeyP', 'Escape', 'KeyR']);

    // Conservamos las teclas pulsadas: el movimiento no depende del autorepeat.
    window.addEventListener('keydown', (event) => {
      if (!codes.has(event.code) || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // Enter y espacio conservan la activación nativa de los botones enfocados.
      if (event.target.closest?.('button') && ['Enter', 'Space'].includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) onAction(event.code);
    }, options);
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => this.clear(), options);

    // Pointer capture permite soltar fuera del botón sin dejar el control atascado.
    document.querySelectorAll('[data-control]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, button.dataset.control);
        onAction(button.dataset.control);
      }, options);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(name, (event) => this.pointers.delete(event.pointerId), options);
      }
    });
  }

  // Combina teclado y pantalla táctil sin que una fuente borre a la otra.
  isDown(...codes) {
    return codes.some((code) => this.keys.has(code) || [...this.pointers.values()].includes(code));
  }

  // Las direcciones opuestas se cancelan entre sí.
  get direction() {
    return Number(this.isDown('ArrowRight', 'KeyD')) - Number(this.isDown('ArrowLeft', 'KeyA'));
  }

  // Evita movimientos persistentes después de pausar o perder el foco.
  clear() {
    this.keys.clear();
    this.pointers.clear();
  }

  // Permite desmontar el juego sin acumular listeners.
  destroy() {
    this.controller.abort();
    this.clear();
  }
}
