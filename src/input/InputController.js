/** Keyboard bindings express actions; physics never reads browser key codes. */
export const DRIVE_BINDINGS = Object.freeze({
  KeyW: 'pedal',
  ArrowUp: 'pedal',
  KeyS: 'drive-brake',
  ArrowDown: 'drive-brake',
  Space: 'drive-brake',
});

export const FLIGHT_BINDINGS = Object.freeze({
  KeyQ: 'roll-left',
  KeyE: 'roll-right',
  KeyW: 'surge-forward',
  ArrowUp: 'surge-forward',
  KeyS: 'surge-back',
  ArrowDown: 'surge-back',
  KeyA: 'strafe-left',
  ArrowLeft: 'strafe-left',
  KeyD: 'strafe-right',
  ArrowRight: 'strafe-right',
  Space: 'lift',
});

const DRIVE_ACTIONS = new Set(Object.values(DRIVE_BINDINGS));
const SHORTCUTS = ['Enter', 'KeyR', 'KeyC', 'KeyM', 'KeyF', 'KeyT', 'Escape', 'Slash'];
const HANDLED_KEYS = new Set([
  ...Object.keys(DRIVE_BINDINGS),
  ...Object.keys(FLIGHT_BINDINGS),
  ...SHORTCUTS,
]);

/**
 * Combines keyboard and multi-touch buttons into one reusable physics command.
 *
 * getContext() returns { game, paused, helpOpen, resultOpen }. The app owns those values;
 * this controller only owns held input and DOM listeners.
 */
export class InputController {
  constructor({ buttons, getContext, onShortcut, onVisibilityChange }) {
    this.buttons = [...buttons];
    this.getContext = getContext;
    this.onShortcut = onShortcut;
    this.onVisibilityChange = onVisibilityChange;
    this.keys = new Set();
    this.heldCodes = new Set();
    this.blockedKeys = new Set();
    this.pointers = new Map();
    this.buttonKeys = new Map();
    this.events = new AbortController();

    // Keep this object's identity stable: contact can change inside a physics
    // update, and clear() must immediately zero the command used by the loop.
    this.command = { throttle: 0, brake: 0, roll: 0, lift: 0, surge: 0, strafe: 0 };
    this.bindEvents();
  }

  isAvailable(action) {
    const { game, paused, helpOpen, resultOpen } = this.getContext();
    const canDriveAfterLanding = game.stage === 'success' && game.inContact;
    if (
      game.stage === 'ready' ||
      (game.result && !canDriveAfterLanding) ||
      paused ||
      helpOpen ||
      resultOpen
    )
      return false;
    return DRIVE_ACTIONS.has(action) ? game.inContact : !game.inContact;
  }

  syncAvailability() {
    for (const button of this.buttons) {
      button.disabled = !this.isAvailable(button.dataset.action);
    }
  }

  /** Read the current holds once per render frame. Returns the same object. */
  sample() {
    const { game } = this.getContext();
    const active = new Set([...this.pointers.values(), ...this.buttonKeys.values()]);
    const bindings = game.inContact ? DRIVE_BINDINGS : FLIGHT_BINDINGS;
    for (const code of this.keys) {
      if (bindings[code]) active.add(bindings[code]);
    }
    for (const action of active) {
      if (!this.isAvailable(action)) active.delete(action);
    }

    this.command.throttle = Number(active.has('pedal'));
    this.command.brake = Number(active.has('drive-brake'));
    // +Z is the car's left: positive local-X torque lowers that side.
    this.command.roll = Number(active.has('roll-left')) - Number(active.has('roll-right'));
    this.command.lift = Number(active.has('lift'));
    this.command.surge = Number(active.has('surge-forward')) - Number(active.has('surge-back'));
    this.command.strafe = Number(active.has('strafe-right')) - Number(active.has('strafe-left'));
    for (const button of this.buttons) {
      button.classList.toggle('pressed', active.has(button.dataset.action));
    }
    return this.command;
  }

  /**
   * suppressHeld requires a fresh press after either drive/flight mode transition.
   * resetHeld is used when focus/visibility is lost and keyup may never arrive.
   */
  clear({ suppressHeld = false, resetHeld = false } = {}) {
    if (suppressHeld) {
      for (const code of this.heldCodes) this.blockedKeys.add(code);
    }
    this.keys.clear();
    this.pointers.clear();
    this.buttonKeys.clear();
    if (resetHeld) {
      this.heldCodes.clear();
      this.blockedKeys.clear();
    }
    for (const button of this.buttons) button.classList.remove('pressed');
    for (const action of Object.keys(this.command)) this.command[action] = 0;
  }

  bindEvents() {
    const { signal } = this.events;
    for (const button of this.buttons) {
      button.addEventListener(
        'pointerdown',
        (event) => {
          event.preventDefault();
          if (!this.isAvailable(button.dataset.action)) return;
          button.setPointerCapture(event.pointerId);
          this.pointers.set(event.pointerId, button.dataset.action);
        },
        { signal },
      );

      const releasePointer = (event) => {
        this.pointers.delete(event.pointerId);
        button.classList.remove('pressed');
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, releasePointer, { signal });
      }
      button.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
      button.addEventListener(
        'keydown',
        (event) => {
          if (event.code !== 'Enter' && event.code !== 'Space') return;
          event.preventDefault();
          event.stopPropagation();
          if (!this.blockedKeys.has(event.code) && this.isAvailable(button.dataset.action)) {
            this.buttonKeys.set(button, button.dataset.action);
          }
        },
        { signal },
      );
      button.addEventListener(
        'keyup',
        (event) => {
          if (event.code === 'Enter' || event.code === 'Space') {
            event.preventDefault();
            this.buttonKeys.delete(button);
          }
        },
        { signal },
      );
      button.addEventListener('blur', () => this.buttonKeys.delete(button), { signal });
    }

    // Capture also sees Space/Enter consumed by a focused pedal. When that
    // pedal becomes hidden, its autorepeat must not accidentally fire LIFT.
    window.addEventListener(
      'keydown',
      (event) => {
        if (HANDLED_KEYS.has(event.code)) this.heldCodes.add(event.code);
      },
      { capture: true, signal },
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (this.getContext().helpOpen) return;
        if (event.ctrlKey || event.metaKey || event.altKey || !HANDLED_KEYS.has(event.code)) return;
        if (
          (event.code === 'Enter' || event.code === 'Space') &&
          event.target?.tagName === 'BUTTON'
        )
          return;
        event.preventDefault();
        if (this.blockedKeys.has(event.code)) return;
        this.keys.add(event.code);
        if (!event.repeat) this.onShortcut?.(event.code);
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (event) => {
        this.keys.delete(event.code);
        this.heldCodes.delete(event.code);
        this.blockedKeys.delete(event.code);
      },
      { signal },
    );
    window.addEventListener('blur', () => this.clear({ resetHeld: true }), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        this.clear({ resetHeld: true });
        this.onVisibilityChange?.();
      },
      { signal },
    );
  }

  dispose() {
    this.events.abort();
    this.clear({ resetHeld: true });
  }
}
