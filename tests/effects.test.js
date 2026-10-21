import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { THRUSTERS } from '../src/game/thrusters.js';
import { createEffects } from '../src/scene/createEffects.js';
import { createSmokePool } from '../src/scene/createSmokePool.js';
import { createRoadster } from '../src/scene/createRoadster.js';

// Exercise the renderer-facing particle buffers without requiring a WebGL
// context. No DOM, road meshes or physics integration are needed for emission.
function createHarness({ height = 1.2, roll = 0, active = [], car = new Group() } = {}) {
  const scene = new Scene();
  car.position.y = height;
  car.rotation.x = roll;
  car.userData.thrusters ||= THRUSTERS.map((definition) => {
    const mesh = new Object3D();
    mesh.position.set(...definition.position);
    mesh.material = { opacity: 0 };
    car.add(mesh);
    return {
      ...definition,
      mesh,
      direction: new Vector3(...definition.forceDirection).negate(),
    };
  });
  scene.add(car);
  const game = {
    stage: 'flight',
    inContact: false,
    velocity: new Vector3(),
    thrusterLevels: new Float32Array(THRUSTERS.length),
  };
  for (const index of active) game.thrusterLevels[index] = 1;
  const effects = createEffects(scene);
  const smoke = scene.getObjectByName('thruster-smoke-pool');
  assert.ok(smoke, 'effects must register the smoke render object');

  function advance(seconds, input = {}, dt = 1 / 60) {
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
      effects.update(Math.min(dt, seconds - elapsed), game, car, input);
    }
  }

  function particles(kind) {
    const geometry = smoke.geometry;
    const position = geometry.getAttribute('aOffset');
    const size = geometry.getAttribute('aSize');
    const alpha = geometry.getAttribute('aAlpha');
    const kinds = geometry.getAttribute('aKind');
    const result = [];
    for (let i = 0; i < geometry.instanceCount; i++) {
      if (alpha.getX(i) < 0.001 || (kind !== undefined && kinds.getX(i) !== kind)) continue;
      result.push({
        x: position.getX(i),
        y: position.getY(i),
        z: position.getZ(i),
        size: size.getX(i),
        alpha: alpha.getX(i),
      });
    }
    return result;
  }

  return { scene, car, game, effects, smoke, advance, particles };
}

test('smoke follows actual actuator output rather than held input commands', () => {
  const h = createHarness({ height: 20 });
  h.advance(1, { lift: 1, roll: 1, surge: 1, strafe: 1 });
  assert.equal(h.particles().length, 0, 'commands without valve output must not invent smoke');

  h.game.thrusterLevels[0] = 1;
  const before = Array.from(h.game.thrusterLevels);
  h.advance(0.1);
  const exhaust = h.particles(0);
  assert.ok(exhaust.length > 0, 'actual output must produce exhaust without input commands');
  assert.ok(
    exhaust.every((p) => Math.abs(p.x - THRUSTERS[0].position[0]) < 1 && p.z > 0),
    'only the active front-left nozzle should emit',
  );
  assert.equal(h.particles(1).length, 0, 'a high-altitude burn must not create ground smoke');
  assert.deepEqual(Array.from(h.game.thrusterLevels), before);
  assert.deepEqual(h.game.velocity.toArray(), [0, 0, 0], 'visual effects must not apply forces');
});

test('ground smoke requires an active exhaust ray reaching the ground in world space', () => {
  const upright = createHarness({ active: [0, 1, 2, 3] });
  upright.advance(0.7);
  assert.ok(upright.particles(1).length > 0, 'airborne downward lift must disturb the ground');

  for (const options of [
    { roll: Math.PI, active: [0, 1, 2, 3] },
    { height: 25, active: [0, 1, 2, 3] },
    { active: [4] },
  ]) {
    const h = createHarness(options);
    h.advance(0.7);
    assert.ok(h.particles(0).length > 0, 'the active nozzle must still produce exhaust');
    assert.equal(h.particles(1).length, 0, 'upward, distant or horizontal jets miss the ground');
  }
});

test('a banked horizontal nozzle disturbs the ground only when its exhaust points down', () => {
  const down = createHarness({ roll: Math.PI / 2, active: [6] });
  down.advance(0.7);
  assert.ok(down.particles(1).length > 0, 'a sideways nozzle becomes downward when banked');

  const up = createHarness({ roll: Math.PI / 2, active: [7] });
  up.advance(0.7);
  assert.ok(up.particles(0).length > 0);
  assert.equal(up.particles(1).length, 0, 'the opposite banked nozzle points away from the road');
});

