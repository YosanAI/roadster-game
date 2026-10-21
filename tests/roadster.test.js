import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { THRUSTERS } from '../src/game/thrusters.js';
import { createEffects } from '../src/scene/createEffects.js';
import { createRoadster } from '../src/scene/createRoadster.js';
import { loadRoadsterModel } from './helpers/loadRoadsterModel.js';

const near = (actual, expected, tolerance = 0.02) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

function geometryStats(object) {
  let draws = 0;
  let triangles = 0;
  const geometries = new Set();
  object.traverse((part) => {
    if (!part.isMesh || part.name.endsWith('-plume')) return;
    draws += Array.isArray(part.material) ? part.geometry.groups.length || 1 : 1;
    triangles +=
      ((part.geometry.index?.count || part.geometry.attributes.position.count) / 3) *
      (part.isInstancedMesh ? part.count : 1);
    geometries.add(part.geometry);
  });
  return { draws, triangles, geometries: geometries.size };
}

test('the uploaded body fits the game origin and faces forward at its original metre scale', async () => {
  const car = createRoadster(await loadRoadsterModel());
  const bounds = car.userData.bodyBounds;
  assert.ok(bounds?.isBox3, 'the loaded model must expose its physical bounds');
  const size = bounds.getSize(new Vector3());
  near(bounds.min.y, -0.72);
  near(bounds.max.y, 0.514);
  near(size.z, 2.118);
  assert.ok(bounds.max.x > 2.35 && bounds.max.x < 2.45, 'the nose must face game +X');
  assert.ok(bounds.min.x < -2.42 && bounds.min.x > -2.46, 'the rear aero belongs at game -X');
  assert.ok(size.x > 4.8 && size.x < 4.9, 'loading must preserve the detailed model dimensions');
});

test('four centred wheel pivots spin the tyres while the brake calipers stay fixed', async () => {
  const car = createRoadster(await loadRoadsterModel());
  const wheels = car.userData.wheels;
  const calipers = car.userData.brakeCalipers;
  assert.equal(wheels?.length, 4);
  assert.equal(calipers?.length, 4);
  near(car.userData.wheelRadius, 0.365, 0.001);
  const quadrants = new Set();
  for (const wheel of wheels) {
    const centre = wheel.getWorldPosition(new Vector3());
    near(Math.abs(centre.x), 1.45);
    near(centre.y, -0.355);
    near(Math.abs(centre.z), 0.894);
    quadrants.add(`${Math.sign(centre.x)},${Math.sign(centre.z)}`);
    for (const caliper of calipers) {
      assert.equal(
        wheel.getObjectById(caliper.id),
        undefined,
        'a caliper must not rotate with a tyre',
      );
    }
  }
  assert.equal(
    quadrants.size,
    4,
    'there must be a wheel at every front/rear and left/right corner',
  );
  car.updateMatrixWorld(true);
  const caliperMatrices = calipers.map((caliper) => caliper.matrixWorld.clone());
  const centres = wheels.map((wheel) => wheel.getWorldPosition(new Vector3()));
  let tyre;
  wheels[0].traverse((part) => {
    if (part.isMesh && !tyre) tyre = part;
  });
  assert.ok(tyre, 'a pivot must contain the uploaded wheel geometry');
  const vertex = new Vector3().fromBufferAttribute(tyre.geometry.attributes.position, 0);
  const before = vertex.clone().applyMatrix4(tyre.matrixWorld);
  for (const wheel of wheels) wheel.rotation.z += 0.7;
  car.updateMatrixWorld(true);
  const after = vertex.clone().applyMatrix4(tyre.matrixWorld);
  assert.ok(before.distanceTo(after) > 0.02, 'spinning a pivot must move the rendered wheel');
  wheels.forEach((wheel, index) =>
    near(wheel.getWorldPosition(new Vector3()).distanceTo(centres[index]), 0, 1e-8),
  );
  calipers.forEach((caliper, index) => {
    caliper.matrixWorld.elements.forEach((value, component) =>
      near(value, caliperMatrices[index].elements[component], 1e-8),
    );
  });
});

test('the effects animate the loaded wheels using their actual rolling radius', async () => {
  const car = createRoadster(await loadRoadsterModel());
  // The effects only need a parent with add(); the car is already fully built.
  const effects = createEffects({ add() {} });
  const speed = 3;
  const dt = 0.1;
  effects.update(
    dt,
    {
      stage: 'drive',
      inContact: true,
      driveSpeed: speed,
      velocity: new Vector3(speed, 0, 0),
      thrusterLevels: new Float32Array(THRUSTERS.length),
    },
    car,
  );
  for (const wheel of car.userData.wheels) {
    near(wheel.rotation.z, (-speed * dt) / car.userData.wheelRadius, 1e-8);
  }
  effects.reset();
  for (const wheel of car.userData.wheels) near(wheel.rotation.z, 0, 1e-8);
});

test('damage tint restores the uploaded paint without progressively changing its finish', async () => {
  const car = createRoadster(await loadRoadsterModel());
  const paint = car.userData.paintMaterials;
  assert.ok(paint?.length > 0);
  const original = paint.map((material) => ({
    color: material.color.clone(),
    roughness: material.roughness,
  }));
  for (let attempt = 0; attempt < 2; attempt++) {
    car.userData.markDamaged(true);
    assert.ok(
      paint.some(
        (material, index) =>
          !material.color.equals(original[index].color) ||
          material.roughness !== original[index].roughness,
      ),
    );
    car.userData.markDamaged(false);
    paint.forEach((material, index) => {
      assert.ok(material.color.equals(original[index].color));
      near(material.roughness, original[index].roughness, 1e-8);
    });
  }
});

