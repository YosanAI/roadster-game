import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FlightGame, COURSE } from '../src/game/FlightGame.js';

const STEP = 1 / 120;
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

function land({ yaw = 0, velocity = [0, -1.5, 0], x = -20, z = 6 } = {}) {
  const game = new FlightGame({ flightAssist: false });
  game.stage = 'flight';
  game.inContact = false;
  game.position.set(x, 2, z);
  game.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  game.position.y -= game.getTelemetry().altitude - 0.001;
  game.velocity.fromArray(velocity);
  game.step(STEP);
  return game;
}

function run(game, seconds, input = {}) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP)
    game.step(Math.min(STEP, seconds - elapsed), input);
}

test('safe touchdown keeps pedal driving at the landed position and heading', () => {
  const game = land({ yaw: Math.PI / 3 });
  assert.equal(game.stage, 'success');
  assert.equal(game.inContact, true);
  const result = game.result;
  const snapshot = { ...result };
  const start = game.position.clone();
  const orientation = game.quaternion.clone();
  const forward = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const fuel = game.fuel;
  run(game, 0.5, { throttle: 1, lift: 1, roll: 1, surge: 1 });

  const travel = game.position.clone().sub(start);
  assert.ok(travel.dot(forward) > 1, 'pedal must move along the actual touchdown heading');
  near(travel.clone().addScaledVector(forward, -travel.dot(forward)).length(), 0);
  near(game.position.y, COURSE.rideHeight);
  near(game.quaternion.angleTo(orientation), 0);
  assert.ok(game.driveSpeed > 3);
  assert.equal(game.stage, 'success');
  assert.equal(game.result, result, 'drive-away must retain the original result object');
  assert.deepEqual(game.result, snapshot, 'live ground motion must not rewrite landing metrics');
  assert.equal(game.fuel, fuel, 'ground motor must not consume the thruster gas reserve');
  assert.ok(game.thrusterLevels.every((level) => level === 0));
  assert.equal(game.assist.active, false);
});

test('braking stops the drive-away car and holds it without resetting the attempt', () => {
  const game = land();
  run(game, 0.6, { throttle: 1 });
  assert.ok(game.driveSpeed > 5);
  run(game, 1, { brake: 1 });
  near(game.driveSpeed, 0);
  near(game.velocity.length(), 0);
  const stopped = game.position.clone();
  run(game, 0.7, { brake: 1 });
  near(game.position.distanceTo(stopped), 0);
  assert.equal(game.stage, 'success');
  assert.equal(game.result.safe, true);
});

test('touchdown preserves horizontal momentum and tyre grip settles lateral slip', () => {
  const game = land({ velocity: [2.5, -1.5, 1.2] });
  assert.equal(game.stage, 'success');
  near(game.velocity.x, 2.5);
  near(game.velocity.y, 0);
  near(game.velocity.z, 1.2);
  const start = game.position.clone();
  run(game, 0.5);
  assert.ok(game.position.x > start.x + 1);
  assert.ok(game.position.z > start.z, 'lateral motion must settle over time, not teleport away');
  near(game.velocity.z, 0);
  assert.ok(game.velocity.x > 2 && game.velocity.x < 2.5);
});

test('damaged touchdowns stay terminal and cannot drive away', () => {
  const game = land({ velocity: [2.5, -8, 1.2] });
  assert.equal(game.stage, 'crashed');
  const position = game.position.clone();
  run(game, 1, { throttle: 1, lift: 1 });
  near(game.position.distanceTo(position), 0);
  near(game.driveSpeed, 0);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
});
