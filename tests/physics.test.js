import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import {
  FlightGame,
  COURSE,
  LIMITS,
  GRAVITY,
  VEHICLE,
  MAX_LIFT_ACCELERATION,
} from '../src/game/FlightGame.js';
import { THRUSTERS, getThrusterWrench } from '../src/game/thrusters.js';

const STEP = 1 / 120;
const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≠ ${b}`);

function run(game, seconds, input = {}) {
  for (let elapsed = 0; elapsed < seconds - 1e-9;) {
    const dt = Math.min(STEP, seconds - elapsed);
    game.step(dt, input);
    elapsed += dt;
  }
}

function until(game, predicate, controls = () => ({}), dt = STEP, seconds = 30) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    if (predicate(game)) return;
    game.step(dt, controls(game));
  }
  assert.ok(predicate(game), `Timed out in ${game.stage}, ${JSON.stringify(game.getTelemetry())}`);
}

// A person-like sequence of pedal presses. There is no set-speed API: the
// helper reads the speedometer and holds each full pedal command for 150 ms.
function digitalDriver() {
  let nextDecision = 0;
  let held = { throttle: 0, brake: 0 };
  return (game) => {
    if (game.time + 1e-7 >= nextDecision) {
      held = { throttle: game.driveSpeed < 8 ? 1 : 0, brake: game.driveSpeed > 10 ? 1 : 0 };
      nextDecision += 0.15;
    }
    return held;
  };
}

function manualDeparture(dt = STEP) {
  const game = new FlightGame({ flightAssist: false });
  assert.equal(game.start(), true);
  until(game, (g) => !g.inContact, digitalDriver(), dt);
  assert.equal(game.stage, 'flight');
  return game;
}

function atTop() {
  const game = new FlightGame({ flightAssist: false });
  game.resetAtTop();
  return game;
}

function falling({ inverted = false, x = -10, y = 12, z = 0 } = {}) {
  const game = new FlightGame({ flightAssist: false });
  game.stage = 'flight';
  game.inContact = false;
  game.position.set(x, y, z);
  game.quaternion.setFromAxisAngle(Z, inverted ? Math.PI : 0);
  return game;
}

function touchdown({ tilt = 0, impact = 2, sideways = 0, spin = 0, x = -5, z = 0 } = {}) {
  const game = falling({ x, y: 5, z });
  game.quaternion.setFromAxisAngle(Z, (tilt * Math.PI) / 180);
  game.position.y -= game.getTelemetry().altitude - 0.002;
  game.velocity.set(sideways, -impact, 0);
  game.angularVelocity.set(spin, 0, 0);
  game.fuel = spin > 0 ? 0 : 100;
  game.step(STEP);
  return game;
}

// Every flight command is a fully pressed or released button. Decisions are
// held for 150 ms; this does not synthesize an analogue throttle at frame rate.
function digitalFlightPilot(direction = 1) {
  let nextDecision = 0;
  let held = { roll: 0, lift: 0, surge: 0, strafe: 0 };
  let usedHorizontal = false;
  let departureHeading = null;
  const control = (game) => {
    const forward = X.clone().applyQuaternion(game.quaternion);
    departureHeading ??= forward.clone();
    // Roll changes the bank angle without introducing pitch or yaw rotation.
    near(forward.distanceTo(departureHeading), 0, 1e-7);
    if (game.flightTime + 1e-7 >= nextDecision) {
      const t = game.getTelemetry();
      const localVelocity = game.velocity.clone().applyQuaternion(game.quaternion.clone().invert());
      const upright = t.tiltDegrees < 20;
      const targetDescent = t.altitude > 8 ? 6 : t.altitude > 3 ? 4 : 2;
      held = {
        roll: t.flightTime < 0.9 - 1e-7 ? direction : 0,
        lift: upright && t.descentSpeed > targetDescent ? 1 : 0,
        surge: upright && Math.abs(localVelocity.x) > 2 ? -Math.sign(localVelocity.x) : 0,
        // Positive strafe fires toward local -Z, to the driver's right.
        strafe: upright && Math.abs(localVelocity.z) > 1 ? Math.sign(localVelocity.z) : 0,
      };
      usedHorizontal ||= held.surge !== 0 || held.strafe !== 0;
      nextDecision += 0.15;
    }
    for (const value of Object.values(held)) assert.ok(value === -1 || value === 0 || value === 1);
    assert.ok(held.lift >= 0);
    return held;
  };
  control.usedHorizontal = () => usedHorizontal;
  return control;
}

test('eight actuator groups have the required one-way resultant force directions', () => {
  assert.equal(THRUSTERS.length, 8);
  assert.equal(new Set(THRUSTERS.map((t) => t.id)).size, 8);
  assert.equal(THRUSTERS.filter((t) => t.kind === 'lift').length, 4);
  assert.equal(THRUSTERS.filter((t) => t.kind === 'horizontal').length, 4);
  for (const t of THRUSTERS) {
    if (t.kind === 'lift') assert.deepEqual(t.forceDirection, [0, 1, 0]);
    else assert.equal(t.forceDirection[1], 0);
  }
  near(MAX_LIFT_ACCELERATION, 40000 / VEHICLE.mass);
});

test('gravity alone is exactly 9.8 m/s² with no departure kick or time scaling', () => {
  assert.equal(GRAVITY, 9.8);
  const game = atTop();
  const initialY = game.position.y;
  assert.equal(game.release(), true);
  near(game.velocity.length(), 0);
  run(game, 0.5);
  near(game.velocity.y, -GRAVITY * 0.5);
  near(game.position.y, initialY - 0.5 * GRAVITY * 0.5 ** 2);
  near(game.fuel, 100);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
});

test('start waits for the accelerator and pedal force increases speed gradually', () => {
  const game = new FlightGame({ flightAssist: false });
  game.start();
  run(game, 3);
  assert.equal(game.stage, 'drive');
  assert.equal(game.inContact, true);
  near(game.position.x, COURSE.startX);
  near(game.driveSpeed, 0);
  game.step(STEP, { throttle: 1 });
  assert.ok(game.driveSpeed > 0 && game.driveSpeed < 0.2);
  const firstSpeed = game.driveSpeed;
  run(game, 0.3, { throttle: 1 });
  assert.ok(game.driveSpeed > firstSpeed + 3);
  assert.ok(game.driveSpeed < (VEHICLE.maxMotorForce / VEHICLE.mass) * 0.32);
  near(game.fuel, 100);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
});

test('brakes stop the moving car and hold it still', () => {
  const game = new FlightGame({ flightAssist: false });
  game.start();
  run(game, 0.8, { throttle: 1 });
  assert.ok(game.driveSpeed > 8);
  run(game, 1.5, { brake: 1 });
  near(game.driveSpeed, 0);
  const stopped = game.position.clone();
  run(game, 2, { brake: 1 });
  near(game.position.distanceTo(stopped), 0);
});

test('gravity acts along the climb, while wheel brakes can hold the car on the wall', () => {
  const game = new FlightGame({ flightAssist: false });
  game.start();
  until(game, (g) => g.position.y > 8, digitalDriver());
  run(game, 0.8, { brake: 1 });
  assert.equal(game.stage, 'climb');
  near(game.driveSpeed, 0);
  const heldPosition = game.position.clone();
  run(game, 1, { brake: 1 });
  near(game.position.distanceTo(heldPosition), 0);
  run(game, 0.3);
  assert.ok(game.driveSpeed < -1);
  assert.ok(game.position.y < heldPosition.y);
});

test('retry starts stopped on the inverted lip and requires actual driving to leave', () => {
  const game = atTop();
  assert.equal(game.stage, 'inverted');
  assert.equal(game.inContact, true);
  near(game.position.x, COURSE.releaseX);
  near(game.position.y, 2 * COURSE.radiusY - COURSE.rideHeight);
  assert.ok(UP.clone().applyQuaternion(game.quaternion).y < -0.999999);
  run(game, 2, { brake: 1 });
  near(game.driveSpeed, 0);
  near(game.position.x, COURSE.releaseX);
  until(
    game,
    (g) => !g.inContact,
    () => ({ throttle: 1 }),
  );
  assert.equal(game.stage, 'flight');
  assert.ok(game.position.x <= COURSE.topEndX - 1.45 + 1e-6);
  assert.ok(game.velocity.x < -1);
  near(game.velocity.y, -GRAVITY * game.flightTime, 1e-7);
});

test('manual road driving climbs the whole wall and naturally loses contact at the edge', () => {
  const game = manualDeparture();
  assert.equal(game.inContact, false);
  assert.ok(game.driveSpeed > 3);
  assert.ok(game.position.x <= COURSE.topEndX - 1.45 + 1e-6);
  near(game.velocity.x, -game.driveSpeed, 1e-7);
  near(game.velocity.y, -GRAVITY * game.flightTime, 1e-7);
  near(
    game.position.y,
    2 * COURSE.radiusY - COURSE.rideHeight - 0.5 * GRAVITY * game.flightTime ** 2,
    1e-7,
  );
});

test('symmetric lift produces full upward force and no rotation', () => {
  const game = falling();
  game.step(STEP, { lift: 1 });
  assert.deepEqual(Array.from(game.thrusterLevels.slice(0, 4)), [1, 1, 1, 1]);
  const wrench = getThrusterWrench(game.thrusterLevels);
  assert.deepEqual(wrench.force, [0, 40000, 0]);
  assert.deepEqual(wrench.torque, [0, 0, 0]);
  near(game.angularVelocity.length(), 0);
  near(game.velocity.y, (MAX_LIFT_ACCELERATION - GRAVITY) * STEP);
});

test('both roll directions fire a lift pair and produce real force and r×F torque', () => {
  for (const direction of [-1, 1]) {
    const game = falling();
    game.step(STEP, { roll: direction });
    const wrench = getThrusterWrench(game.thrusterLevels);
    assert.equal(game.thrusterLevels.filter((level) => level > 0).length, 2);
    assert.equal(wrench.force[1], 20000);
    near(wrench.torque[0], direction * 12800);
    near(wrench.torque[1], 0);
    near(wrench.torque[2], 0);
    near(game.angularVelocity.x, (wrench.torque[0] / VEHICLE.rollInertia) * STEP);
    near(100 - game.fuel, wrench.totalForce * VEHICLE.fuelPerNewtonSecond * STEP);
  }
});

test('roll plus lift reduces one pair and releasing roll uses the opposite lift pair to brake', () => {
  const combined = falling();
  combined.step(STEP, { lift: 1, roll: 1 });
  assert.deepEqual(Array.from(combined.thrusterLevels.slice(0, 4)), [0, 0, 1, 1]);
  const braking = falling();
  braking.angularVelocity.x = 2;
  const beforeFuel = braking.fuel;
  braking.step(STEP);
  const wrench = getThrusterWrench(braking.thrusterLevels);
  assert.ok(braking.thrusterLevels[0] > 0 && braking.thrusterLevels[1] > 0);
  near(braking.thrusterLevels[2], 0);
  near(braking.thrusterLevels[3], 0);
  assert.ok(wrench.force[1] > 0 && wrench.torque[0] < 0);
  assert.ok(braking.angularVelocity.x < 2 && braking.angularVelocity.x > 0);
  assert.ok(braking.fuel < beforeFuel);
});

test('an inverted roll burn adds downward world acceleration; empty tanks supply no hidden torque', () => {
  const burning = falling({ inverted: true });
  const coasting = falling({ inverted: true });
  burning.step(STEP, { roll: 1 });
  coasting.step(STEP);
  assert.ok(burning.velocity.y < coasting.velocity.y);
  const empty = falling();
  empty.fuel = 0;
  empty.angularVelocity.x = 2;
  run(empty, 0.2, { roll: -1, lift: 1 });
  near(empty.angularVelocity.x, 2);
  near(empty.velocity.y, -GRAVITY * 0.2);
  assert.ok(empty.thrusterLevels.every((level) => level === 0));
});

test('horizontal controls supply only local X/Z forces and rotate with the car', () => {
  for (const [axis, command] of [
    ['surge', 1],
    ['surge', -1],
    ['strafe', 1],
    ['strafe', -1],
  ]) {
    const game = falling();
    game.quaternion.setFromAxisAngle(X, 0.4);
    const initialOrientation = game.quaternion.clone();
    game.step(STEP, { [axis]: command });
    const wrench = getThrusterWrench(game.thrusterLevels);
    near(wrench.force[1], 0);
    assert.deepEqual(wrench.torque, [0, 0, 0]);
    assert.ok(game.thrusterLevels.slice(0, 4).every((level) => level === 0));
    const expectedAcceleration = new Vector3()
      .fromArray(wrench.force)
      .applyQuaternion(initialOrientation)
      .divideScalar(VEHICLE.mass);
    expectedAcceleration.y -= GRAVITY;
    near(game.velocity.distanceTo(expectedAcceleration.multiplyScalar(STEP)), 0);
    near(game.angularVelocity.length(), 0);
  }
});

test('flight wheel braking and removed pitch controls do not create forces or rotation', () => {
  const commanded = falling();
  const untouched = falling();
  commanded.velocity.set(-8, -1, 2);
  untouched.velocity.copy(commanded.velocity);
  run(commanded, 0.2, { brake: 1, pitch: 1 });
  run(untouched, 0.2);
  near(commanded.position.distanceTo(untouched.position), 0);
  near(commanded.velocity.distanceTo(untouched.velocity), 0);
  near(commanded.quaternion.angleTo(untouched.quaternion), 0);
  near(commanded.braking, 0);
  near(commanded.fuel, 100);
});

test('a gentle level landing succeeds, including outside the painted target', () => {
  assert.equal(touchdown().stage, 'success');
  assert.equal(touchdown({ tilt: 12 }).stage, 'success');
  const apron = touchdown({ z: 10 });
  assert.equal(apron.stage, 'success');
  assert.equal(apron.result.onRoad, false);
});

test('hard, tilted, inverted, sideways and spinning contacts cause damage', () => {
  assert.equal(touchdown({ impact: 8 }).result.reasonCode, 'impact');
  assert.equal(touchdown({ tilt: 18 }).result.reasonCode, 'orientation');
  assert.equal(touchdown({ tilt: 180 }).result.reasonCode, 'orientation');
  assert.equal(touchdown({ tilt: 90 }).result.reasonCode, 'orientation');
  assert.equal(touchdown({ sideways: 12 }).result.reasonCode, 'lateral');
  assert.equal(touchdown({ spin: 2 }).result.reasonCode, 'spin');
});

test('doing nothing after departure crashes upside down', () => {
  const game = manualDeparture();
  until(game, (g) => g.stage === 'success' || g.stage === 'crashed');
  assert.equal(game.stage, 'crashed');
  assert.equal(game.result.reasonCode, 'orientation');
});

test('digital pedals, roll, lift and horizontal jets complete the whole game in real time', () => {
  for (const direction of [-1, 1]) {
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      const game = manualDeparture(dt);
      const pilot = digitalFlightPilot(direction);
      until(game, (g) => g.stage === 'success' || g.stage === 'crashed', pilot, dt);
      assert.equal(
        game.stage,
        'success',
        `roll ${direction}, dt ${dt}: ${JSON.stringify(game.result)}`,
      );
      assert.ok(pilot.usedHorizontal());
      assert.ok(game.result.impact < LIMITS.impact);
      assert.ok(game.result.fuelRemaining > 0);
    }
  }
});

test('ramp collisions still fail and reset clears all drive and flight state', () => {
  const game = falling({ x: COURSE.rampX + COURSE.radiusX - 0.1, y: COURSE.radiusY });
  game.velocity.set(2, 0, 0);
  game.step(STEP);
  assert.equal(game.stage, 'crashed');
  assert.equal(game.result.reasonCode, 'ramp');
  game.reset();
  assert.equal(game.stage, 'ready');
  assert.equal(game.inContact, true);
  assert.equal(game.result, null);
  near(game.fuel, 100);
  near(game.driveSpeed, 0);
  near(game.flightTime, 0);
  near(game.position.x, COURSE.startX);
  assert.ok(game.thrusterLevels.every((level) => level === 0));
});
