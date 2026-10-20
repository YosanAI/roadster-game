import * as THREE from 'three';

const ATLAS_GRID = 4;
const TILE_SIZE = 64;
const clamp = THREE.MathUtils.clamp;

// A small, deterministic volume-noise baker keeps the smoke self-contained:
// no texture downloads, canvas, particle framework, or per-frame ray marching.
function noise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const smooth = (v) => v * v * (3 - 2 * v);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const hash = (a, b, c) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(
      mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx),
      fy,
    ),
    mix(
      mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx),
      fy,
    ),
    fz,
  );
}

function density(x, y, z, seed) {
  const radius = x * x + y * y + z * z;
  if (radius >= 1) return 0;
  let n = 0;
  let amplitude = 0.58;
  let frequency = 2.7;
  for (let octave = 0; octave < 4; octave++) {
    n += amplitude * noise(x * frequency + seed, y * frequency, z * frequency);
    frequency *= 2.05;
    amplitude *= 0.48;
  }
  return Math.max(0, n - 0.27) * 3.6 * Math.pow(1 - radius, 0.65);
}

let smokeAtlas;
function getSmokeAtlas() {
  if (smokeAtlas) return smokeAtlas;
  const size = ATLAS_GRID * TILE_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  for (let tile = 0; tile < ATLAS_GRID * ATLAS_GRID; tile++) {
    const seed = tile * 13.73 + 7.1;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const px = ((x + 0.5) / TILE_SIZE) * 2 - 1;
        const py = ((y + 0.5) / TILE_SIZE) * 2 - 1;
        let transmission = 1;
        let radiance = 0;
        for (let step = 0; step < 12; step++) {
          const pz = 1 - ((step + 0.5) / 12) * 2;
          const d = density(px, py, pz, seed);
          if (d <= 0) continue;
          const shadow = density(px - 0.22, py + 0.28, pz + 0.25, seed);
          const light = 0.48 + 0.5 * Math.exp(-shadow * 1.8);
          const opacity = 1 - Math.exp(-d * 0.34);
          radiance += light * opacity * transmission;
          transmission *= 1 - opacity;
        }
        const alpha = 1 - transmission;
        const brightness = alpha > 0 ? Math.round((radiance / alpha) * 255) : 255;
        const index =
          ((Math.floor(tile / ATLAS_GRID) * TILE_SIZE + y) * size +
            (tile % ATLAS_GRID) * TILE_SIZE +
            x) *
          4;
        pixels[index] = pixels[index + 1] = pixels[index + 2] = brightness;
        pixels[index + 3] = Math.round(alpha * 255);
      }
    }
  }
  smokeAtlas = new THREE.DataTexture(pixels, size, size);
  smokeAtlas.magFilter = THREE.LinearFilter;
  smokeAtlas.minFilter = THREE.LinearMipmapLinearFilter;
  smokeAtlas.generateMipmaps = true;
  smokeAtlas.needsUpdate = true;
  return smokeAtlas;
}

const vertexShader = `
  attribute vec3 aOffset;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRotation;
  attribute float aTile;
  attribute vec3 aColor;
  attribute float aKind;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTile;
  varying float vHeight;
  varying vec3 vColor;
  void main() {
    float c = cos(aRotation), s = sin(aRotation);
    vec2 offset = mat2(c, -s, s, c) * position.xy * aSize;
    vec4 center = viewMatrix * vec4(aOffset, 1.0);
    center.xy += offset;
    gl_Position = projectionMatrix * center;
    vUv = uv;
    vAlpha = aAlpha;
    vTile = aTile;
    vColor = aColor;
    vHeight = aOffset.y + offset.x * viewMatrix[1][0] + offset.y * viewMatrix[1][1];
  }
`;

