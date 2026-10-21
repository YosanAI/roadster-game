import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { GameAudio } from '../src/audio/GameAudio.js';
import { FlightGame } from '../src/game/FlightGame.js';

// Observe the actual gain/frequency automation sent to Web Audio without
// creating an AudioContext, playing sound, or relying on browser autoplay.
function parameter() {
  return {
    target: 0,
    calls: 0,
    setTargetAtTime(value) {
      this.target = value;
      this.calls++;
    },
  };
}

function audioHarness() {
  const audio = new GameAudio();
  audio.enabled = true;
  audio.context = { currentTime: 10 };
  audio.motor = { frequency: parameter() };
  audio.motorGain = { gain: parameter() };
  audio.noiseFilter = { frequency: parameter() };
  audio.noiseGain = { gain: parameter() };
  audio.master = { gain: parameter() };
  return audio;
}

function state(overrides = {}) {
  return {
    stage: 'drive',
    inContact: true,
    driveSpeed: 8,
    velocity: new Vector3(8, 0, 0),
    thrusterLevels: new Float32Array(8),
    ...overrides,
  };
}

test('the flat road and safe drive-away have motor sound without suction', () => {
  const audio = audioHarness();
  for (const stage of ['drive', 'success']) {
    for (const driveSpeed of [0, 8]) {
      audio.update(state({ stage, driveSpeed }), {});
      assert.ok(audio.motorGain.gain.target > 0, 'the road motor must remain audible');
      assert.equal(audio.noiseGain.gain.target, 0, 'flat contact must not turn on suction');
    }
  }
});

test('suction begins when the driving car actually reaches the ramp', () => {
  const audio = audioHarness();
  const game = new FlightGame({ flightAssist: false });
  game.start();
  let reachedRamp = false;
  for (let i = 0; i < 1200 && game.inContact; i++) {
    audio.update(game, {});
    if (game.stage === 'drive') assert.equal(audio.noiseGain.gain.target, 0);
    if (game.stage === 'climb') {
      assert.ok(audio.noiseGain.gain.target > 0, 'ramp adhesion should be audible immediately');
      reachedRamp = true;
      break;
    }
    game.step(1 / 120, { throttle: 1 });
  }
  assert.ok(reachedRamp, 'the test must drive onto the real ramp');
  audio.update(state({ stage: 'inverted', driveSpeed: 0 }), {});
  assert.ok(audio.noiseGain.gain.target > 0, 'adhesion stays audible while holding upside down');
});

test('flight noise follows actual thrusters rather than held controls', () => {
  const audio = audioHarness();
  const game = state({ stage: 'flight', inContact: false });
  audio.update(game, { lift: 1, strafe: 1 });
  assert.equal(audio.noiseGain.gain.target, 0, 'requested keys do not invent thrust sound');
  game.thrusterLevels[0] = 1;
  game.thrusterLevels[1] = 0.5;
  audio.update(game, {});
  assert.ok(Math.abs(audio.noiseGain.gain.target - 1.5 * 0.14) < 1e-12);
  assert.equal(audio.noiseFilter.frequency.target, 2200);
  assert.equal(audio.motorGain.gain.target, 0);
});

test('pause, ready, damage and mute suppress continuous driving and thrust audio', async () => {
  const audio = audioHarness();
  for (const stage of ['ready', 'crashed']) {
    audio.update(state({ stage }), {});
    assert.equal(audio.motorGain.gain.target, 0);
    assert.equal(audio.noiseGain.gain.target, 0);
  }
  for (const stage of ['climb', 'inverted', 'flight', 'success']) {
    audio.update(state({ stage, thrusterLevels: new Float32Array(8).fill(1) }), {}, true);
    assert.equal(audio.motorGain.gain.target, 0);
    assert.equal(audio.noiseGain.gain.target, 0);
  }
  audio.update(state({ stage: 'climb' }), {});
  assert.ok(audio.noiseGain.gain.target > 0);
  await audio.setEnabled(false);
  assert.equal(audio.master.gain.target, 0, 'muting silences the complete graph');
  const calls = audio.noiseGain.gain.calls;
  audio.update(state({ stage: 'climb' }), {});
  assert.equal(audio.noiseGain.gain.calls, calls, 'muted updates must not restart audio');
});
