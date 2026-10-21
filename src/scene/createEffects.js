import * as THREE from 'three';
import { createSmokePool } from './createSmokePool.js';
import { GROUND_VAPOR } from './effectsConfig.js';

const SPARK_COUNT = 32;
const DEBRIS_COUNT = 48;
const clamp = THREE.MathUtils.clamp;

// Pool sizes and sprite kinds are rendering-only tuning; no game forces live here.
const PARTICLE_KIND = Object.freeze({
  DUST: 1,
  SPARK: 2,
});

const vertexShader = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(aSize * 420.0 / max(1.0, -viewPosition.z), 1.0, 110.0);
  }
`;

const fragmentShader = `
  uniform float flatten;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 delta = gl_PointCoord * 2.0 - 1.0;
    delta.y /= flatten;
    float radiusSquared = dot(delta, delta);
    if (radiusSquared > 1.0 || vAlpha < 0.001) discard;
    float softness = pow(1.0 - radiusSquared, 1.7);
    gl_FragColor = vec4(vColor, vAlpha * softness);
    #include <colorspace_fragment>
  }
`;

/**
 * Allocate one fixed-capacity particle pool and its GPU buffers once.
 * Spawning reuses a ring-buffer slot; reset clears visibility without reallocating.
 * @param {THREE.Scene} scene
 * @param {number} count Maximum live particles before the oldest slot is reused.
 * @param {{additive: boolean, name: string, flatten?: number}} options
 */
function createParticlePool(scene, count, { additive, name, flatten = 1 }) {
  const position = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const life = new Float32Array(count);
  const duration = new Float32Array(count);
  const initialSize = new Float32Array(count);
  const initialAlpha = new Float32Array(count);
  const particleKinds = new Uint8Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aColor',
    new THREE.BufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aSize',
    new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    'aAlpha',
    new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage),
  );
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { flatten: { value: flatten } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;
  points.renderOrder = additive ? 2 : 1;
  scene.add(points);
  let cursor = 0;

  function spawn(p, v, options) {
    const i = cursor;
    cursor = (cursor + 1) % count;
    const j = i * 3;
    position[j] = p.x;
    position[j + 1] = p.y;
    position[j + 2] = p.z;
    velocity[j] = v.x;
    velocity[j + 1] = v.y;
    velocity[j + 2] = v.z;
    color[j] = options.color[0];
    color[j + 1] = options.color[1];
    color[j + 2] = options.color[2];
    life[i] = duration[i] = options.life;
    size[i] = initialSize[i] = options.size;
    alpha[i] = initialAlpha[i] = options.alpha;
    particleKinds[i] = options.kind;
  }

  function update(dt) {
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      life[i] = Math.max(0, life[i] - dt);
      const progress = 1 - life[i] / duration[i];
      const j = i * 3;
      const particleKind = particleKinds[i];
      const dragRate = particleKind === PARTICLE_KIND.SPARK ? 0.5 : 2.4;
      const drag = Math.exp(-dt * dragRate);
      velocity[j] *= drag;
      velocity[j + 2] *= drag;
      velocity[j + 1] += (particleKind === PARTICLE_KIND.SPARK ? -7.5 : -1.4) * dt;
      position[j] += velocity[j] * dt;
      position[j + 1] += velocity[j + 1] * dt;
      position[j + 2] += velocity[j + 2] * dt;
      if (position[j + 1] < 0.045) {
        position[j + 1] = 0.045;
        velocity[j + 1] =
          Math.abs(velocity[j + 1]) * (particleKind === PARTICLE_KIND.SPARK ? 0.18 : 0.04);
      }
      size[i] =
        initialSize[i] * (1 + progress * (particleKind === PARTICLE_KIND.SPARK ? -0.4 : 2.0));
      alpha[i] =
        life[i] > 0
          ? initialAlpha[i] *
            Math.pow(1 - progress, particleKind === PARTICLE_KIND.SPARK ? 0.6 : 1.1)
          : 0;
    }
    for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
  }

  function reset() {
    life.fill(0);
    alpha.fill(0);
    velocity.fill(0);
    cursor = 0;
    geometry.attributes.aAlpha.needsUpdate = true;
  }

  return { spawn, update, reset, points };
}

/**
 * Reads the eight actual actuator outputs in registry order. The renderer never
 * invents stabilizing jets, reverses an upward lift, or turns road brakes into
 * exhaust. A surge output is distributed over four balanced rear outlets;
 * reverse deflects their exhaust outward/forward instead of using a nose jet.
 *
 * Textured, depth-sorted smoke billboards share one fixed GPU pool. Ground
 * outwash is emitted at exhaust/ground intersections during the burn and curls
 * outward in plentiful, translucent clouds that rapidly dilute. Separate small
 * point pools preserve the fast sparks and one-shot touchdown debris.
 *
 * @param {THREE.Scene} scene The scene receiving the reusable particle objects.
 * @returns {{update: Function, touchdown: Function, reset: Function}}
 */
export function createEffects(scene) {
  const smoke = createSmokePool(scene);
  const sparks = createParticlePool(scene, SPARK_COUNT, {
    additive: true,
    name: 'crash-spark-pool',
  });
  const debris = createParticlePool(scene, DEBRIS_COUNT, {
    additive: false,
    name: 'touchdown-debris-pool',
  });
  const point = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const lastOrigin = new THREE.Vector3();
  const emitterVelocity = new THREE.Vector3();
  const impactPoint = new THREE.Vector3();
  const smokeOrigin = new THREE.Vector3();
  let boundCar = null;
  let emitters = [];
  let emissionCredit = new Float32Array(0);
  let groundCredit = new Float32Array(0);
  let previousLevels = new Float32Array(0);
  let previousOrigins = new Float64Array(0);
  let hasOrigin = new Uint8Array(0);
  let elapsed = 0;
  let smokeTime = 0;
  let smokeCredit = 0;

  // Car binding and actuator-driven emission. Pools survive attempts and resets.

  function bind(car) {
    if (car === boundCar) return;
    boundCar = car;
    emitters = (car?.userData?.thrusters || []).flatMap((emitter, actuatorIndex) =>
      (emitter.outlets || [emitter]).map((outlet) => ({
        ...outlet,
        actuatorIndex,
        emissionShare: 1 / (emitter.outlets?.length || 1),
      })),
    );
    emissionCredit = new Float32Array(emitters.length);
    groundCredit = new Float32Array(emitters.length);
    previousLevels = new Float32Array(emitters.length);
    previousOrigins = new Float64Array(emitters.length * 3);
    hasOrigin = new Uint8Array(emitters.length);
  }

  function emitGroundMist(level, closeness) {
    const angle = Math.random() * Math.PI * 2;
    const entrained = Math.random() < GROUND_VAPOR.entrainmentFraction;
    const spread =
      THREE.MathUtils.lerp(
        GROUND_VAPOR.outwardSpeedMin,
        GROUND_VAPOR.outwardSpeedMax,
        Math.random(),
      ) *
      (0.55 + level * 0.45) *
      (entrained ? GROUND_VAPOR.entrainmentOutwardFactor : 1);
    point.copy(impactPoint);
    point.x += (Math.random() - 0.5) * 0.35;
    point.y = 0.25 + Math.random() * 0.25;
    point.z += (Math.random() - 0.5) * 0.35;
    velocity.set(
      Math.cos(angle) * spread + direction.x * 1.5,
      THREE.MathUtils.lerp(
        GROUND_VAPOR.upwardSpeedMin,
        GROUND_VAPOR.upwardSpeedMax,
        Math.random(),
      ) + (entrained ? GROUND_VAPOR.entrainmentUpwardBoost : 0),
      Math.sin(angle) * spread + direction.z * 1.5,
    );
    smoke.spawn(point, velocity, {
      life: THREE.MathUtils.lerp(GROUND_VAPOR.lifetimeMin, GROUND_VAPOR.lifetimeMax, Math.random()),
      size: THREE.MathUtils.lerp(GROUND_VAPOR.sizeMin, GROUND_VAPOR.sizeMax, Math.random()),
      alpha:
        (GROUND_VAPOR.opacity + Math.random() * GROUND_VAPOR.opacityVariation) *
        (0.55 + closeness * 0.45) *
        (0.65 + level * 0.35),
      kind: 1,
    });
  }

  /**
   * Advance visual effects after copying the simulation pose onto the car.
   * @param {number} dt Elapsed visual seconds; excessive background-tab gaps are capped.
   * @param {import('../game/FlightGame.js').FlightGame} game Read-only simulation state.
   * @param {THREE.Group} car The group returned by createRoadster.
   * @param {object} [input] Reserved for API compatibility; actual actuator levels drive jets.
   * @param {THREE.Camera} [camera] Current view for back-to-front smoke sorting.
   * @param {{vehiclePaused?: boolean}} [options] Keep vapor fading while the result menu freezes the car.
   */
  function update(dt, game, car, input = {}, camera, { vehiclePaused = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0) return;
    if (dt === 0) {
      // Orbiting remains available while paused; re-sort without aging/emitting.
      smoke.update(0, camera);
      return;
    }
    dt = Math.min(dt, 0.25);
    elapsed += dt;
    bind(car);

    if (car && game && !vehiclePaused) {
      car.updateWorldMatrix(true, false);
      for (let i = 0; i < emitters.length; i++) {
        const emitter = emitters[i];
        const plume = emitter.mesh;
        const rawLevel = game.thrusterLevels?.[emitter.actuatorIndex];
        const level = Number.isFinite(rawLevel) ? clamp(rawLevel, 0, 1) : 0;
        const wasActive = previousLevels[i] > 0.0001;
        previousLevels[i] = level;
        origin.copy(plume.position).applyMatrix4(car.matrixWorld);
        if (hasOrigin[i]) {
          lastOrigin.fromArray(previousOrigins, i * 3);
          emitterVelocity.subVectors(origin, lastOrigin).divideScalar(dt);
        } else {
          emitterVelocity.copy(game.velocity || { x: 0, y: 0, z: 0 });
          lastOrigin.copy(origin).addScaledVector(emitterVelocity, -dt);
        }
        previousOrigins[i * 3] = origin.x;
        previousOrigins[i * 3 + 1] = origin.y;
        previousOrigins[i * 3 + 2] = origin.z;
        hasOrigin[i] = 1;
        plume.visible = level > 0.0001;
        if (!plume.visible) {
          emissionCredit[i] = 0;
          groundCredit[i] = 0;
          continue;
        }

        // Outlets retain their fixed car-local direction. The four rear outlets
        // represent the same aggregate surge force as the simulation actuator.
        direction.copy(emitter.direction).transformDirection(car.matrixWorld);
        const rayDistance =
          direction.y < -0.015 && origin.y > 0 ? -origin.y / direction.y : Infinity;
        const range = 6 + level * 2;
        const hitsGround = rayDistance > 0 && rayDistance <= range;
        const closeness = hitsGround ? 1 - rayDistance / range : 0;
        const flicker = 1 + Math.sin(elapsed * 57 + i * 2.31) * 0.07;
        const width = 0.1 + Math.sqrt(level * emitter.emissionShare) * 0.5;
        // Keep only a short translucent nozzle core; textured smoke forms the plume.
        const jetLength = (0.15 + level * 1.25) * flicker;
        plume.scale.set(width, hitsGround ? Math.min(jetLength, rayDistance) : jetLength, width);
        plume.material.opacity = 0.015 + level * 0.06;

        // Pooled emission rates use accumulated seconds, so the same actuator
        // burn produces the same average density at different render rates.
        // Splitting a channel over four narrower rear outlets still needs
        // enough samples per outlet to keep a 50 m/s jet connected.
        const rate = 240 * level * Math.sqrt(emitter.emissionShare);
        emissionCredit[i] += dt * rate;
        if (!wasActive) emissionCredit[i] = Math.max(1, emissionCredit[i]);
        while (emissionCredit[i] >= 1) {
          emissionCredit[i] -= 1;
          // Distribute births over the frame's moving nozzle path. Every puff
          // inherits the full nozzle velocity, so a fast falling car still
          // leaves a continuous jet instead of isolated frame-spaced clusters.
          const age = clamp((emissionCredit[i] + (Math.random() - 0.5) * 0.5) / rate, 0, dt);
          point
            .lerpVectors(lastOrigin, origin, 1 - age / dt)
            .addScaledVector(direction, Math.min(0.04 + Math.random() * 0.06, rayDistance * 0.6));
          point.x += (Math.random() - 0.5) * 0.04;
          point.y += (Math.random() - 0.5) * 0.04;
          point.z += (Math.random() - 0.5) * 0.04;
          velocity
            .copy(direction)
            .multiplyScalar(34 + level * 16)
            .add(emitterVelocity);
          velocity.x += (Math.random() - 0.5) * 1.2;
          velocity.y += (Math.random() - 0.5) * 1.2;
          velocity.z += (Math.random() - 0.5) * 1.2;
          const wisp = Math.random() < 0.15;
          smoke.spawn(point, velocity, {
            life: wisp ? 1.3 + Math.random() * 0.5 : 0.65 + Math.random() * 0.5,
            size: (0.13 + Math.random() * 0.08) * Math.sqrt(emitter.emissionShare),
            alpha: (wisp ? 0.06 : 0.15) + level * 0.08,
            kind: 0,
            direction,
            delay: dt - age,
          });
        }

        if (hitsGround) {
          impactPoint.copy(origin).addScaledVector(direction, rayDistance);
          groundCredit[i] +=
            dt *
            GROUND_VAPOR.particlesPerSecond *
            level *
            (0.25 + closeness * 0.75) *
            emitter.emissionShare;
          // A first wisp appears immediately when an active jet reaches the
          // asphalt, including burns made while the vehicle is still airborne.
          if (!wasActive) groundCredit[i] = Math.max(1, groundCredit[i]);
          while (groundCredit[i] >= 1) {
            groundCredit[i] -= 1;
            emitGroundMist(level, closeness);
          }
        } else groundCredit[i] = 0;
      }

      if (game.inContact || ['drive', 'climb', 'inverted'].includes(game.stage)) {
        const speed = Number.isFinite(game.driveSpeed) ? game.driveSpeed : 0;
        const spin = (-speed / 0.36) * dt;
        for (const wheel of car.userData.wheels || []) wheel.rotation.z += spin;
      }
    }

    if (smokeTime > 0) {
      smokeTime = Math.max(0, smokeTime - dt);
      smokeCredit += dt * 15 * Math.min(1, smokeTime);
      while (smokeCredit >= 1) {
        smokeCredit -= 1;
        point.copy(smokeOrigin);
        point.x += (Math.random() - 0.5) * 0.8;
        point.z += (Math.random() - 0.5) * 0.5;
        velocity.set(
          (Math.random() - 0.5) * 0.3,
          0.5 + Math.random() * 0.7,
          (Math.random() - 0.5) * 0.3,
        );
        smoke.spawn(point, velocity, {
          life: 3 + Math.random() * 1.5,
          size: 0.45 + Math.random() * 0.3,
          alpha: 0.55,
          shade: 0.24,
          kind: 2,
        });
      }
    }
    smoke.update(dt, camera);
    sparks.update(dt);
    debris.update(dt);
  }

  // One-shot contact feedback is separate from continuously emitted ground mist.

  /**
   * Trigger contact dust, or a brief crash burst, once when the run finishes.
   * @param {boolean} safe Whether the simulation accepted the landing.
   * @param {number} impact Impact speed in metres per second, used only for visual strength.
   * @param {THREE.Vector3} position World-space vehicle position at contact.
   */
  function touchdown(safe, impact, position) {
    const strength = clamp((Number(impact) || 0) / 8, 0.25, 1.7);
    const landingPosition = position || { x: 0, y: 0, z: 0 };
    const count = safe ? 26 : 35;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.65 + Math.random() * 2.0) * strength;
      point.set(
        landingPosition.x + (Math.random() - 0.5) * 3.0,
        Math.max(0.06, landingPosition.y - 0.64),
        landingPosition.z + (Math.random() - 0.5) * 1.8,
      );
      velocity.set(Math.cos(angle) * speed, 0.25 + Math.random() * 0.8, Math.sin(angle) * speed);
      debris.spawn(point, velocity, {
        life: 0.55 + Math.random() * 0.8,
        size: 0.2 + Math.random() * 0.36,
        alpha: safe ? 0.21 : 0.28,
        color: safe ? [0.46, 0.46, 0.41] : [0.26, 0.27, 0.25],
        kind: PARTICLE_KIND.DUST,
      });
    }
    if (!safe) {
      for (let i = 0; i < 24; i++) {
        point.set(
          landingPosition.x + (Math.random() - 0.5) * 1.8,
          Math.max(0.1, landingPosition.y - 0.38),
          landingPosition.z + (Math.random() - 0.5) * 1.1,
        );
        velocity.set(
          (Math.random() - 0.5) * 6 * strength,
          (0.7 + Math.random() * 2.6) * strength,
          (Math.random() - 0.5) * 5 * strength,
        );
        sparks.spawn(point, velocity, {
          life: 0.18 + Math.random() * 0.36,
          size: 0.035 + Math.random() * 0.025,
          alpha: 0.8,
          color: [0.75, 0.34, 0.12],
          kind: PARTICLE_KIND.SPARK,
        });
      }
      smokeOrigin.set(landingPosition.x - 0.9, landingPosition.y + 0.22, landingPosition.z);
      smokeTime = 2.2;
      smokeCredit = 0;
    }
  }

  /** Clear an attempt's particles and wheel/plume animation without rebuilding assets. */
  function reset() {
    smoke.reset();
    sparks.reset();
    debris.reset();
    smokeTime = 0;
    smokeCredit = 0;
    elapsed = 0;
    emissionCredit.fill(0);
    groundCredit.fill(0);
    previousLevels.fill(0);
    hasOrigin.fill(0);
    for (const emitter of emitters) {
      emitter.mesh.visible = false;
      emitter.mesh.scale.set(1, 1, 1);
      emitter.mesh.material.opacity = 0.52;
    }
    for (const wheel of boundCar?.userData?.wheels || []) wheel.rotation.z = 0;
  }

  return { update, touchdown, reset };
}