test('independent cars do not change one another or the parsed asset when damaged or braking', async () => {
  const source = await loadRoadsterModel();
  const sourceMaterials = new Map();
  source.traverse((part) => {
    if (part.isMesh && !sourceMaterials.has(part.material)) {
      sourceMaterials.set(part.material, {
        color: part.material.color.clone(),
        roughness: part.material.roughness,
        metalness: part.material.metalness,
        emissiveIntensity: part.material.emissiveIntensity,
      });
    }
  });
  const first = createRoadster(source);
  const second = createRoadster(source);
  const secondPaint = second.userData.paintMaterials.map((material) => material.color.clone());
  const secondRear = second.userData.lights.rearMaterials.map(
    (material) => material.emissiveIntensity,
  );
  first.userData.markDamaged(true);
  first.userData.lights.update({ stage: 'drive', inContact: true, braking: 1 });
  first.userData.wheels[0].rotation.z = 0.8;
  second.userData.paintMaterials.forEach((material, index) => {
    assert.ok(material.color.equals(secondPaint[index]), 'paint must be cloned per car');
  });
  second.userData.lights.rearMaterials.forEach((material, index) => {
    assert.equal(
      material.emissiveIntensity,
      secondRear[index],
      'braking must not light another car',
    );
  });
  near(second.userData.wheels[0].rotation.z, 0, 1e-8);
  assert.equal(source.parent, null, 'the loader scene must not be moved into either car');
  for (const [material, original] of sourceMaterials) {
    assert.ok(material.color.equals(original.color));
    assert.equal(material.roughness, original.roughness);
    assert.equal(material.metalness, original.metalness);
    assert.equal(material.emissiveIntensity, original.emissiveIntensity);
  }
});

test('the actual headlamp and rear-blade materials remain connected after batching', async () => {
  const car = createRoadster(await loadRoadsterModel());
  const lights = car.userData.lights;
  assert.equal(lights.headlights.length, 2);
  assert.ok(lights.frontMaterials.length > 0 && lights.rearMaterials.length > 0);
  const rendered = new Set();
  car.traverse((part) => {
    if (part.isMesh) rendered.add(part.material);
  });
  for (const material of [...lights.frontMaterials, ...lights.rearMaterials]) {
    assert.ok(rendered.has(material), 'a lamp must update the material on a retained render mesh');
    assert.ok(material.emissiveIntensity > 0, 'running lights must be illuminated');
  }
  const sides = new Set();
  for (const headlight of lights.headlights) {
    assert.ok(
      headlight.position.x > 1.9,
      'white beams must originate at the imported front guides',
    );
    sides.add(Math.sign(headlight.position.z));
  }
  assert.equal(sides.size, 2, 'there must be one front beam on each side');
  assert.ok(
    lights.rearLight.position.x < -2.3,
    'red spill must originate behind the rear light blade',
  );
  const baseline = lights.rearMaterials.map((material) => material.emissiveIntensity);
  lights.update({ stage: 'success', inContact: true, braking: 1 });
  lights.rearMaterials.forEach((material, index) =>
    assert.ok(material.emissiveIntensity > baseline[index]),
  );
  lights.reset();
  lights.rearMaterials.forEach((material, index) =>
    assert.equal(material.emissiveIntensity, baseline[index]),
  );
});

test('both surge channels use all four rear housings and keep balanced exhaust directions', async () => {
  const car = createRoadster(await loadRoadsterModel());
  const emitters = car.userData.thrusters;
  assert.deepEqual(
    emitters.map((emitter) => emitter.id),
    THRUSTERS.map((definition) => definition.id),
  );
  for (const emitter of emitters.filter((entry) => entry.axis === 'surge')) {
    assert.equal(emitter.outlets.length, 4);
    const positions = emitter.outlets.map((outlet) => outlet.mesh.position);
    const lateral = positions.map((position) => position.z).sort((a, b) => a - b);
    lateral.forEach((value, index) => near(value, [-0.48, -0.16, 0.16, 0.48][index]));
    for (const { mesh, direction } of emitter.outlets) {
      near(mesh.position.x, -2.421);
      near(mesh.position.y, -0.302);
      assert.equal(Math.sign(direction.x), -emitter.commandSign);
    }
    const combined = emitter.outlets.reduce(
      (sum, outlet) => sum.add(outlet.direction),
      new Vector3(),
    );
    near(combined.y, 0, 1e-8);
    near(combined.z, 0, 1e-8);
  }
});

test('batching retains the uploaded detail while bounding render submissions', async () => {
  const source = await loadRoadsterModel();
  const original = geometryStats(source);
  const car = createRoadster(source);
  const prepared = geometryStats(car);
  assert.ok(original.draws > 800, 'this check must exercise the actual detailed upload');
  assert.ok(prepared.draws <= 130, `the detailed car requires ${prepared.draws} draw submissions`);
  assert.ok(prepared.geometries <= 130, 'batching must bound the retained geometry objects');
  assert.ok(
    prepared.triangles >= original.triangles * 0.95,
    'batching must not discard major model details',
  );
});
