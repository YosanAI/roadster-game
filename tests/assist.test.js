import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FlightGame, GRAVITY, LIMITS, VEHICLE } from '../src/game/FlightGame.js';
import { THRUSTERS, getThrusterWrench } from '../src/game/thrusters.js';

const STEP = 1 / 120;
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const near = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

function airborne({ bank = 0, sideways = 0, flightAssist = true } = {}) {
  const game = new FlightGame({ flightAssist });
  game.stage = 'flight';
  game.inContact = false;
  game.position.set(-10, 40, 0);
  game.quaternion.setFromAxisAngle(X, bank);
  game.velocity.z = sideways;
  return game;
}

function run(game, seconds, input = {}) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP)
    game.step(Math.min(STEP, seconds - elapsed), input);
}

test('side assist cancels drift through visible fuel-consuming thrusters', () => {
  const game = airborne({ sideways: 5 });
  game.step(STEP);
  assert.equal(game.assist.enabled, true);
  assert.equal(game.assist.active, true);
  assert.ok(game.assist.strafe > 0, 'positive drift needs the rightward correction jet');
  const active = THRUSTERS.findIndex((t) => t.axis === 'strafe' && t.commandSign === 1);
  near(game.thrusterLevels[active], game.assist.strafe);
  const wrench = getThrusterWrench(game.thrusterLevels);
  near(game.velocity.z, 5 + (wrench.force[2] / VEHICLE.mass) * STEP);
  near(game.fuel, 100 - wrench.totalForce * VEHICLE.fuelPerNewtonSecond * STEP);
  run(game, 2);
  assert.ok(Math.abs(game.velocity.z) < 0.2, 'automatic jets should arrest sideways travel');
  assert.ok(game.fuel < 100);
});

test('side assist compensates banked lift without automatically changing roll', () => {
  const game = airborne({ bank: (35 * Math.PI) / 180 });
  const orientation = game.quaternion.clone();
  run(game, 0.5, { lift: 0.2 });
  assert.ok(game.assist.active, 'the side jet must counter the banked lift force');
  assert.ok(Math.abs(game.velocity.z) < 1e-6, 'banked lift should not silently create side drift');
  near(game.quaternion.angleTo(orientation), 0);
  assert.equal(game.assist.roll, 0, 'side assist must leave roll to the player');
});

test('inverted flight stays inverted until the player rolls', () => {
  const game = airborne();
  game.quaternion.setFromAxisAngle(Z, Math.PI);
  const orientation = game.quaternion.clone();
  run(game, 0.3);
  near(game.quaternion.angleTo(orientation), 0);
  near(game.velocity.y, -GRAVITY * 0.3);
  assert.equal(game.assist.roll, 0);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
  game.step(STEP, { roll: 1 });
  assert.ok(game.angularVelocity.x > 0, 'manual roll must still operate normally');
});

test('manual side input overrides assistance and disabled assist preserves free drift', () => {
  const manual = airborne({ sideways: 3 });
  manual.step(STEP, { strafe: -1 });
  assert.ok(manual.velocity.z > 3, 'the player may intentionally thrust with the drift');
  assert.equal(manual.assist.active, false);
  assert.equal(manual.assist.strafe, 0);

  const disabled = airborne({ sideways: 3, flightAssist: false });
  run(disabled, 0.4);
  near(disabled.velocity.z, 3);
  assert.equal(disabled.fuel, 100);
  assert.equal(disabled.assist.enabled, false);
});

test('assistance respects fuel limits and never invents a force from an empty tank', () => {
  const game = airborne({ sideways: 5 });
  game.fuel = 0.00001;
  game.step(STEP);
  const active = THRUSTERS.findIndex((t) => t.axis === 'strafe' && t.commandSign === 1);
  near(game.assist.strafe, game.thrusterLevels[active]);
  assert.ok(game.fuel >= 0 && game.fuel < 1e-12);
  const speed = game.velocity.z;
  game.step(STEP);
  near(game.velocity.z, speed);
  assert.equal(game.assist.active, false);
  assert.equal(game.assist.strafe, 0);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
});

test('side assistance waits when the jets have no sideways authority', () => {
  const game = airborne({ bank: Math.PI / 2, sideways: 3 });
  run(game, 0.2);
  near(game.velocity.z, 3);
  assert.equal(game.assist.active, false);
  assert.equal(game.fuel, 100, 'vertical side jets must not waste gas trying to cancel side drift');
});

test('reset, road contact and completed landings clear automatic correction indicators', () => {
  const game = airborne({ sideways: 3 });
  game.step(STEP);
  assert.ok(game.assist.active);
  const snapshot = game.getTelemetry().assist;
  snapshot.strafe = 99;
  assert.ok(game.assist.strafe <= 1, 'HUD snapshots must not mutate the simulation');
  game.reset();
  assert.deepEqual(game.assist, { enabled: true, active: false, roll: 0, strafe: 0 });
  game.start();
  game.step(STEP, { throttle: 1 });
  assert.equal(game.assist.active, false);

  const landing = airborne({ sideways: 1 });
  landing.position.y -= landing.getTelemetry().altitude - 0.001;
  landing.velocity.y = -1;
  landing.step(STEP);
  assert.equal(landing.stage, 'success');
  assert.equal(landing.assist.active, false);
  assert.equal(landing.assist.strafe, 0);
});

test('full drives and manually rolled flights land safely with automatic side drift control', async (t) => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    for (const direction of [-1, 1]) {
      await t.test(`${1 / dt} Hz, roll ${direction}`, () => {
        const game = new FlightGame();
        game.start();
        let nextDecision = 0;
        let held = {};
        while (game.inContact && game.time < 30) {
          if (game.time + 1e-7 >= nextDecision) {
            held = { throttle: game.driveSpeed < 8 ? 1 : 0, brake: game.driveSpeed > 10 ? 1 : 0 };
            nextDecision += 0.15;
          }
          game.step(dt, held);
        }
        assert.equal(
          game.stage,
          'flight',
          'the car must leave the actual ramp before the flight check',
        );

        nextDecision = 0;
        let correctedSideways = false;
        while (game.stage === 'flight' && game.flightTime < 10) {
          if (game.flightTime + 1e-7 >= nextDecision) {
            const t = game.getTelemetry();
            const localVelocity = game.velocity
              .clone()
              .applyQuaternion(game.quaternion.clone().invert());
            const upright = t.tiltDegrees < 20;
            const targetDescent = t.altitude > 8 ? 6 : t.altitude > 3 ? 4 : 2;
            held = {
              roll: game.flightTime < 0.9 - 1e-7 ? direction : 0,
              lift: upright && t.descentSpeed > targetDescent ? 1 : 0,
              surge: upright && Math.abs(localVelocity.x) > 2 ? -Math.sign(localVelocity.x) : 0,
            };
            nextDecision += 0.15;
          }
          game.step(dt, held);
          correctedSideways ||= game.assist.active;
          assert.equal(game.assist.roll, 0);
        }
        assert.equal(game.stage, 'success', game.result?.reason);
        assert.ok(correctedSideways, 'the run must exercise automatic lateral correction');
        assert.ok(game.result.impact < LIMITS.impact);
        assert.ok(game.result.fuelRemaining > 0);
      });
    }
  }
});
