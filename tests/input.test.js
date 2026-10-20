import assert from 'node:assert/strict';
import test from 'node:test';
import { InputController } from '../src/input/InputController.js';

const IDLE_COMMAND = Object.freeze({
  throttle: 0,
  brake: 0,
  roll: 0,
  lift: 0,
  surge: 0,
  strafe: 0,
});

// Node's EventTarget has no ancestor tree. Separate capture and bubble targets
// let the tests exercise the controller's real listeners in browser order.
class WindowStub extends EventTarget {
  capture = new EventTarget();

  addEventListener(type, listener, options) {
    if (options?.capture) this.capture.addEventListener(type, listener, options);
    else super.addEventListener(type, listener, options);
  }
}

class ButtonStub extends EventTarget {
  tagName = 'BUTTON';
  disabled = false;
  classes = new Set();
  classList = {
    remove: (name) => this.classes.delete(name),
    toggle: (name, enabled) => {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    },
  };

  constructor(action) {
    super();
    this.dataset = { action };
  }

  setPointerCapture() {}
}

function createHarness(t, actions = []) {
  const window = new WindowStub();
  const document = new EventTarget();
  const previous = new Map();
  for (const [name, value] of Object.entries({ window, document })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }

  const context = {
    game: { stage: 'drive', inContact: true, result: null },
    paused: false,
    helpOpen: false,
  };
  const buttons = Object.fromEntries(actions.map((action) => [action, new ButtonStub(action)]));
  const controller = new InputController({
    buttons: Object.values(buttons),
    getContext: () => context,
  });
  t.after(() => {
    controller.dispose();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  function key(type, code, { target = window, repeat = false } = {}) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    for (const [name, value] of Object.entries({ code, target, repeat })) {
      Object.defineProperty(event, name, { value });
    }
    let stopped = false;
    event.stopPropagation = () => {
      stopped = true;
    };
    window.capture.dispatchEvent(event);
    if (!stopped && target !== window) target.dispatchEvent(event);
    if (!stopped) window.dispatchEvent(event);
    return event;
  }

  function enterFlight() {
    context.game.inContact = false;
    context.game.stage = 'flight';
    // Match the app's stage transition: zero the shared command before hiding
    // and disabling the old buttons, while remembering physical key holds.
    controller.clear({ suppressHeld: true });
    controller.syncAvailability();
  }

  return { controller, buttons, key, enterFlight };
}

test('keyboard commands change from pedal/brake to body-relative thrust in flight', (t) => {
  const { controller, key, enterFlight } = createHarness(t);
  function expectKey(code, command) {
    key('keydown', code);
    assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, ...command }, code);
    key('keyup', code);
    assert.deepEqual(controller.sample(), IDLE_COMMAND, `${code} released`);
  }

  for (const code of ['KeyW', 'ArrowUp']) expectKey(code, { throttle: 1 });
  for (const code of ['KeyS', 'ArrowDown', 'Space']) expectKey(code, { brake: 1 });
  expectKey('KeyQ', {});

  enterFlight();
  for (const code of ['KeyW', 'ArrowUp']) expectKey(code, { surge: 1 });
  for (const code of ['KeyS', 'ArrowDown']) expectKey(code, { surge: -1 });
  for (const code of ['KeyA', 'ArrowLeft']) expectKey(code, { strafe: -1 });
  for (const code of ['KeyD', 'ArrowRight']) expectKey(code, { strafe: 1 });
  expectKey('KeyQ', { roll: 1 });
  expectKey('KeyE', { roll: -1 });
  expectKey('Space', { lift: 1 });
});

test('a held W pedal stays blocked at departure until keyup and a fresh press', (t) => {
  const { controller, key, enterFlight } = createHarness(t);
  key('keydown', 'KeyW');
  const commandUsedByPhysics = controller.sample();
  assert.equal(commandUsedByPhysics.throttle, 1);

  enterFlight();
  assert.equal(controller.command, commandUsedByPhysics, 'command identity must stay stable');
  assert.deepEqual(
    commandUsedByPhysics,
    IDLE_COMMAND,
    'clear must zero the cached command immediately',
  );
  key('keydown', 'KeyW', { repeat: true });
  assert.deepEqual(controller.sample(), IDLE_COMMAND, 'pedal autorepeat must not become surge');

  key('keyup', 'KeyW');
  key('keydown', 'KeyW');
  assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, surge: 1 });
});

test('Space on a focused pedal cannot become lift when departure moves focus', (t) => {
  const { controller, buttons, key, enterFlight } = createHarness(t, ['pedal', 'lift']);
  key('keydown', 'Space', { target: buttons.pedal });
  assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, throttle: 1 });

  enterFlight();
  assert.equal(buttons.pedal.disabled, true);
  assert.equal(buttons.lift.disabled, false);
  buttons.pedal.dispatchEvent(new Event('blur'));

  // Hiding the pedal can move focus to the page while Space keeps repeating.
  key('keydown', 'Space', { repeat: true });
  assert.deepEqual(controller.sample(), IDLE_COMMAND);
  // The same hold must remain blocked if focus then moves to a flight button.
  key('keydown', 'Space', { target: buttons.lift, repeat: true });
  assert.deepEqual(controller.sample(), IDLE_COMMAND);

  key('keyup', 'Space', { target: buttons.lift });
  key('keydown', 'Space');
  assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, lift: 1 });
});

test('independent touch holds retain lift when the roll pointer is cancelled', (t) => {
  const { controller, buttons, enterFlight } = createHarness(t, ['roll-left', 'lift']);
  enterFlight();
  function pointer(action, type, pointerId) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    buttons[action].dispatchEvent(event);
  }

  pointer('roll-left', 'pointerdown', 1);
  pointer('lift', 'pointerdown', 2);
  assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, roll: 1, lift: 1 });
  pointer('roll-left', 'pointercancel', 1);
  assert.deepEqual(controller.sample(), { ...IDLE_COMMAND, lift: 1 });
  pointer('lift', 'lostpointercapture', 2);
  assert.deepEqual(controller.sample(), IDLE_COMMAND);
});
