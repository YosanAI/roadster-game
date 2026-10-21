import * as THREE from 'three';

const HEADLIGHT_INTENSITY = 190;
// Match the ramp and road LEDs: unlit saturated red, outside ACES tone mapping.
const TAIL_COLOR = new THREE.Color(0xff1736);
const TAIL_BRIGHTNESS = 1;
const BRAKE_BOOST = 2;

function partName(object) {
  return (object.userData.name || object.name).replaceAll('_', ' ').toLowerCase();
}

function materialsOf(meshes) {
  const materials = new Set();
  for (const mesh of meshes) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) materials.add(material);
    }
  }
  return [...materials];
}

/**
 * Illuminate the uploaded model's actual lamps before its static meshes are
 * batched. Anchors are captured in car coordinates and materials remain shared
 * with the rendered batches, so wheel animation and later batching are safe.
 * @param {THREE.Group} car Game-space vehicle, facing local +X.
 * @param {THREE.Object3D} model Normalized imported model, already parented to car.
 * @returns {{headlights: THREE.SpotLight[], targets: THREE.Object3D[], frontMaterials: THREE.Material[], rearMaterials: THREE.Material[], update: Function, reset: Function}}
 */
export function createVehicleLights(car, model) {
  const guides = [];
  const frontParts = [];
  const rearParts = [];
  const rearReplacements = new Map();
  const daytimeLights = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    const name = partName(object);
    if (name.includes('headlamp upper light guide')) guides.push(object);
    if (name.includes('triangular smoked headlamp lens')) {
      // The upload shares an opaque black material between these covers and
      // carbon bodywork. Give only the lamp covers their own glass material so
      // their actual LED projectors remain visible through the smoked lens.
      const glass = (material) => {
        const lens = material.clone();
        lens.color.set(0x66727d);
        lens.transparent = true;
        lens.opacity = 0.18;
        lens.depthWrite = false;
        lens.metalness = 0;
        lens.roughness = 0.12;
        return lens;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(glass)
        : glass(object.material);
      object.castShadow = false;
    }
    if (name.includes('continuous front daytime running light')) daytimeLights.push(object);
    if (
      name.includes('headlamp upper light guide') ||
      name.includes('continuous front daytime running light')
    )
      frontParts.push(object);
    if (name.includes('full-width red rear light blade')) {
      const neon = (source) => {
        if (!rearReplacements.has(source)) {
          rearReplacements.set(
            source,
            new THREE.MeshBasicMaterial({
              color: TAIL_COLOR,
              toneMapped: false,
              side: source.side,
            }),
          );
        }
        return rearReplacements.get(source);
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(neon)
        : neon(object.material);
      rearParts.push(object);
    }
  });
  if (guides.length !== 2 || rearParts.length === 0) {
    throw new Error('Roadster model is missing its two headlamp guides or rear light blade.');
  }

  const frontMaterials = materialsOf(frontParts);
  const rearMaterials = materialsOf(rearParts);
  const bounds = new THREE.Box3();
  const position = new THREE.Vector3();
  car.updateWorldMatrix(true, true);
  for (const strip of daytimeLights) {
    // The existing DRL sits almost coplanar with the nose. Move it just clear
    // of the paint in car-forward space rather than drawing a replacement bar.
    const start = strip.parent.worldToLocal(car.localToWorld(new THREE.Vector3()));
    const end = strip.parent.worldToLocal(car.localToWorld(new THREE.Vector3(0.008, 0, 0)));
    strip.position.add(end.sub(start));
  }
  car.updateWorldMatrix(true, true);
  function anchor(part) {
    bounds.setFromObject(part).getCenter(position);
    return car.worldToLocal(position.clone());
  }

  const headlights = [];
  const targets = [];
  for (const [index, guide] of guides.entries()) {
    const light = new THREE.SpotLight(0xdcecff, HEADLIGHT_INTENSITY, 42, 0.4, 0.65, 2);
    light.name = `roadster-headlight-${index + 1}`;
    light.position.copy(anchor(guide));
    light.position.x += 0.06;
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.name = `${light.name}-target`;
    target.position.copy(light.position).add(new THREE.Vector3(18, -0.75, 0));
    light.target = target;
    car.add(light, target);
    headlights.push(light);
    targets.push(target);
  }

  function reset() {
    for (const material of frontMaterials) {
      if (material.emissive.getHex() === 0) material.emissive.set(0xdcecff);
      material.emissiveIntensity = 5;
    }
    for (const material of rearMaterials) {
      material.color.copy(TAIL_COLOR).multiplyScalar(TAIL_BRIGHTNESS);
    }
  }

  function update(game) {
    // Flight controls and raw held keys cannot invent wheel-braking lights.
    const braking =
      game?.inContact && game.stage !== 'ready' && game.stage !== 'crashed'
        ? THREE.MathUtils.clamp(Number.isFinite(game.braking) ? game.braking : 0, 0, 1)
        : 0;
    for (const material of rearMaterials)
      material.color.copy(TAIL_COLOR).multiplyScalar(TAIL_BRIGHTNESS + braking * BRAKE_BOOST);
  }

  reset();
  const lights = { headlights, targets, frontMaterials, rearMaterials, update, reset };
  car.userData.lights = lights;
  return lights;
}
