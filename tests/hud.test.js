import assert from 'node:assert/strict';
import test from 'node:test';
import { createHud } from '../src/ui/createHud.js';
import { getUiElements } from '../src/ui/elements.js';

function createHarness() {
  const elements = new Map();
  const ui = getUiElements({
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          textContent: '',
          style: {},
          classList: {
            contains: (name) => classes.has(name),
            toggle(name, active) {
              if (active) classes.add(name);
              else classes.delete(name);
            },
          },
        });
      }
      return elements.get(id);
    },
  });
  const game = {
    stage: 'flight',
    inContact: false,
    fuel: 100,
    driveSpeed: 0,
    climbProgress: 1,
    result: null,
    assist: { enabled: true, active: false, roll: 0, strafe: 0 },
    getTelemetry() {
      return {
        altitude: 12,
        descentSpeed: 2,
        verticalSpeed: -2,
        horizontalSpeed: 0,
        tiltDegrees: 0,
        maxLiftAcceleration: 25,
        fuel: this.fuel,
      };
    },
  };
  return { ui, game, hud: createHud(ui) };
}

test('side assist identifies its correction without directional buttons', () => {
  const { ui, game, hud } = createHarness();
  game.assist.active = true;
  game.assist.strafe = 0.6;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /CORRECTING RIGHT/);
  assert.equal(ui['assist-indicator'].classList.contains('active'), true);
  assert.equal('assist-strafe-left' in ui, false);
  assert.equal('assist-strafe-right' in ui, false);

  game.assist.strafe = -0.4;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /CORRECTING LEFT/);
  assert.equal(ui['assist-indicator'].classList.contains('active'), true);
});

test('inactive, depleted and contact states do not claim the computer is firing', () => {
  const { ui, game, hud } = createHarness();
  game.assist.strafe = 0.7;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /MONITORING/);
  assert.equal(ui['assist-indicator'].classList.contains('active'), false);

  game.assist.active = true;
  game.fuel = 0;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /GAS DEPLETED/);
  assert.equal(ui['assist-indicator'].classList.contains('active'), false);

  game.fuel = 100;
  game.stage = 'drive';
  game.inContact = true;
  hud.update(game);
  assert.equal(ui['assist-indicator'].classList.contains('active'), false);
});

test('side assistance keeps roll guidance manual', () => {
  const { ui, game, hud } = createHarness();
  const telemetry = game.getTelemetry();
  game.getTelemetry = () => ({ ...telemetry, tiltDegrees: 160 });
  hud.update(game);
  assert.equal(ui['coach-title'].textContent, 'ROLL UPRIGHT');
  assert.match(ui['coach-detail'].textContent, /Q or E/);
});

test('safe touchdown shows live pedal driving while the menu preserves landing metrics', (t) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { body: { dataset: {}, classList: { add() {} } } },
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  const { ui, game, hud } = createHarness();
  game.stage = 'success';
  game.inContact = true;
  game.driveSpeed = 2.4;
  game.result = { safe: true, impact: 1.8, tiltDegrees: 9 };
  hud.setStage(game, 'drive');
  hud.update(game);
  assert.equal(ui['drive-controls'].hidden, false);
  assert.equal(ui['flight-controls'].hidden, true);
  assert.equal(ui['drive-caption'].textContent, 'DRIVE / GROUND');
  assert.equal(ui['motion-label'].textContent, 'SPEED');
  assert.equal(ui['motion-unit'].textContent, 'km/h');
  assert.equal(ui.descent.textContent, '8.6');
  assert.equal(ui.tilt.textContent, 0);
  assert.equal(ui['coach-title'].textContent, 'LANDED / DRIVE AWAY');
  assert.equal(ui.coach.hidden, false);
  hud.showResult(game.result);
  assert.equal(ui.coach.hidden, true);
  assert.match(ui['result-impact'].innerHTML, /^1\.8 /);
  assert.match(ui['result-tilt'].innerHTML, /^9\.0 /);
});
