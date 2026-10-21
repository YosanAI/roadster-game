import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createVehicleLights } from '../src/scene/createVehicleLights.js';

function fixture() {
  const car = new THREE.Group();
  car.position.set(-10, 5, 8);
  car.rotation.x = 0.6;
  const model = new THREE.Group();
  model.rotation.y = -Math.PI / 2;
  model.position.y = -0.72;
  car.add(model);
  const white = new THREE.MeshStandardMaterial({ emissive: 0xdcecff });
  const sourceRed = new THREE.MeshStandardMaterial({ emissive: 0xff1730 });
  const black = new THREE.MeshStandardMaterial({ color: 0x030405, metalness: 0.6 });
  const lenses = [];
  function part(name, xyz, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), material);
    mesh.userData.name = name;
    mesh.position.set(...xyz);
    model.add(mesh);
    return mesh;
  }
  for (const side of [-1, 1]) part('Headlamp upper light guide', [side * 0.84, 0.71, -1.93], white);
  for (const side of [-1, 1])
    lenses.push(part('Triangular smoked headlamp lens', [side * 0.84, 0.65, -2.1], black));
  const carbon = part('Carbon side skirt', [1, 0.2, 0], black);
  const daytimeLight = part('Continuous front daytime running light', [0, 0.55, -2.35], white);
  part('Full-width red rear light blade', [0, 0.886, 2.3], sourceRed);
  const lights = createVehicleLights(car, model);
  return {
    car,
    model,
    white,
    red: lights.rearMaterials[0],
    sourceRed,
    black,
    lenses,
    carbon,
    daytimeLight,
    lights,
  };
}

test('smoked headlamp covers reveal the LEDs without changing shared carbon material', () => {
  const { black, lenses, carbon, daytimeLight } = fixture();
  for (const lens of lenses) {
    assert.notEqual(lens.material, black);
    assert.equal(lens.material.transparent, true);
    assert.ok(lens.material.opacity > 0 && lens.material.opacity < 0.3);
    assert.equal(lens.material.depthWrite, false);
    assert.equal(lens.material.metalness, 0);
    assert.equal(lens.castShadow, false);
  }
  assert.equal(carbon.material, black);
  assert.equal(black.transparent, false);
  assert.equal(black.opacity, 1);
  assert.equal(black.metalness, 0.6);
  assert.ok(
    daytimeLight.position.z < -2.35,
    'existing DRL must sit just ahead of the painted nose',
  );
});

test('front beams follow the car while the rear strip emits without a point-light hotspot', () => {
  const { car, white, red, sourceRed, lights } = fixture();
  assert.equal(lights.headlights.length, 2);
  assert.equal(lights.frontMaterials.length, 1, 'shared guides/DRL use one material update');
  assert.ok(white.emissiveIntensity > 0);
  assert.ok(red.isMeshBasicMaterial && !red.toneMapped, 'the rear line stays bright in shadow');
  assert.notEqual(red, sourceRed, 'replace only the rear blade material, preserving the upload');
  assert.equal(sourceRed.emissiveIntensity, 1);
  for (const [index, light] of lights.headlights.entries()) {
    const target = lights.targets[index];
    assert.equal(light.parent, car);
    assert.equal(target.parent, car);
    assert.equal(light.castShadow, false);
    assert.ok(light.position.x > 1.9, 'headlights belong at the front lamp assemblies');
    assert.ok(target.position.x > light.position.x && target.position.y < light.position.y);
  }
  const sceneLights = [];
  car.traverse((part) => {
    if (part.isLight) sceneLights.push(part);
  });
  assert.deepEqual(sceneLights, lights.headlights, 'only the two front beams need light objects');
  assert.ok(sceneLights.every((light) => light.isSpotLight));

  car.rotation.set(0.9, 1.1, 0.4);
  car.updateWorldMatrix(true, true);
  const beam = lights.targets[0]
    .getWorldPosition(new THREE.Vector3())
    .sub(lights.headlights[0].getWorldPosition(new THREE.Vector3()))
    .normalize();
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
  assert.ok(beam.dot(forward) > 0.99, 'beams must rotate with the car instead of world axes');
});

test('rear lamps brighten only for actual contact braking and reset on a new attempt', () => {
  const { red, lights } = fixture();
  const tail = red.color.clone();
  lights.update({ stage: 'drive', inContact: true, braking: 0.4 });
  const partial = red.color.r;
  assert.ok(partial > tail.r);
  lights.update({ stage: 'success', inContact: true, braking: 1 });
  assert.ok(red.color.r > partial, 'drive-away wheel brakes must brighten the rear blade');
  lights.reset();
  assert.ok(red.color.equals(tail));
  for (const state of [
    { stage: 'flight', inContact: false, braking: 1 },
    { stage: 'ready', inContact: true, braking: 1 },
    { stage: 'crashed', inContact: true, braking: 1 },
    { stage: 'drive', inContact: true, braking: NaN },
  ]) {
    lights.update(state);
    assert.ok(red.color.equals(tail));
  }
});

test('lamp material bindings survive static mesh batching', () => {
  const { model, lights, red } = fixture();
  const tail = red.color.clone();
  model.clear();
  lights.update({ stage: 'drive', inContact: true, braking: 1 });
  assert.ok(red.color.r > tail.r, 'updates must use retained batch material references');
});
