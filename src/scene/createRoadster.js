import * as THREE from 'three';
import { THRUSTERS } from '../game/thrusters.js';

// All dimensions are metres. The vehicle faces +X; its axles run along Z.
export const ROADSTER_DIMENSIONS = Object.freeze({
  length: 4.68,
  width: 2.12,
  restHeight: 0.72,
  wheelRadius: 0.36,
});

// Geometry helpers. These build native Three.js assets without model downloads.

/**
 * Bake transforms into one geometry so same-material details need one draw.
 * The input geometries are consumed and disposed after their vertices are copied.
 * @param {Array<{geometry: THREE.BufferGeometry, position?: number[], rotation?: number[], scale?: number[]}>} parts
 * @returns {THREE.BufferGeometry}
 */
function mergeTransformedParts(parts) {
  const positions = [],
    normals = [];
  for (const { geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    g.applyMatrix4(matrix);
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
    g.dispose();
    geometry.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.computeBoundingSphere();
  return result;
}

/** Triangulate ordered polygon faces; each face keeps its own flat normal. */
function createPolygonGeometry(vertices, faces) {
  const p = [];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      p.push(...vertices[face[0]], ...vertices[face[i]], ...vertices[face[i + 1]]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Loft the body cross sections along the forward axis, with open wheel wells. */
function createBodyShellGeometry() {
  // A loft with cut-away wheel openings. The centre floor stays low while the
  // outer lower edges rise over the tyres, so the wheels are not buried in a box.
  const stations = [
    -2.34, -2.22, -1.98, -1.82, -1.67, -1.52, -1.42, -1.32, -1.17, -1.02, -0.85, -0.5, 0, 0.5, 0.85,
    1.02, 1.17, 1.32, 1.42, 1.52, 1.67, 1.82, 1.98, 2.18, 2.34,
  ];
  const p = [],
    indices = [];
  for (const x of stations) {
    const nose = Math.max(0, (x - 1.5) / 0.84);
    const tail = Math.max(0, (-x - 1.9) / 0.44);
    const width = 1.01 - nose * 0.23 - tail * 0.055;
    const archDistance = Math.min(Math.abs(x - 1.42), Math.abs(x + 1.42));
    const arch = archDistance < 0.425 ? -0.35 + Math.sqrt(0.425 ** 2 - archDistance ** 2) : -0.39;
    const shoulder = Math.max(0.08 - nose * 0.27 - tail * 0.055, arch + 0.048);
    const crown = 0.115 - nose * 0.3 - tail * 0.055;
    const bottom = Math.max(-0.39 + nose * 0.09, arch);
    const ring = [
      [0, crown],
      [width * 0.71, crown - 0.014],
      [width, shoulder],
      [width, bottom],
      [width * 0.71, -0.4 + nose * 0.08],
      [-width * 0.71, -0.4 + nose * 0.08],
      [-width, bottom],
      [-width, shoulder],
      [-width * 0.71, crown - 0.014],
    ];
    for (const [z, y] of ring) p.push(x, y, z);
  }
  const count = 9;
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < count; j++) {
      const a = i * count + j,
        b = i * count + ((j + 1) % count);
      const c = (i + 1) * count + ((j + 1) % count),
        d = (i + 1) * count + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  for (let j = 1; j < count - 1; j++) {
    indices.push(0, j + 1, j);
    const end = (stations.length - 1) * count;
    indices.push(end, end + j, end + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** A thin semicircular fender band, centred on a wheel's local position. */
function createWheelArchGeometry(x, z) {
  const p = [],
    ix = [],
    segments = 22;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI;
    for (const r of [0.411, 0.434]) p.push(x + Math.cos(a) * r, -0.35 + Math.sin(a) * r, z);
  }
  for (let i = 0; i < segments; i++)
    ix.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

/**
 * Create the procedural car at its centre-of-mass origin, facing local +X.
 * Place the returned group at y = ROADSTER_DIMENSIONS.restHeight on the road.
 *
 * Animation hooks are exposed through userData: wheels rotate about local Z;
 * thrusters follow the shared registry order; markDamaged changes body paint.
 * bodyBounds describes only the physical model, excluding hidden exhaust.
 *
 * @param {{color?: THREE.ColorRepresentation, detailed?: boolean}} [options]
 * @returns {THREE.Group} A new car group with independent paint and plume materials.
 */
export function createRoadster({ color = 0xf2f3ed, detailed = true } = {}) {
  const car = new THREE.Group();
  car.name = 'Roadster';

  // Materials and local assembly helpers.
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.4,
    roughness: 0.24,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: 0x11191b,
    roughness: 0.54,
    metalness: 0.42,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x0c1011,
    roughness: 0.86,
    metalness: 0.04,
  });
  const alloy = new THREE.MeshStandardMaterial({
    color: 0x727779,
    roughness: 0.27,
    metalness: 0.87,
  });
  const wheelDisc = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.44,
    metalness: 0.62,
  });
  const goldGlass = new THREE.MeshPhysicalMaterial({
    color: 0x5f5845,
    metalness: 0.78,
    roughness: 0.15,
    clearcoat: 1,
    side: THREE.DoubleSide,
  });
  const headlight = new THREE.MeshBasicMaterial({ color: 0xe4f2ff, toneMapped: false });
  const taillight = new THREE.MeshBasicMaterial({ color: 0xff283a, toneMapped: false });
  const trim = new THREE.LineBasicMaterial({ color: 0x515758, transparent: true, opacity: 0.66 });

  function addMesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], parent = car) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...position);
    m.rotation.set(...rotation);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const addBox = (size, material, position, rotation, parent) =>
    addMesh(new THREE.BoxGeometry(...size), material, position, rotation, parent);

  // Body, undertray, splitter and rear valance.
  addMesh(createBodyShellGeometry(), paint);
  addBox([3.78, 0.065, 1.49], carbon, [-0.11, -0.425, 0]);
  addBox([0.37, 0.065, 1.88], carbon, [2.08, -0.355, 0]);
  addBox([0.07, 0.115, 1.56], carbon, [2.307, -0.265, 0]);
  addBox([0.19, 0.2, 1.89], carbon, [-2.24, -0.275, 0]);

  // The long gold/smoke canopy is a separate, crisp faceted surface.
  const canopyVertices = [
    [1.11, 0.131, 0.77],
    [1.11, 0.131, -0.77],
    [0.34, 0.465, 0.64],
    [0.34, 0.465, -0.64],
    [-0.59, 0.49, 0.61],
    [-0.59, 0.49, -0.61],
    [-1.3, 0.145, 0.76],
    [-1.3, 0.145, -0.76],
  ];
  addMesh(
    createPolygonGeometry(canopyVertices, [
      [0, 1, 3, 2],
      [2, 3, 5, 4],
      [4, 5, 7, 6],
      [0, 2, 4, 6],
      [1, 7, 5, 3],
    ]),
    goldGlass,
  );

  // Raised angular rear haunches flank the tapering canopy, as on the reveal
  // prototype. They are part of the white body, not a conventional rounded boot.
  const haunches = [];
  for (const s of [-1, 1]) {
    const vertices = [
      [-0.5, 0.13, s * 0.88],
      [-1.23, 0.35, s * 0.71],
      [-2.22, 0.15, s * 0.83],
      [-2.22, 0.069, s * 0.99],
      [-1.28, 0.129, s * 1.01],
    ];
    const faces = [
      [0, 1, 2],
      [0, 4, 1],
      [1, 4, 3, 2],
      [0, 2, 3, 4],
    ];
    if (s < 0) for (const f of faces) f.reverse();
    haunches.push({ geometry: createPolygonGeometry(vertices, faces) });
  }
  const haunchPaint = paint.clone();
  haunchPaint.side = THREE.DoubleSide;
  addMesh(mergeTransformedParts(haunches), haunchPaint);

  // Canopy frames, sills, headlamps and rear aerofoil.
  const rails = [];
  for (const s of [-1, 1]) {
    rails.push(
      {
        geometry: new THREE.BoxGeometry(1.06, 0.037, 0.038),
        position: [-0.14, 0.48, s * 0.64],
        rotation: [0, 0, -0.022],
      },
      {
        geometry: new THREE.BoxGeometry(0.85, 0.037, 0.035),
        position: [0.74, 0.304, s * 0.704],
        rotation: [0, 0, -0.412],
      },
      {
        geometry: new THREE.BoxGeometry(0.82, 0.035, 0.034),
        position: [-0.96, 0.311, s * 0.686],
        rotation: [0, 0, 0.46],
      },
      { geometry: new THREE.BoxGeometry(1.8, 0.059, 0.088), position: [0.02, -0.34, s * 0.99] },
    );
  }
  addMesh(mergeTransformedParts(rails), carbon);

  const lights = [];
  for (const s of [-1, 1]) {
    lights.push({
      geometry: new THREE.BoxGeometry(0.43, 0.025, 0.026),
      position: [2.06, -0.12, s * 0.727],
      rotation: [0, s * 0.38, -0.24],
    });
    lights.push({
      geometry: new THREE.BoxGeometry(0.045, 0.02, 0.39),
      position: [2.245, -0.154, s * 0.536],
    });
  }
  addMesh(mergeTransformedParts(lights), headlight);
  addBox([0.033, 0.028, 1.79], taillight, [-2.346, -0.058, 0]);

  // Full-width, thin rear aerofoil with two inward-slanting supports.
  addBox([0.44, 0.065, 2.12], carbon, [-2.04, 0.33, 0], [0, 0, 0.035]);
  addMesh(
    mergeTransformedParts(
      [-1, 1].map((s) => ({
        geometry: new THREE.BoxGeometry(0.13, 0.26, 0.035),
        position: [-2.01, 0.183, s * 0.64],
        rotation: [s * 0.14, 0, 0.24],
      })),
    ),
    carbon,
  );
  addMesh(
    mergeTransformedParts(
      [-1, 1].map((s) => ({
        geometry: new THREE.BoxGeometry(0.48, 0.1, 0.023),
        position: [-2.04, 0.365, s * 1.057],
      })),
    ),
    carbon,
  );

  // Wheels stay separate so the effects controller can animate signed road speed.
  car.userData.wheels = [];
  for (const x of [-1.42, 1.42]) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Group();
      wheel.name = `${x > 0 ? 'front' : 'rear'}-${s > 0 ? 'left' : 'right'}-wheel`;
      wheel.position.set(x, -0.35, s * 0.935);
      car.add(wheel);
      car.userData.wheels.push(wheel);
      const tyre = addMesh(
        new THREE.TorusGeometry(0.284, 0.076, detailed ? 10 : 6, detailed ? 40 : 20),
        rubber,
        [0, 0, 0],
        [0, 0, 0],
        wheel,
      );
      tyre.scale.z = 1.47;
      addMesh(
        new THREE.CylinderGeometry(0.258, 0.258, 0.12, detailed ? 36 : 18),
        carbon,
        [0, 0, 0],
        [Math.PI / 2, 0, 0],
        wheel,
      );
      addMesh(
        new THREE.TorusGeometry(0.25, 0.009, 5, detailed ? 36 : 18),
        alloy,
        [0, 0, s * 0.11],
        [0, 0, 0],
        wheel,
      );
      addMesh(
        new THREE.CylinderGeometry(0.242, 0.242, 0.024, detailed ? 40 : 20),
        wheelDisc,
        [0, 0, s * 0.11],
        [Math.PI / 2, 0, 0],
        wheel,
      );
      addMesh(
        new THREE.CylinderGeometry(0.039, 0.039, 0.012, 12),
        carbon,
        [0, 0, s * 0.129],
        [Math.PI / 2, 0, 0],
        wheel,
      );
    }
  }
  const archPaint = paint.clone();
  archPaint.side = THREE.DoubleSide;
  const arches = [];
  for (const x of [-1.42, 1.42])
    for (const s of [-1, 1]) arches.push({ geometry: createWheelArchGeometry(x, s * 1.012) });
  addMesh(mergeTransformedParts(arches), archPaint);

  // Optional close-view details. The silhouette and actuator layout stay the same.
  if (detailed) {
    const mirrors = [];
    for (const s of [-1, 1]) {
      mirrors.push({
        geometry: new THREE.BoxGeometry(0.14, 0.027, 0.16),
        position: [0.63, 0.19, s * 0.86],
        rotation: [0, -s * 0.3, 0],
      });
      mirrors.push({
        geometry: new THREE.SphereGeometry(0.12, 12, 6),
        position: [0.61, 0.217, s * 0.963],
        scale: [1.4, 0.4, 0.58],
      });
    }
    addMesh(mergeTransformedParts(mirrors), carbon);
    const fins = [];
    for (const z of [-0.67, -0.36, 0, 0.36, 0.67])
      fins.push({
        geometry: new THREE.BoxGeometry(0.38, 0.092, 0.017),
        position: [-2.16, -0.421, z],
        rotation: [0, 0, -0.13],
      });
    addMesh(mergeTransformedParts(fins), carbon);

    const panelSegments = [];
    function segment(a, b) {
      panelSegments.push(...a, ...b);
    }
    for (const s of [-1, 1]) {
      segment([0.97, 0.128, s * 0.8], [0.87, -0.23, s * 1.016]);
      segment([0.87, -0.23, s * 1.016], [-0.8, -0.23, s * 1.016]);
      segment([-0.8, -0.23, s * 1.016], [-0.87, 0.121, s * 0.815]);
      segment([1.18, 0.13, s * 0.54], [2.04, -0.06, s * 0.64]);
      segment([-1.3, 0.129, s * 0.6], [-1.85, 0.099, s * 0.68]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(panelSegments, 3));
    car.add(new THREE.LineSegments(g, trim));
    // Discreet door handles, windscreen divider, and rear plate recess.
    addMesh(
      mergeTransformedParts(
        [-1, 1].map((s) => ({
          geometry: new THREE.BoxGeometry(0.16, 0.011, 0.012),
          position: [-0.48, 0.037, s * 1.015],
        })),
      ),
      carbon,
    );
    addBox([0.027, 0.1, 0.4], carbon, [-2.355, -0.145, 0]);
  }

  // Four rear propulsion outlets. The solver models their balanced resultant
  // as one surge actuator; reverse uses outward-facing deflectors at the rear.
  const nozzleShells = [],
    nozzleHoles = [];
  for (const z of [-0.69, -0.25, 0.25, 0.69]) {
    nozzleShells.push({
      geometry: new THREE.CylinderGeometry(0.108, 0.121, 0.15, 16, 1, true),
      position: [-2.32, -0.235, z],
      rotation: [0, 0, Math.PI / 2],
    });
    nozzleHoles.push({
      geometry: new THREE.CircleGeometry(0.088, 16),
      position: [-2.405, -0.235, z],
      rotation: [0, -Math.PI / 2, 0],
    });
  }
  addMesh(mergeTransformedParts(nozzleShells), alloy);
  addMesh(mergeTransformedParts(nozzleHoles), rubber);
  // Exclude the invisible exhaust volumes when consumers need visual body bounds.
  car.userData.bodyBounds = new THREE.Box3().setFromObject(car);

  // Active exhaust uses the same definitions and ordering as the force solver.
  car.userData.thrusters = [];
  const plumeGeometry = new THREE.ConeGeometry(0.18, 1.0, 10, 1, true).translate(0, -0.5, 0);
  const plumeMaterial = new THREE.MeshBasicMaterial({
    color: 0xbee7ff,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  function addThrusterPlume(definition, position = definition.position, exhaust, suffix = '') {
    const m = new THREE.Mesh(plumeGeometry, plumeMaterial.clone());
    m.position.set(...position);
    const d = exhaust || new THREE.Vector3(...definition.forceDirection).negate().normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    m.visible = false;
    m.name = `${definition.id}${suffix}-plume`;
    car.add(m);
    return { mesh: m, direction: d };
  }
  for (const definition of THRUSTERS) {
    if (definition.axis === 'surge') {
      const reversing = definition.commandSign < 0;
      const outlets = [-0.69, -0.25, 0.25, 0.69].map((z, i) =>
        addThrusterPlume(
          definition,
          [-2.405, -0.235, z],
          new THREE.Vector3(reversing ? 1 : -1, 0, reversing ? Math.sign(z) * 1.7 : 0).normalize(),
          `-${i + 1}`,
        ),
      );
      car.userData.thrusters.push({ ...definition, ...outlets[0], outlets });
    } else {
      car.userData.thrusters.push({ ...definition, ...addThrusterPlume(definition) });
    }
  }

  // Damage tint is reversible; restarting reuses this car and its geometries.
  car.userData.paintMaterials = [paint, archPaint, haunchPaint];
  car.userData.markDamaged = (damaged = true) => {
    for (const m of car.userData.paintMaterials) {
      m.color.set(damaged ? 0x77746f : color);
      m.roughness = damaged ? 0.85 : 0.24;
      m.metalness = damaged ? 0.22 : 0.4;
    }
  };
  return car;
}
