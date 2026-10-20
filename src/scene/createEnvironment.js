import * as THREE from 'three';
import { COURSE } from '../game/config.js';

/**
 * Nighttime Roadster demonstration arena.
 *
 * Coordinates are metres: +X is the approach, +Y is up. The ramp's riding
 * surface is the ellipse (9 + 6.5 sin(t), 10.5(1 - cos(t))), 0 <= t <= PI.
 * At the top, the car rides the underside of the horizontal launch lip.
 * All textures are deterministic DataTextures, so scene construction also
 * works in Node without a document, image loader, or rendering context.
 */
// Keep the renderer's named profile while sharing all riding dimensions with physics.
const RAMP_PROFILE = Object.freeze({
  footX: COURSE.rampX,
  radiusX: COURSE.radiusX,
  radiusY: COURSE.radiusY,
  width: COURSE.width,
  lipX: COURSE.topEndX,
});
const UP = new THREE.Vector3(0, 1, 0);

// Reusable texture and geometry helpers.

/** Generate repeatable asphalt grain without an image file, canvas or network. */
function createAsphaltTexture() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 79371;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = 70 + ((seed >>> 24) % 66);
    const fleck = (seed & 127) === 0 ? 24 : 0;
    const index = i * 4;
    pixels[index] = grain + fleck;
    pixels[index + 1] = grain + fleck + 2;
    pixels[index + 2] = grain + fleck + 5;
    pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(90, 65);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function addBox(parent, size, position, material, name = '') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/**
 * Sample the shared elliptical ramp, optionally offset along its riding normal.
 * @param {number} t Arc parameter in radians, from 0 at the foot to PI at the lip.
 * @param {number} [offset=0] Positive metres toward the car, inside the curve.
 * @param {number} [z=0] Lateral position across the ramp in metres.
 * @returns {THREE.Vector3}
 */
function getRampPoint(t, offset = 0, z = 0) {
  const tx = RAMP_PROFILE.radiusX * Math.cos(t);
  const ty = RAMP_PROFILE.radiusY * Math.sin(t);
  const length = Math.hypot(tx, ty);
  // Positive offset is toward the car, i.e. into the inside of the curve.
  return new THREE.Vector3(
    RAMP_PROFILE.footX + RAMP_PROFILE.radiusX * Math.sin(t) - (ty / length) * offset,
    RAMP_PROFILE.radiusY * (1 - Math.cos(t)) + (tx / length) * offset,
    z,
  );
}

/** Build a longitudinal strip for the steel sheet, painted line or LED edges. */
function createRampStrip(z0, z1, offset = 0, segments = 112) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI;
    for (const [side, z] of [z0, z1].entries()) {
      const p = getRampPoint(t, offset, z);
      positions.push(p.x, p.y, p.z);
      uvs.push(i / segments, side);
    }
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Render all beams in a structural family with one shared cylinder geometry. */
function createInstancedBeams(parent, beams, material, radius, name) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 6, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, beams.length);
  const object = new THREE.Object3D();
  const delta = new THREE.Vector3();
  beams.forEach(([a, b], i) => {
    delta.subVectors(b, a);
    object.position.copy(a).add(b).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(UP, delta.clone().normalize());
    object.scale.set(1, Math.max(0.001, delta.length()), 1);
    object.updateMatrix();
    mesh.setMatrixAt(i, object.matrix);
  });
  mesh.name = name;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Batch fixed box details by material, retaining the scene's semantic groups. */