const fragmentShader = `
  uniform sampler2D smokeAtlas;
  uniform float time;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTile;
  varying float vHeight;
  varying vec3 vColor;
  void main() {
    // Slow internal advection makes the billows evolve as well as rotate/expand.
    vec2 flow = sin(vUv.yx * 8.0 + time * 0.55 + vTile) * 0.018;
    vec2 uv = clamp(vUv + flow, 0.008, 0.992);
    vec2 tile = vec2(mod(vTile, 4.0), floor(vTile / 4.0));
    vec4 smoke = texture2D(smokeAtlas, (tile + uv) / 4.0);
    float alpha = smoke.a * vAlpha * smoothstep(0.015, 0.35, vHeight);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(smoke.rgb * vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Camera-facing, depth-sorted smoke quads, shared by exhaust and ground clouds. */
export function createSmokePool(scene, capacity = 2048) {
  const positions = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const life = new Float32Array(capacity);
  const duration = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const opacity = new Float32Array(capacity);
  const rotation = new Float32Array(capacity);
  const spin = new Float32Array(capacity);
  const tiles = new Uint8Array(capacity);
  const kinds = new Uint8Array(capacity);
  const shades = new Float32Array(capacity);
  const depths = new Float32Array(capacity);
  const active = [];
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  for (const [name, width] of Object.entries({
    aOffset: 3,
    aSize: 1,
    aAlpha: 1,
    aRotation: 1,
    aTile: 1,
    aColor: 3,
    aKind: 1,
  })) {
    geometry.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * width), width).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  }
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { smokeAtlas: { value: getSmokeAtlas() }, time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'thruster-smoke-pool';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  let cursor = 0;
  let elapsed = 0;

  function spawn(point, velocity, options) {
    const i = cursor;
    cursor = (cursor + 1) % capacity;
    const j = i * 3;
    positions[j] = point.x;
    positions[j + 1] = point.y;
    positions[j + 2] = point.z;
    velocities[j] = velocity.x;
    velocities[j + 1] = velocity.y;
    velocities[j + 2] = velocity.z;
    life[i] = duration[i] = options.life;
    size[i] = options.size;
    opacity[i] = options.alpha;
    kinds[i] = options.kind;
    rotation[i] = Math.random() * Math.PI * 2;
    spin[i] = (Math.random() - 0.5) * 0.6;
    tiles[i] = Math.floor(Math.random() * ATLAS_GRID * ATLAS_GRID);
    shades[i] = options.shade ?? 0.78 + Math.random() * 0.2;
  }

  function update(dt, camera) {
    elapsed += dt;
    active.length = 0;
    // CameraRig changes the pose before rendering; refresh it before sorting,
    // including parent transforms and the final lookAt quaternion.
    camera?.updateWorldMatrix(true, false);
    const view = camera?.matrixWorldInverse.elements;
    for (let i = 0; i < capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - dt);
      if (life[i] <= 0) continue;
      const j = i * 3;
      const ground = kinds[i] === 1;
      const drag = Math.exp(-dt * (ground ? 0.85 : 1.35));
      const age = duration[i] - life[i];
      // Decelerating jets entrain air; ground outwash curls upward around the car.
      velocities[j] *= drag;
      velocities[j + 2] *= drag;
      velocities[j + 1] = velocities[j + 1] * drag + dt * (ground ? 0.5 : 0.42);
      const phase = tiles[i] * 1.7 + age * 1.6;
      const turbulence = ground ? 0.36 : 0.22;
      positions[j] += (velocities[j] + Math.sin(phase + positions[j + 2]) * turbulence + 0.12) * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += (velocities[j + 2] + Math.cos(phase + positions[j]) * turbulence) * dt;
      // Exhaust that actually reaches the road rolls along it instead of vanishing.
      if (positions[j + 1] < 0.15) {
        positions[j + 1] = 0.15;
        velocities[j + 1] = Math.abs(velocities[j + 1]) * 0.12;
      }
      rotation[i] += spin[i] * dt;
      depths[i] = view
        ? view[2] * positions[j] +
          view[6] * positions[j + 1] +
          view[10] * positions[j + 2] +
          view[14]
        : 0;
      active.push(i);
    }
    // Normal blending must draw the farthest cloud first, including across kinds.
    if (view) active.sort((a, b) => depths[a] - depths[b]);
    const attributes = geometry.attributes;
    for (let slot = 0; slot < active.length; slot++) {
      const i = active[slot];
      const age = duration[i] - life[i];
      const progress = age / duration[i];
      const ground = kinds[i] === 1;
      const fadeIn = THREE.MathUtils.smoothstep(age, 0, ground ? 0.18 : 0.09);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.35, 1);
      const j = i * 3;
      attributes.aOffset.setXYZ(slot, positions[j], positions[j + 1], positions[j + 2]);
      attributes.aSize.setX(slot, size[i] + age * (ground ? 0.72 : 0.68));
      attributes.aAlpha.setX(slot, clamp(opacity[i] * fadeIn * fadeOut, 0, 1));
      attributes.aRotation.setX(slot, rotation[i]);
      attributes.aTile.setX(slot, tiles[i]);
      attributes.aKind.setX(slot, kinds[i]);
      const shade = shades[i];
      attributes.aColor.setXYZ(slot, shade * 0.96, shade * 0.985, shade);
    }
    geometry.instanceCount = active.length;
    for (const name of ['aOffset', 'aSize', 'aAlpha', 'aRotation', 'aTile', 'aColor', 'aKind']) {
      const attribute = attributes[name];
      attribute.clearUpdateRanges();
      if (active.length > 0) {
        attribute.addUpdateRange(0, active.length * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    material.uniforms.time.value = elapsed;
  }

  function reset() {
    life.fill(0);
    active.length = 0;
    geometry.instanceCount = 0;
    cursor = elapsed = 0;
  }

  return { spawn, update, reset };
}
