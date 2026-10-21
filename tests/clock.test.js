import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightGame, GRAVITY } from '../src/game/FlightGame.js';
import { advanceSimulation } from '../src/game/advanceSimulation.js';

function freeFall() {
  const game = new FlightGame({ flightAssist: false });
  game.stage = 'flight';
  game.inContact = false;
  game.position.set(-10, 40, 0);
  return game;
}

const near = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
};

test('irregular render frames consume a full second of physical gravity', () => {
  const irregular = freeFall();
  const regular = freeFall();
  for (const seconds of [0.13, 0.07, 0.2, 0.016, 0.084, 0.3, 0.2]) {
    advanceSimulation(irregular, {}, seconds);
  }
  for (let frame = 0; frame < 120; frame++) advanceSimulation(regular, {}, 1 / 120);
  near(irregular.flightTime, 1);
  near(irregular.velocity.y, -GRAVITY);
  near(irregular.position.y, 40 - GRAVITY / 2);
  near(irregular.position.distanceTo(regular.position), 0);
});

test('pause stops physics, and optional half-speed affects flight only', () => {
  const flight = freeFall();
  near(advanceSimulation(flight, {}, 1, { paused: true }), 0);
  near(flight.position.y, 40);
  near(advanceSimulation(flight, {}, 1, { slowMotion: true }), 0.5);
  near(flight.velocity.y, -GRAVITY * 0.5);
  near(flight.position.y, 40 - 0.5 * GRAVITY * 0.5 ** 2);

  const normalDrive = new FlightGame({ flightAssist: false });
  const slowDrive = new FlightGame({ flightAssist: false });
  normalDrive.start();
  slowDrive.start();
  advanceSimulation(normalDrive, { throttle: 1 }, 1);
  advanceSimulation(slowDrive, { throttle: 1 }, 1, { slowMotion: true });
  near(normalDrive.position.distanceTo(slowDrive.position), 0);
  near(normalDrive.driveSpeed, slowDrive.driveSpeed);
});

test('a contact transition clears the shared command before later steps in the frame', () => {
  const samples = [];
  const command = { throttle: 1 };
  const game = {
    stage: 'drive',
    step(_dt, input) {
      samples.push(input.throttle);
      this.stage = 'flight';
    },
  };
  advanceSimulation(game, command, 0.1, {
    onStep: () => {
      command.throttle = 0;
    },
  });
  assert.deepEqual(samples, [1, 0, 0]);
});