function batchStaticBoxes(parent) {
  // Keep the scene's semantic groups, but render repeated paint, fixtures,
  // and blocks in one instanced draw per material within each group.
  const groups = new Map();
  for (const child of [...parent.children]) {
    if (child.isGroup) batchStaticBoxes(child);
    if (!child.isMesh || child.geometry.type !== 'BoxGeometry') continue;
    const key = child.material;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }
  for (const [material, boxes] of groups) {
    if (boxes.length < 2) continue;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, boxes.length);
    const dummy = new THREE.Object3D();
    mesh.name = `Static ${parent.name || 'arena'} details`;
    for (let i = 0; i < boxes.length; i++) {
      const child = boxes[i];
      const p = child.geometry.parameters;
      dummy.position.copy(child.position);
      dummy.quaternion.copy(child.quaternion);
      dummy.scale.set(p.width * child.scale.x, p.height * child.scale.y, p.depth * child.scale.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.castShadow ||= child.castShadow;
      mesh.receiveShadow ||= child.receiveShadow;
      parent.remove(child);
      child.geometry.dispose();
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
  }
}

// Arena assembly. Visual structures do not participate in collision detection.

function createRamp(parent, materials) {
  const ramp = new THREE.Group();
  ramp.name = 'Inverted suction ramp';
  parent.add(ramp);

  const surface = new THREE.Mesh(createRampStrip(-2.9, 2.9), materials.sheet);
  surface.name = 'Riding surface — exact physics ellipse';
  surface.castShadow = surface.receiveShadow = true;
  ramp.add(surface);
  const back = new THREE.Mesh(createRampStrip(-2.9, 2.9, -0.1), materials.sheetBack);
  back.name = 'Underside of curved steel sheet';
  back.castShadow = true;
  ramp.add(back);

  // The thickness sits ABOVE the lip: its underside is exactly y=21.
  const lipLength = RAMP_PROFILE.footX - RAMP_PROFILE.lipX;
  const lip = addBox(
    ramp,
    [lipLength, 0.1, RAMP_PROFILE.width],
    [(RAMP_PROFILE.footX + RAMP_PROFILE.lipX) / 2, 21.05, 0],
    materials.sheet,
    'Inverted launch lip',
  );
  lip.castShadow = lip.receiveShadow = true;

  const stripe = new THREE.Mesh(createRampStrip(-0.035, 0.035, 0.014), materials.paint);
  stripe.name = 'White ramp center stripe';
  ramp.add(stripe);
  addBox(ramp, [lipLength, 0.006, 0.07], [6.25, 20.991, 0], materials.paint);

  // Edge LEDs are slender lines as in the event, not oversized glowing rails.
  for (const z of [-2.925, 2.925]) {
    const edge = new THREE.Mesh(createRampStrip(z - 0.028, z + 0.028, 0.022), materials.redLight);
    edge.name = 'Continuous red ramp edge LED';
    ramp.add(edge);
    addBox(ramp, [lipLength, 0.048, 0.055], [6.25, 21.002, z], materials.redLight);
  }

  // Fine joints cross the width of the gray sheet at regular arc intervals.
  const seamPositions = [];
  for (let i = 1; i < 27; i++) {
    const a = getRampPoint((i / 27) * Math.PI, 0.016, -2.89);
    const b = getRampPoint((i / 27) * Math.PI, 0.016, 2.89);
    seamPositions.push(...a.toArray(), ...b.toArray());
  }
  for (let x = 4.5; x < 9; x += 1.35) seamPositions.push(x, 20.993, -2.89, x, 20.993, 2.89);
  const seamGeometry = new THREE.BufferGeometry();
  seamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
  const seams = new THREE.LineSegments(seamGeometry, materials.seam);
  seams.name = 'Steel riding sheet panel joints';
  ramp.add(seams);

  const heavyBeams = [];
  const braces = [];
  const beam = (list, a, b) => list.push([a, b]);
  // Two open space frames follow the back of the curve; none intrudes onto
  // the riding side. Buried lower endpoints meet the arena at ground level.
  for (const z of [-3.14, 3.14]) {
    const inner = [];
    const outer = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI;
      const a = getRampPoint(t, -0.22, z);
      const b = getRampPoint(t, -1.5, z);
      a.y = Math.max(0.08, a.y);
      b.y = Math.max(0.08, b.y);
      inner.push(a);
      outer.push(b);
      if (i > 0) {
        beam(heavyBeams, inner[i - 1], a);
        beam(heavyBeams, outer[i - 1], b);
        beam(braces, inner[i - 1], b);
        beam(braces, outer[i - 1], a);
      }
      beam(braces, a, b);
    }

    // Rear buttress tower supplies a plausible load path to the ground.
    const rearX = 20.6;
    beam(heavyBeams, new THREE.Vector3(rearX, 0.1, z), new THREE.Vector3(rearX, 21.7, z));
    for (let i = 1; i <= 7; i++) {
      const y = i * 3;
      const theta = Math.acos(1 - Math.min(21, y) / 10.5);
      const arc = getRampPoint(theta, -1.5, z);
      beam(braces, arc, new THREE.Vector3(rearX, y, z));
      beam(braces, arc, new THREE.Vector3(rearX, Math.max(0.12, y - 3), z));
    }
    beam(heavyBeams, new THREE.Vector3(rearX, 0.12, z), new THREE.Vector3(12, 0.12, z));
    beam(heavyBeams, new THREE.Vector3(3.5, 22.25, z), new THREE.Vector3(9, 22.5, z));
    beam(heavyBeams, new THREE.Vector3(3.5, 21.15, z), new THREE.Vector3(9, 21.15, z));
    for (let i = 0; i < 4; i++) {
      const x = 3.5 + i * 1.375;
      beam(
        braces,
        new THREE.Vector3(x, 21.15, z),
        new THREE.Vector3(x + 1.375, 22.25 + (i + 1) * 0.0625, z),
      );
      beam(
        braces,
        new THREE.Vector3(x, 22.25 + i * 0.0625, z),
        new THREE.Vector3(x + 1.375, 21.15, z),
      );
    }
    addBox(ramp, [1.9, 0.22, 1.5], [20.6, 0.1, z], materials.concrete, 'Rear truss footing');
    addBox(ramp, [1.5, 0.14, 1.2], [11.0, 0.05, z], materials.concrete, 'Ramp frame footing');
  }
  // Cross-brace only the outer/back surface so the lane remains unobstructed.
  for (let i = 1; i <= 12; i++) {
    const t = (i / 12) * Math.PI;
    const left = getRampPoint(t, -1.5, -3.14);
    const right = getRampPoint(t, -1.5, 3.14);
    left.y = right.y = Math.max(0.08, left.y);
    beam(braces, left, right);
    if (i < 12) beam(braces, left, getRampPoint(((i + 1) / 12) * Math.PI, -1.5, 3.14));
  }
  for (const y of [0.18, 3, 6, 9, 12, 15, 18, 21.7]) {
    beam(braces, new THREE.Vector3(20.6, y, -3.14), new THREE.Vector3(20.6, y, 3.14));
    if (y > 0.2)
      beam(braces, new THREE.Vector3(20.6, y - 3, -3.14), new THREE.Vector3(20.6, y, 3.14));
  }
  createInstancedBeams(ramp, heavyBeams, materials.steel, 0.083, 'Ramp structural chords');
  createInstancedBeams(ramp, braces, materials.steel, 0.043, 'Ramp triangulated braces');
  ramp.userData.course = RAMP_PROFILE;
  return ramp;
}

