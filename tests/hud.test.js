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

test('side assist identifies the actual correction and clears the opposite indicator', () => {
  const { ui, game, hud } = createHarness();
  game.assist.active = true;
  game.assist.strafe = 0.6;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /CORRECTING RIGHT/);
  assert.equal(ui['assist-strafe-right'].classList.contains('auto-active'), true);
  assert.equal(ui['assist-strafe-left'].classList.contains('auto-active'), false);

  game.assist.strafe = -0.4;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /CORRECTING LEFT/);
  assert.equal(ui['assist-strafe-left'].classList.contains('auto-active'), true);
  assert.equal(ui['assist-strafe-right'].classList.contains('auto-active'), false);
});

test('inactive, depleted and contact states do not claim the computer is firing', () => {
  const { ui, game, hud } = createHarness();
  game.assist.strafe = 0.7;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /MONITORING/);
  assert.equal(ui['assist-strafe-right'].classList.contains('auto-active'), false);

  game.assist.active = true;
  game.fuel = 0;
  hud.update(game);
  assert.match(ui['assist-status'].textContent, /GAS DEPLETED/);
  assert.equal(ui['assist-indicator'].classList.contains('active'), false);
  assert.equal(ui['assist-strafe-right'].classList.contains('auto-active'), false);

  game.fuel = 100;
  game.stage = 'drive';
  game.inContact = true;
  hud.update(game);
  assert.equal(ui['assist-strafe-right'].classList.contains('auto-active'), false);
});

test('side assistance keeps roll guidance manual', () => {
  const { ui, game, hud } = createHarness();
  const telemetry = game.getTelemetry();
  game.getTelemetry = () => ({ ...telemetry, tiltDegrees: 160 });
  hud.update(game);
  assert.equal(ui['coach-title'].textContent, 'ROLL UPRIGHT');
  assert.match(ui['coach-detail'].textContent, /Q or E/);
});