test('forward and reverse thrust each drive the four rear outlets from one valve group', () => {
  const h = createHarness({ height: 20, car: createRoadster({ detailed: false }) });
  assert.equal(h.car.userData.thrusters.length, THRUSTERS.length);
  for (const index of [4, 5]) {
    h.effects.reset();
    h.game.thrusterLevels.fill(0);
    h.game.thrusterLevels[index] = 1;
    h.advance(0.15);
    const activeOutlets = h.car.userData.thrusters[index].outlets;
    assert.equal(activeOutlets?.length, 4, 'longitudinal thrust must use four visible outlets');
    for (const outlet of activeOutlets) {
      assert.ok(outlet.mesh.position.x < -2, 'both directions must exit at the rear housings');
      assert.equal(outlet.mesh.visible, true);
      assert.ok(
        index === 4 ? outlet.direction.x < 0 : outlet.direction.x > 0,
        'reverse deflectors must redirect the exhaust instead of inventing a front nozzle',
      );
      assert.ok(
        h.particles(0).some((p) => {
          const offset = new Vector3(p.x, p.y, p.z).sub(h.car.position).sub(outlet.mesh.position);
          const distance = offset.dot(outlet.direction);
          const across = offset.addScaledVector(outlet.direction, -distance).length();
          return distance > 0.1 && distance < 5 && across < 0.12;
        }),
        'each rear outlet must emit its own vapor stream',
      );
    }
    for (const [otherIndex, emitter] of h.car.userData.thrusters.entries()) {
      if (otherIndex === index) continue;
      for (const outlet of emitter.outlets || [emitter]) assert.equal(outlet.mesh.visible, false);
    }
    assert.ok(h.particles(0).length > 0);
  }

  h.effects.reset();
  for (const emitter of h.car.userData.thrusters) {
    for (const outlet of emitter.outlets || [emitter]) assert.equal(outlet.mesh.visible, false);
  }
});

test('smoke sorts across all kinds using the current camera pose after an orbit', () => {
  const scene = new Scene();
  const pool = createSmokePool(scene);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 2, 12);
  camera.lookAt(0, 2, 0);
  for (const [kind, z] of [
    [0, -5],
    [1, 0],
    [2, 5],
  ]) {
    pool.spawn(new Vector3(0, 2, z), new Vector3(), {
      life: 5,
      size: 1,
      alpha: 0.5,
      kind,
    });
  }
  const geometry = scene.getObjectByName('thruster-smoke-pool').geometry;
  const depths = () =>
    Array.from({ length: geometry.instanceCount }, (_, i) =>
      geometry.getAttribute('aOffset').getZ(i),
    );
  pool.update(0.1, camera);
  const firstView = depths();
  assert.equal(firstView.length, 3);
  assert.ok(firstView[0] < firstView[1] && firstView[1] < firstView[2]);

  // CameraRig sets position/lookAt before effects.update, while WebGLRenderer
  // normally updates camera matrices afterward. Smoke must use the new pose.
  camera.position.z = -12;
  camera.lookAt(0, 2, 0);
  pool.update(0.1, camera);
  const reversedView = depths();
  assert.ok(
    reversedView[0] > reversedView[1] && reversedView[1] > reversedView[2],
    'moving behind the cloud must reverse its draw order immediately',
  );
});

test('orbiting while paused reorders smoke without emitting or aging the cloud', () => {
  const h = createHarness({ height: 20, active: [0, 2] });
  h.advance(0.5);
  const snapshot = () =>
    h
      .particles()
      .map((particle) => JSON.stringify(particle))
      .sort();
  const frozenCloud = snapshot();
  assert.ok(frozenCloud.length > 1);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 15, 12);
  camera.lookAt(0, 15, 0);
  h.effects.update(0, h.game, h.car, {}, camera);
  let positions = h.particles().map((particle) => particle.z);
  assert.ok(positions.every((z, i) => i === 0 || positions[i - 1] <= z));

  camera.position.z = -12;
  camera.lookAt(0, 15, 0);
  h.effects.update(0, h.game, h.car, {}, camera);
  positions = h.particles().map((particle) => particle.z);
  assert.ok(positions.every((z, i) => i === 0 || positions[i - 1] >= z));
  assert.deepEqual(snapshot(), frozenCloud, 'paused updates must preserve every cloud particle');
});