function createLandingMarker(parent, material) {
  const marker = new THREE.Group();
  marker.name = 'Painted touchdown target';
  marker.position.set(-8, 0.012, 0);
  parent.add(marker);
  // An unobtrusive broken rectangle with strong corners reads at any zoom.
  for (const x of [-7, 7]) {
    for (const z of [-4, 4]) {
      addBox(marker, [1.8, 0.006, 0.1], [x - Math.sign(x) * 0.85, 0, z], material);
      addBox(marker, [0.1, 0.006, 1.55], [x, 0, z - Math.sign(z) * 0.72], material);
    }
    for (const z of [-1.6, 1.6]) addBox(marker, [0.055, 0.005, 0.8], [x, 0, z], material);
  }
  for (const z of [-4, 4]) {
    for (const x of [-3.5, 0, 3.5]) addBox(marker, [1.1, 0.005, 0.055], [x, 0, z], material);
  }
  marker.userData.material = material;
  marker.userData.setStatus = (status) => {
    material.color.set(
      status === 'success' ? 0x7adfa9 : status === 'crashed' ? 0xff4a57 : 0xb8c2ca,
    );
  };
  return marker;
}

function createArena(parent, materials) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(270, 190), materials.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-10, -0.016, 0);
  ground.name = 'Dark asphalt demonstration apron';
  ground.receiveShadow = true;
  parent.add(ground);

  // A quiet approach lane feeds directly into the exact foot of the ramp.
  const road = addBox(parent, [76, 0.006, 5.8], [-29, -0.007, 0], materials.road, 'Approach road');
  road.receiveShadow = true;
  for (let x = -63; x < 8; x += 5) {
    addBox(parent, [2.0, 0.004, 0.055], [x, 0.001, 0], materials.roadPaint);
  }
  for (const z of [-2.87, 2.87]) {
    addBox(parent, [73.5, 0.004, 0.045], [-27.75, 0.003, z], materials.roadPaint);
  }
  // Transverse survey dashes at the road margins, as in the reveal floor.
  for (let x = -48; x < 18; x += 6) {
    for (const z of [-5.5, 5.5])
      addBox(parent, [0.32, 0.005, 0.07], [x, 0.006, z], materials.roadPaint);
  }

  for (const z of [-22, 22]) {
    addBox(parent, [90, 0.18, 0.2], [-10, 0.09, z], materials.black);
    addBox(
      parent,
      [90, 0.045, 0.045],
      [-10, 0.2, z],
      materials.redLight,
      'Red event perimeter lighting',
    );
  }
  addBox(parent, [0.2, 0.18, 44], [35, 0.09, 0], materials.black);
  addBox(parent, [0.045, 0.045, 44], [35, 0.2, 0], materials.redLight);

  const barriers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.5, 0.52, 0.38),
    materials.barrier,
    30,
  );
  const temp = new THREE.Object3D();
  let index = 0;
  for (const z of [-24.8, 24.8]) {
    for (let i = 0; i < 15; i++) {
      temp.position.set(-54 + i * 6, 0.26, z);
      temp.updateMatrix();
      barriers.setMatrixAt(index++, temp.matrix);
    }
  }
  barriers.instanceMatrix.needsUpdate = true;
  barriers.name = 'Distant arena safety barriers';
  parent.add(barriers);
}

