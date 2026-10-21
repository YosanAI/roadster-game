import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THRUSTERS } from '../game/thrusters.js';
import { createVehicleLights } from './createVehicleLights.js';

const MODEL_URL = new URL('../assets/roadster-rocket.glb', import.meta.url).href;
const PLUME_AXIS = new THREE.Vector3(0, -1, 0);

// The supplied model is already in metres: source nose -Z, up +Y, axles X.
// Normalize it to game +X forward, +Y up and Z axles without resizing it.
export const ROADSTER_DIMENSIONS = Object.freeze({
  length: 4.84,
  width: 2.118,
  restHeight: 0.72,
  wheelRadius: 0.365,
});

function partName(object) {
  return (object.userData.name || object.name || '').replaceAll('_', ' ').toLowerCase();
}

/** Load the bundled, unmodified GLB before exposing the start controls. */
export async function loadRoadster() {
  try {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    return createRoadster(gltf.scene);
  } catch (cause) {
    const error = new Error(
      'The detailed Roadster model could not be loaded. Please reload and try again.',
      { cause },
    );
    error.name = 'VehicleModelError';
    throw error;
  }
}

/** Bake a part into its batch parent's local space without changing the GLB. */
function bakedGeometry(mesh, inverseParent) {
  const geometry = mesh.geometry.clone();
  const transform = new THREE.Matrix4().multiplyMatrices(inverseParent, mesh.matrixWorld);
  geometry.applyMatrix4(transform);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.uv) {
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2),
    );
  }
  if (!geometry.index) {
    const indices = new Uint32Array(geometry.attributes.position.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  if (transform.determinant() < 0) {
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const old = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = old;
    }
  }
  return geometry;
}

/** Batch only parts that share a material and the same animation transform. */
function batchParts(meshes, parent, name) {
  parent.updateWorldMatrix(true, false);
  const inverse = parent.matrixWorld.clone().invert();
  const batches = new Map();
  let transparentIndex = 0;
  for (const mesh of meshes) {
    const geometry = bakedGeometry(mesh, inverse);
    const material = mesh.material;
    if (material.transparent) {
      // Glass and labels retain independent sorting instead of being flattened
      // with transparent surfaces on the opposite side of the vehicle.
      const part = new THREE.Mesh(geometry, material);
      part.name = `${name}-transparent-${transparentIndex++}`;
      part.receiveShadow = true;
      parent.add(part);
      continue;
    }
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }
  let index = 0;
  for (const [material, geometries] of batches) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`Could not batch the Roadster's ${name} geometry.`);
    for (const source of geometries) source.dispose();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${name}-material-${index++}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

