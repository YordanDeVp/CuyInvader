export class InputHandler {
  constructor(onAction) {
    this.keys = new Set();
    this.touches = new Map();
    this.pointers = new Map();
    this.buttons = [...document.querySelectorAll('[data-control]')];
    this.controller = new AbortController();
    const options = { signal: this.controller.signal };
    const codes = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD', 'Space', 'Enter', 'KeyP', 'Escape', 'KeyR', 'ControlLeft', 'ControlRight']);
    window.addEventListener('keydown', (event) => {
      if (!codes.has(event.code) || event.altKey || event.metaKey) return;
      if (event.ctrlKey && ['KeyR', 'KeyP'].includes(event.code)) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.target.closest?.('button') && ['Enter', 'Space'].includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) onAction(event.code);
      this.refreshButtons();
    }, options);
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      this.refreshButtons();
    }, options);
    window.addEventListener('blur', () => this.clear(), options);

    for (const button of this.buttons) {
      const code = button.dataset.control;
      // Un identificador por dedo permite mover y disparar a la vez.
      button.addEventListener('touchstart', (event) => {
        event.preventDefault();
        for (const touch of event.changedTouches) this.touches.set(touch.identifier, code);
        onAction(code);
        this.refreshButtons();
      }, { ...options, passive: false });
      for (const name of ['touchend', 'touchcancel']) {
        button.addEventListener(name, (event) => {
          event.preventDefault();
          for (const touch of event.changedTouches) this.touches.delete(touch.identifier);
          this.refreshButtons();
        }, { ...options, passive: false });
      }
      // Ratón y lápiz usan capture; ignoramos el pointer duplicado de los toques.
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'touch') return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, code);
        onAction(code);
        this.refreshButtons();
      }, options);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(name, (event) => {
          this.pointers.delete(event.pointerId);
          this.refreshButtons();
        }, options);
      }
    }
  }

  isDown(...codes) {
    return codes.some((code) => this.keys.has(code) || [...this.touches.values(), ...this.pointers.values()].includes(code));
  }

  get direction() {
    return Number(this.isDown('ArrowRight', 'KeyD')) - Number(this.isDown('ArrowLeft', 'KeyA'));
  }

  refreshButtons() {
    for (const button of this.buttons) button.classList.toggle('pressed', this.isDown(button.dataset.control));
  }

  clear() {
    this.keys.clear();
    this.touches.clear();
    this.pointers.clear();
    this.refreshButtons();
  }

  destroy() {
    this.controller.abort();
    this.clear();
  }
}