// Floodlighting uses one shadow-casting light; fixtures themselves are instanced.

function addLights(scene, parent, materials) {
  const lights = [];
  const skyFill = new THREE.HemisphereLight(0xc7d7f4, 0x323844, 1.0);
  skyFill.name = 'Soft nighttime environment fill';
  scene.add(skyFill);
  lights.push(skyFill);

  const key = new THREE.DirectionalLight(0xf3f5ff, 3.0);
  key.name = 'Arena white floodlight';
  key.position.set(-20, 35, 20);
  key.target.position.set(3, 5, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -55;
  key.shadow.camera.right = 38;
  key.shadow.camera.top = 39;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 125;
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 2;
  scene.add(key, key.target);
  lights.push(key);

  const lampPositions = [
    [-23, 13, 16],
    [16, 16, -17],
    [25, 12, 17],
    [-42, 9, -17],
  ];
  lampPositions.forEach(([x, y, z], i) => {
    addBox(parent, [1.8, 0.25, 1.8], [x, 0.125, z], materials.concrete);
    addBox(parent, [0.16, y, 0.16], [x, y / 2, z], materials.steel);
    addBox(parent, [2.05, 0.18, 0.32], [x, y, z], materials.steel);
    for (let j = -1; j <= 1; j++) {
      addBox(parent, [0.48, 0.36, 0.22], [x + j * 0.63, y - 0.13, z], materials.black);
      addBox(
        parent,
        [0.4, 0.26, 0.018],
        [x + j * 0.63, y - 0.13, z + (z > 0 ? -0.12 : 0.12)],
        materials.whiteLight,
      );
    }
    if (i < 2) {
      const spot = new THREE.SpotLight(i === 0 ? 0xe2eeff : 0xffe9d1, 2400, 110, 0.92, 0.7, 2);
      spot.position.set(x, y - 0.2, z);
      spot.target.position.set(i === 0 ? -7 : 12, i === 0 ? 0 : 10, 0);
      spot.name = i === 0 ? 'Landing floodlight' : 'Ramp grazing floodlight';
      scene.add(spot, spot.target);
      lights.push(spot);
    }
  });

  // A small cantilever camera/light boom attached to the rear tower.
  const boom = [];
  const vec = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const z of [-0.28, 0.28]) {
    boom.push([vec(20.6, 21.7, z), vec(20.6, 24, z)]);
    boom.push([vec(20.6, 24, z), vec(9.4, 24, z)]);
    boom.push([vec(20.6, 23.25, z), vec(9.4, 23.25, z)]);
    for (let i = 0; i < 8; i++) {
      boom.push([vec(9.4 + i * 1.4, 23.25, z), vec(9.4 + (i + 1) * 1.4, 24, z)]);
    }
  }
  createInstancedBeams(parent, boom, materials.steel, 0.037, 'Top camera and lighting truss');
  for (const z of [-0.8, 0, 0.8]) {
    addBox(parent, [0.4, 0.32, 0.44], [9.7, 22.97, z], materials.black);
    addBox(parent, [0.26, 0.018, 0.29], [9.7, 22.8, z], materials.whiteLight);
  }
  const redBounce = new THREE.PointLight(0xef3048, 24, 16, 2);
  redBounce.position.set(12, 0.7, -4.4);
  redBounce.name = 'Subtle red LED spill';
  scene.add(redBounce);
  lights.push(redBounce);
  return lights;
}