test('ground wash spreads quickly as light vapor and clears after a short lingering tail', () => {
  const h = createHarness({ active: [0, 1, 2, 3] });
  h.advance(0.6);
  const cloud = h.particles(1);
  assert.ok(cloud.length > 0);
  assert.ok(
    cloud.every((p) => p.alpha < 0.4),
    'individual outwash wisps should remain translucent rather than resemble thick fire smoke',
  );

  h.game.thrusterLevels.fill(0);
  h.advance(1.2);
  const lingering = h.particles(1);
  assert.ok(lingering.length > 0, 'the outward wash should linger after the valves close');
  assert.ok(
    lingering.some((p) => Math.hypot(p.x, p.z) > 5),
    'the wash must travel outward promptly instead of accumulating around the body',
  );
  h.advance(3);
  assert.equal(h.particles().length, 0, 'vapor should clear within a few seconds of cutoff');
});

test('plentiful ground vapor expands above the car while individual wisps stay thin', () => {
  const h = createHarness({ active: [0, 1, 2, 3] });
  h.advance(0.8);
  const cloud = h.particles(1);
  const heightRatio = h.smoke.material.uniforms.groundAspect.value.y;
  const enveloping = cloud.filter(
    (p) =>
      Math.abs(p.x) < 2.5 + p.size / 2 &&
      Math.abs(p.z) < 1 + p.size / 2 &&
      p.y + (p.size * heightRatio) / 2 > h.car.position.y + 0.6,
  );
  assert.ok(enveloping.length > 10, 'many expanding wisps must surround and reach above the body');
  assert.ok(
    cloud.some((p) => Math.abs(p.x) < 2.5 && Math.abs(p.z) < 1.5 && p.y > h.car.position.y),
    'entrained gas must roll up through the body envelope, not leave a clear central hole',
  );
  assert.ok(
    cloud.every((p) => p.alpha < 0.4),
    'volume must come from overlapping translucent gas',
  );
  h.game.thrusterLevels.fill(0);
  h.advance(2.5);
  assert.equal(h.particles().length, 0, 'the full cloud must dissipate promptly after cutoff');
});

test('a fast-falling car retains a continuous jet close to the moving nozzle at low frame rates', (t) => {
  let seed = 0x7a32bc;
  t.mock.method(Math, 'random', () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  for (const fps of [20, 30]) {
    const h = createHarness({ height: 100, active: [4] });
    h.game.velocity.set(0, -60, 0);
    const dt = 1 / fps;
    for (let frame = 0; frame < Math.floor(fps * 0.6); frame++) {
      h.car.position.addScaledVector(h.game.velocity, dt);
      h.effects.update(dt, h.game, h.car);
      if (frame < 2) continue;
      const nozzle = h.car.userData.thrusters[4].mesh.position;
      const nearJet = h.particles(0).filter((p) => {
        const distance = nozzle.x - p.x;
        return distance > 0.15 && distance < 3.5 && Math.abs(p.y - h.car.position.y - nozzle.y) < 1;
      });
      assert.ok(
        nearJet.length >= 2,
        `the jet must stay attached to its falling nozzle at ${fps} FPS (frame ${frame})`,
      );
      const distances = nearJet.map((p) => nozzle.x - p.x).sort((a, b) => a - b);
      const samples = [0.15, ...distances, 3.5];
      assert.ok(
        samples.every((distance, i) => i === 0 || distance - samples[i - 1] < 1.5),
        `the first metres of jet must not break into frame-spaced puffs at ${fps} FPS`,
      );
    }
  }
});

test('released smoke stays in world space when the car moves away', () => {
  const h = createHarness({ active: [0, 1, 2, 3] });
  h.advance(0.8);
  assert.ok(h.particles(1).length > 0);
  h.game.thrusterLevels.fill(0);
  h.car.position.x += 100;
  h.advance(0.5);
  const remaining = h.particles(1);
  assert.ok(remaining.length > 0);
  assert.ok(
    remaining.every((p) => Math.abs(p.x) < 25),
    'lingering clouds must remain at the burn location instead of following the vehicle',
  );
});

test('reset clears lingering smoke and cancels crash emission on the next attempt', () => {
  const h = createHarness({ active: [0, 1, 2, 3] });
  h.advance(0.8);
  h.effects.touchdown(false, 12, h.car.position);
  h.advance(0.3);
  assert.ok(h.particles().length > 0);

  h.game.thrusterLevels.fill(0);
  h.effects.reset();
  assert.equal(h.smoke.geometry.instanceCount, 0, 'reset must hide smoke immediately');
  h.advance(2);
  assert.equal(h.particles().length, 0, 'the prior crash must not resume emitting after reset');
  for (const emitter of h.car.userData.thrusters) assert.equal(emitter.mesh.visible, false);
});