/** Connect eight valve channels to the detailed model's physical outlets. */
function addThrusters(car, rear, lift, lateral) {
  const geometry = new THREE.ConeGeometry(0.18, 1, 10, 1, true).translate(0, -0.5, 0);
  const material = new THREE.MeshBasicMaterial({
    color: 0xbee7ff,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  function outlet(definition, position, direction, suffix = '') {
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.position.copy(position);
    mesh.quaternion.setFromUnitVectors(PLUME_AXIS, direction);
    mesh.visible = false;
    mesh.name = `${definition.id}${suffix}-plume`;
    car.add(mesh);
    return { mesh, direction };
  }
  car.userData.thrusters = THRUSTERS.map((definition) => {
    if (definition.axis === 'surge') {
      const reverse = definition.commandSign < 0;
      const outlets = rear.map((position, i) =>
        outlet(
          definition,
          position,
          new THREE.Vector3(
            reverse ? 1 : -1,
            0,
            reverse ? Math.sign(position.z) * 1.7 : 0,
          ).normalize(),
          `-${i + 1}`,
        ),
      );
      return { ...definition, ...outlets[0], outlets };
    }
    const direction = new THREE.Vector3(...definition.forceDirection).negate();
    const position =
      definition.kind === 'lift'
        ? lift.find(
            (point) =>
              Math.sign(point.x) === Math.sign(definition.position[0]) &&
              Math.sign(point.z) === definition.side,
          )
        : lateral.find((point) => Math.sign(point.z) === Math.sign(direction.z));
    if (!position) throw new Error(`Missing model outlet for ${definition.id}.`);
    return { ...definition, ...outlet(definition, position, direction) };
  });
  material.dispose();
}

/**
 * Adapt a GLTF scene to the game's wheel, light, damage and particle hooks.
 * Source geometries/materials are preserved so each returned car is independent.
 * Wheel pivots spin about game-local Z; calipers remain attached to the body.
 * @param {THREE.Object3D} sourceScene Parsed scene from roadster-rocket.glb.
 * @returns {THREE.Group} Car centred on the simulation's mass reference.
 */
export function createRoadster(sourceScene) {
  if (!sourceScene?.isObject3D)
    throw new TypeError('createRoadster requires the parsed Roadster GLTF scene.');
  const car = new THREE.Group();
  car.name = 'Roadster';
  const model = new THREE.Group();
  model.name = 'normalized-roadster-model';
  model.rotation.y = -Math.PI / 2;
  model.position.y = -ROADSTER_DIMENSIONS.restHeight;
  model.add(sourceScene.clone(true));
  car.add(model);

  const materials = new Map();
  const paint = new Set();
  const rawMeshes = [];
  const wheelGroups = [];
  model.traverse((object) => {
    const name = partName(object);
    if (/^(front|rear) (left|right) aero wheel$/.test(name)) wheelGroups.push(object);
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) throw new Error('Unexpected multi-material Roadster part.');
    if (!materials.has(object.material)) {
      const material = object.material.clone();
      // The upload's two-sided body panels otherwise shadow their own front
      // faces, producing diagonal bands in the arena-wide shadow map.
      if (material.side === THREE.DoubleSide && !material.transparent)
        material.shadowSide = THREE.BackSide;
      materials.set(object.material, material);
    }
    object.material = materials.get(object.material);
    rawMeshes.push(object);
    if (
      /trapezoidal nose and hood|sculpted side skin|front fender shoulder|rear buttress/.test(name)
    )
      paint.add(object.material);
  });
  if (wheelGroups.length !== 4)
    throw new Error('The Roadster must contain four separate wheel assemblies.');
  car.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  const anchor = (object) =>
    car.worldToLocal(bounds.setFromObject(object).getCenter(new THREE.Vector3()));
  const rear = rawMeshes
    .filter((mesh) => /rear nozzle \d machined rim/.test(partName(mesh)))
    .map(anchor)
    .sort((a, b) => a.z - b.z);
  const lift = rawMeshes.filter((mesh) => partName(mesh) === 'lift nozzle lip').map(anchor);
  const lateral = rawMeshes
    .filter((mesh) => partName(mesh) === 'lateral nose nozzle lip')
    .map(anchor);
  if (rear.length !== 4 || lift.length !== 4 || lateral.length !== 2)
    throw new Error('The Roadster is missing its propulsion outlets.');
  for (const position of rear) position.x -= 0.015;
  for (const position of lift) position.y -= 0.015;
  for (const position of lateral) position.z += Math.sign(position.z) * 0.015;

  createVehicleLights(car, model);
  const animated = new Set();
  car.userData.wheels = [];
  car.userData.brakeCalipers = [];
  car.userData.wheelRadius = ROADSTER_DIMENSIONS.wheelRadius;
  for (const sourceWheel of wheelGroups) {
    const center = car.worldToLocal(sourceWheel.getWorldPosition(new THREE.Vector3()));
    const label = `${center.x > 0 ? 'front' : 'rear'}-${center.z > 0 ? 'left' : 'right'}`;
    const spinner = new THREE.Group();
    spinner.name = `${label}-wheel-pivot`;
    spinner.position.copy(center);
    const caliper = new THREE.Group();
    caliper.name = `${label}-brake-caliper`;
    caliper.position.copy(center);
    car.add(spinner, caliper);
    const rotating = [],
      fixed = [];
    sourceWheel.traverse((object) => {
      if (!object.isMesh) return;
      animated.add(object);
      (partName(object).includes('gold performance brake caliper') ? fixed : rotating).push(object);
    });
    batchParts(rotating, spinner, `${label}-wheel`);
    batchParts(fixed, caliper, `${label}-caliper`);
    car.userData.wheels.push(spinner);
    car.userData.brakeCalipers.push(caliper);
  }
  const body = new THREE.Group();
  body.name = 'roadster-body';
  car.add(body);
  batchParts(
    rawMeshes.filter((mesh) => !animated.has(mesh)),
    body,
    'body',
  );
  car.remove(model);
  car.userData.bodyBounds = new THREE.Box3().setFromObject(car);
  car.userData.paintMaterials = [...paint];
  const finish = car.userData.paintMaterials.map((material) => ({
    material,
    color: material.color.clone(),
    roughness: material.roughness,
    metalness: material.metalness,
  }));
  car.userData.markDamaged = (damaged = true) => {
    for (const original of finish) {
      original.material.color.copy(original.color).multiplyScalar(damaged ? 0.42 : 1);
      original.material.roughness = damaged ? 0.85 : original.roughness;
      original.material.metalness = damaged ? 0.22 : original.metalness;
    }
  };
  addThrusters(car, rear, lift, lateral);
  return car;
}