/**
 * Attach the nighttime arena, matching ramp surface and lighting to a scene.
 * The returned update method only animates the touchdown marking; it never
 * modifies simulation state or decides whether a landing is safe.
 *
 * @param {THREE.Scene} scene
 * @returns {{root: THREE.Group, ramp: THREE.Group, landingMarker: THREE.Group, lights: THREE.Light[], update: (time: number, stage: string) => void}}
 */
export function createEnvironment(scene) {
  const root = new THREE.Group();
  root.name = 'Roadster nighttime event reconstruction';
  scene.add(root);
  scene.background = new THREE.Color(0x030407);

  const materials = {
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x52575e,
      map: createAsphaltTexture(),
      roughness: 0.92,
      metalness: 0.04,
    }),
    road: new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.83, metalness: 0.04 }),
    sheet: new THREE.MeshStandardMaterial({
      color: 0x7c838a,
      roughness: 0.61,
      metalness: 0.36,
      side: THREE.DoubleSide,
    }),
    sheetBack: new THREE.MeshStandardMaterial({
      color: 0x404953,
      roughness: 0.78,
      metalness: 0.5,
      side: THREE.DoubleSide,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0x74808b, roughness: 0.55, metalness: 0.78 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x373d44, roughness: 0.98 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c1117, roughness: 0.62, metalness: 0.48 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0x131a21, roughness: 0.8, metalness: 0.16 }),
    paint: new THREE.MeshBasicMaterial({ color: 0xb7bdc1, side: THREE.DoubleSide }),
    roadPaint: new THREE.MeshBasicMaterial({ color: 0x444b52 }),
    marker: new THREE.MeshBasicMaterial({
      color: 0xb8c2ca,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
    seam: new THREE.LineBasicMaterial({ color: 0x434b52, transparent: true, opacity: 0.3 }),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff1736, toneMapped: false }),
    whiteLight: new THREE.MeshBasicMaterial({ color: 0xddeeff, toneMapped: false }),
  };
  createArena(root, materials);
  const ramp = createRamp(root, materials);
  const landingMarker = createLandingMarker(root, materials.marker);
  const lights = addLights(scene, root, materials);
  batchStaticBoxes(root);
  let priorStatus = '';

  return {
    root,
    ramp,
    landingMarker,
    lights,
    update(time, stage) {
      const status =
        stage === 'success' || stage === 'landed'
          ? 'success'
          : stage === 'crashed' || stage === 'gameover' || stage === 'failed'
            ? 'crashed'
            : 'ready';
      if (status !== priorStatus) {
        landingMarker.userData.setStatus(status);
        priorStatus = status;
      }
      materials.marker.opacity = status === 'ready' ? 0.3 : 0.56 + Math.sin(time * 2.6) * 0.08;
    },
  };
}
