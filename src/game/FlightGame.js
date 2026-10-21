import { MathUtils, Quaternion, Vector3 } from 'three';
import { COURSE, LIMITS, GRAVITY, VEHICLE } from './config.js';
import { TRACK, sampleTrack, RAMP_HEIGHT, AXLE_HALF_LENGTH } from './track.js';
import { THRUSTERS, getThrusterWrench } from './thrusters.js';

export { COURSE, LIMITS, GRAVITY, VEHICLE } from './config.js';

/**
 * @typedef {'ready'|'drive'|'climb'|'inverted'|'flight'|'success'|'crashed'} GameStage
 */

/**
 * Player commands; omitted and non-finite values become zero.
 * @typedef {object} GameInput
 * @property {number} [throttle] 0…1, forward motor effort while in contact.
 * @property {number} [brake] 0…1, wheel braking while in contact.
 * @property {number} [roll] -1…1, target roll rate; positive rolls left.
 * @property {number} [lift] 0…1, common level for the four body-up lift nozzles.
 * @property {number} [surge] -1…1, forward/back force in car coordinates.
 * @property {number} [strafe] -1…1, right/left force; positive points local -Z.
 */

/**
 * @typedef {object} LandingResult
 * @property {number} impact Downward contact speed, m/s, including rotation.
 * @property {number} lateralSpeed Total horizontal centre-of-mass speed, m/s.
 * @property {number} tiltDegrees Angle between car-up and world-up, degrees.
 * @property {number} spin Angular speed, rad/s.
 * @property {number} flightTime Airborne simulation time, seconds.
 * @property {number} fuelRemaining Remaining gas as 0…100 tank percentage.
 * @property {boolean} safe Whether the touchdown passed every damage limit.
 * @property {string} reason Human-readable outcome.
 * @property {'safe'|'orientation'|'impact'|'lateral'|'spin'|'ramp'|'bounds'|'timeout'} reasonCode
 * @property {boolean} onRoad Whether the footprint lies inside the painted target.
 */

/** Full four-nozzle lift acceleration, in local +Y, before gravity (m/s²). */
export const MAX_LIFT_ACCELERATION =
  THRUSTERS.filter((t) => t.kind === 'lift').reduce((sum, t) => sum + t.maxForce, 0) / VEHICLE.mass;

// Either side contains two equal nozzles at the same lateral lever arm.
const MAX_ROLL_TORQUE = 2 * Math.abs(THRUSTERS[0].position[2]) * THRUSTERS[0].maxForce;
const SUBSTEP = 1 / 120;
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const FORWARD = X_AXIS;
const SIDE_FORCE = THRUSTERS.find((thruster) => thruster.axis === 'strafe').maxForce;

// Sparse body corners and tyre contacts used for collision support heights.
// These points intentionally remain independent of the rendered car mesh.
const HULL = [];
for (const x of [-2.18, 2.18]) {
  for (const y of [-0.35, 0.52]) {
    for (const z of [-0.95, 0.95]) HULL.push(new Vector3(x, y, z));
  }
}
for (const x of [-AXLE_HALF_LENGTH, AXLE_HALF_LENGTH]) {
  for (const z of [-0.98, 0.98]) HULL.push(new Vector3(x, -COURSE.rideHeight, z));
}

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const control = (value) => MathUtils.clamp(finite(value), -1, 1);

/**
 * Pure simulation. Contact inputs are throttle and brake. Flight inputs are
 * roll, lift, surge and strafe; there is no pitch input or flight wheel brake.
 * Every flight force and roll torque comes from the eight thrusterLevels.
 *
 * The class has no renderer, DOM, audio, or input-device dependencies. The app
 * submits commands with step() and reads state for rendering. Methods prefixed
 * with an underscore are implementation details; external code should not call
 * them or mutate state during an ordinary game.
 */
export class FlightGame {
  /** @param {{flightAssist?: boolean}} [options] Automatic side-drift cancellation. */
  constructor({ flightAssist = true } = {}) {
    /** World-space centre of mass, metres. */
    this.position = new Vector3();
    /** World-space translational velocity, m/s. */
    this.velocity = new Vector3();
    /** Rotation from car coordinates into world coordinates. */
    this.quaternion = new Quaternion();
    /** Car-local angular velocity, rad/s; only X is driven during flight. */
    this.angularVelocity = new Vector3();
    /** Actual 0…1 valve levels in THRUSTERS order, shared with the exhaust visuals. */
    this.thrusterLevels = new Float32Array(THRUSTERS.length);
    /** Actual automatic side correction. Roll remains manual; its assist value is zero. */
    this.assist = { enabled: Boolean(flightAssist), active: false, roll: 0, strafe: 0 };

    // Reused vector/quaternion scratch values avoid per-frame Three.js objects.
    this._up = new Vector3();
    this._rotation = new Quaternion();
    this._midOrientation = new Quaternion();
    this._acceleration = new Vector3();
    this._worldAngular = new Vector3();
    this._contactVelocity = new Vector3();
    this._point = new Vector3();
    this._lowest = new Vector3();
    this.reset();
  }

  /** Reset the complete attempt at the road start. @returns {this} */
  reset() {
    this.position.set(COURSE.startX, COURSE.rideHeight, 0);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);
    this.thrusterLevels.fill(0);
    this._clearAssist();
    /** @type {GameStage} */
    this.stage = 'ready';
    this.inContact = true;
    /** Signed speed along the contact path, m/s; negative means rolling back. */
    this.driveSpeed = 0;
    this.time = 0;
    this.flightTime = 0;
    this.climbProgress = 0;
    this.fuel = 100;
    this.thrust = 0;
    this.braking = 0;
    /** @type {LandingResult|null} */
    this.result = null;
    this._trackDistance = 0;
    this._topContactCleared = false;
    return this;
  }

  /** Enable the pedals without adding speed. @returns {boolean} State changed. */
  start() {
    if (this.stage !== 'ready') return false;
    this.stage = 'drive';
    return true;
  }

  /** Reset stopped and attached at the inverted retry position. @returns {this} */
  resetAtTop() {
    this.reset();
    this._trackDistance = TRACK.retryDistance;
    this._positionOnTrack();
    this.stage = 'inverted';
    return this;
  }

  /**
   * Detach from the inverted lip without an impulse. Normal gameplay drives
   * off the edge automatically; this API also supports focused simulations.
   * @returns {boolean} Whether the car was attached to the inverted lip.
   */
  release() {
    if (!this.inContact || this.stage !== 'inverted') return false;
    this._detach();
    return true;
  }

  _detach() {
    this.inContact = false;
    this.stage = 'flight';
    this.flightTime = 0;
    this.velocity.copy(FORWARD).applyQuaternion(this.quaternion).multiplyScalar(this.driveSpeed);
    this.angularVelocity.set(0, 0, 0);
    this.thrusterLevels.fill(0);
    this._clearAssist();
    this.thrust = 0;
    this.braking = 0;
    this._topContactCleared = false;
  }

  /**
   * Advance simulation using substeps no longer than 1/120 s.
   * @param {number} dt Elapsed seconds; a call processes at most 0.25 s.
   * @param {GameInput} [input] Player commands, independently clamped to range.
   * @returns {void}
   */
  step(dt, input = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // A background-tab interruption is dropped, not played as a giant step.
    // During normal play these are real elapsed seconds, with no time scaling.
    let remaining = Math.min(dt, 0.25);
    const commands = {
      throttle: Math.max(0, control(input.throttle)),
      brake: Math.max(0, control(input.brake)),
      roll: control(input.roll),
      lift: Math.max(0, control(input.lift)),
      surge: control(input.surge),
      strafe: control(input.strafe),
    };
    while (remaining > 1e-9) {
      const h = Math.min(remaining, SUBSTEP);
      remaining -= h;
      if (this.stage === 'drive' || this.stage === 'climb' || this.stage === 'inverted')
        this._stepContact(h, commands);
      else if (this.stage === 'flight') this._stepFlight(h, commands);
      else if (this.stage === 'success' || this.stage === 'crashed') break;
      this.time += h;
    }
  }

  _positionOnTrack() {
    const point = sampleTrack(this._trackDistance);
    this.position.set(point.x, point.y, 0);
    this.quaternion.setFromAxisAngle(Z_AXIS, point.angle);
    this.velocity.set(
      Math.cos(point.angle) * this.driveSpeed,
      Math.sin(point.angle) * this.driveSpeed,
      0,
    );
    this.angularVelocity.set(0, 0, point.curvature * this.driveSpeed);
    this.climbProgress = this._trackDistance / TRACK.length;
    this.stage = point.stage;
    return point;
  }

  _stepContact(dt, commands) {
    this._clearAssist();
    const { throttle, brake } = commands;
    const point = sampleTrack(this._trackDistance);
    const oldSpeed = this.driveSpeed;
    const sine = Math.abs(Math.sin(point.angle)) < 1e-10 ? 0 : Math.sin(point.angle);
    const normalLoad = Math.max(
      0,
      VEHICLE.suctionForce +
        VEHICLE.mass * GRAVITY * Math.cos(point.angle) +
        VEHICLE.mass * oldSpeed * oldSpeed * Math.max(0, point.curvature),
    );
    const tractionLimit = VEHICLE.tyreFriction * normalLoad;
    const motorForce =
      throttle *
      Math.min(
        VEHICLE.maxMotorForce,
        tractionLimit,
        VEHICLE.motorPower / Math.max(3, Math.abs(oldSpeed)),
      );
    const brakeForce = brake * Math.min(VEHICLE.maxBrakeForce, tractionLimit);
    const rollingForce = VEHICLE.rollingResistance * normalLoad;
    const dragForce = 0.5 * VEHICLE.airDensity * VEHICLE.dragArea * oldSpeed * Math.abs(oldSpeed);
    const drivingForce = motorForce - VEHICLE.mass * GRAVITY * sine - dragForce;
    const resistance = rollingForce + brakeForce;
    let newSpeed;
    if (Math.abs(oldSpeed) < 0.02 && Math.abs(drivingForce) <= resistance) {
      newSpeed = 0; // Static tyre/brake force holds the car, including on the wall.
    } else {
      const direction = Math.abs(oldSpeed) >= 0.02 ? Math.sign(oldSpeed) : Math.sign(drivingForce);
      newSpeed = oldSpeed + ((drivingForce - resistance * direction) / VEHICLE.mass) * dt;
      if (oldSpeed * newSpeed < 0 && Math.abs(drivingForce) <= resistance) newSpeed = 0;
    }
    const oldDistance = this._trackDistance;
    const nextDistance = oldDistance + (oldSpeed + newSpeed) * 0.5 * dt;
    this.driveSpeed = newSpeed;
    this.braking = brake;
    this.thrust = 0;
    this.thrusterLevels.fill(0);
    if (nextDistance >= TRACK.length) {
      const fraction = MathUtils.clamp(
        (TRACK.length - oldDistance) / Math.max(1e-12, nextDistance - oldDistance),
        0,
        1,
      );
      this.driveSpeed = MathUtils.lerp(oldSpeed, newSpeed, fraction);
      this._trackDistance = TRACK.length;
      this._positionOnTrack();
      this._detach();
      const airborneTime = dt * (1 - fraction);
      if (airborneTime > 1e-8) this._stepFlight(airborneTime, commands);
    } else {
      this._trackDistance = Math.max(0, nextDistance);
      if (nextDistance < 0) this.driveSpeed = 0;
      this._positionOnTrack();
    }
  }

  /** Allocate one-way valves, charge gas, and return their actual force/torque. */
  _allocateThrusters(commands, dt) {
    this.thrusterLevels.fill(0);
    this._clearAssist();
    if (this.fuel <= 0) return getThrusterWrench(this.thrusterLevels);
    const automaticStrafe = this.assist.enabled && commands.strafe === 0;
    const requestedTorque =
      VEHICLE.rollInertia *
      VEHICLE.rollResponse *
      (commands.roll * VEHICLE.rollRate - this.angularVelocity.x);
    const pairDifference = MathUtils.clamp(requestedTorque / MAX_ROLL_TORQUE, -1, 1);
    // With lift pressed, roll reduces one pair. With lift released, one pair
    // fires by itself. Releasing roll fires the opposite pair to stop rotation.
    // Both cases produce positive local-Y force; there is no downwards nozzle.
    const strongPairLevel = Math.max(commands.lift, Math.abs(pairDifference));
    const weakPairLevel = strongPairLevel - Math.abs(pairDifference);
    for (let i = 0; i < THRUSTERS.length; i++) {
      const thruster = THRUSTERS[i];
      if (thruster.kind === 'lift') {
        const activeSide = pairDifference > 0 ? -1 : 1;
        this.thrusterLevels[i] =
          Math.abs(pairDifference) > 1e-9
            ? thruster.side === activeSide
              ? strongPairLevel
              : weakPairLevel
            : commands.lift;
      } else {
        this.thrusterLevels[i] = Math.max(0, commands[thruster.axis] * thruster.commandSign);
      }
    }
    let wrench = getThrusterWrench(this.thrusterLevels);
    let strafe = commands.strafe;
    if (automaticStrafe) {
      // Cancel sideways travel through the real side jets, compensating for
      // lift while banked. Near 90 degrees these jets have little world-Z
      // authority, so wait for the pilot to roll rather than waste the tank.
      this._point.copy(Z_AXIS).applyQuaternion(this.quaternion);
      if (Math.abs(this._point.z) > 0.25) {
        this._acceleration.fromArray(wrench.force).applyQuaternion(this.quaternion);
        const desiredForceZ = -this.velocity.z * VEHICLE.mass * 2.2;
        strafe = MathUtils.clamp(
          (this._acceleration.z - desiredForceZ) / (SIDE_FORCE * this._point.z),
          -1,
          1,
        );
        for (let i = 0; i < THRUSTERS.length; i++) {
          const thruster = THRUSTERS[i];
          if (thruster.axis === 'strafe')
            this.thrusterLevels[i] = Math.max(0, strafe * thruster.commandSign);
        }
        wrench = getThrusterWrench(this.thrusterLevels);
      }
    }
    let fuelScale = 1;
    const requestedFuel = wrench.totalForce * VEHICLE.fuelPerNewtonSecond * dt;
    if (requestedFuel > this.fuel) {
      fuelScale = this.fuel / requestedFuel;
      for (let i = 0; i < this.thrusterLevels.length; i++) this.thrusterLevels[i] *= fuelScale;
      wrench = getThrusterWrench(this.thrusterLevels);
    }
    this.assist.strafe = automaticStrafe ? strafe * fuelScale : 0;
    this.assist.active = Math.abs(this.assist.strafe) > 0.005;
    this.fuel = Math.max(0, this.fuel - wrench.totalForce * VEHICLE.fuelPerNewtonSecond * dt);
    return wrench;
  }

  _clearAssist() {
    this.assist.active = false;
    this.assist.roll = 0;
    this.assist.strafe = 0;
  }

  _stepFlight(dt, commands) {
    this.flightTime += dt;
    this.braking = 0; // Wheel brakes have no effect without road contact.
    const wrench = this._allocateThrusters(commands, dt);
    const oldRollRate = this.angularVelocity.x;
    const rollAcceleration = wrench.torque[0] / VEHICLE.rollInertia;
    const middleRoll = oldRollRate * dt * 0.5 + 0.5 * rollAcceleration * (dt * 0.5) ** 2;
    const totalRoll = oldRollRate * dt + 0.5 * rollAcceleration * dt * dt;
    this._rotation.setFromAxisAngle(X_AXIS, middleRoll);
    this._midOrientation.copy(this.quaternion).multiply(this._rotation);
    this._acceleration
      .fromArray(wrench.force)
      .applyQuaternion(this._midOrientation)
      .divideScalar(VEHICLE.mass);
    this._acceleration.y -= GRAVITY;
    // Constant-acceleration integration is exact for pure gravity. Changing
    // nozzle directions are integrated at the midpoint of each fixed substep.
    this.position
      .addScaledVector(this.velocity, dt)
      .addScaledVector(this._acceleration, 0.5 * dt * dt);
    this.velocity.addScaledVector(this._acceleration, dt);
    this._rotation.setFromAxisAngle(X_AXIS, totalRoll);
    this.quaternion.multiply(this._rotation).normalize();
    this.angularVelocity.x += rollAcceleration * dt;
    this.thrust =
      (this.thrusterLevels[0] +
        this.thrusterLevels[1] +
        this.thrusterLevels[2] +
        this.thrusterLevels[3]) /
      4;

    const contact = this._measureHull();
    if (contact.lowestY <= COURSE.groundY) {
      this._land(contact);
      return;
    }
    if (this._touchesRamp(contact.highestY)) {
      this._finishCrash('Hit the ramp', 'ramp');
      return;
    }
    if (
      this.position.y > 75 ||
      Math.abs(this.position.z) > 65 ||
      this.position.x < -110 ||
      this.position.x > 75
    ) {
      this._finishCrash('Left the test course', 'bounds');
    } else if (this.flightTime > 45) {
      this._finishCrash('Flight time exceeded', 'timeout');
    }
  }

  /** Measure world bounds and retain the lowest rotated contact offset. */
  _measureHull() {
    let lowestY = Infinity;
    let highestY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const vertex of HULL) {
      this._point.copy(vertex).applyQuaternion(this.quaternion);
      const y = this.position.y + this._point.y;
      if (y < lowestY) {
        lowestY = y;
        this._lowest.copy(this._point);
      }
      highestY = Math.max(highestY, y);
      minX = Math.min(minX, this.position.x + this._point.x);
      maxX = Math.max(maxX, this.position.x + this._point.x);
      minZ = Math.min(minZ, this.position.z + this._point.z);
      maxZ = Math.max(maxZ, this.position.z + this._point.z);
    }
    return { lowestY, highestY, minX, maxX, minZ, maxZ };
  }

  _touchesRamp(highestY) {
    // Do not mistake the tyre contact that existed at release for a collision.
    // Re-arm the ceiling as soon as the complete car has peeled away. Curved
    // ramp collisions remain active throughout departure.
    if (highestY < RAMP_HEIGHT - 0.08) this._topContactCleared = true;
    for (const vertex of HULL) {
      this._point.copy(vertex).applyQuaternion(this.quaternion).add(this.position);
      const { x, y, z } = this._point;
      if (Math.abs(z) > COURSE.width / 2 + 0.1) continue;
      if (
        this._topContactCleared &&
        x >= COURSE.topEndX &&
        x <= COURSE.rampX &&
        y >= RAMP_HEIGHT - 0.045 &&
        y <= RAMP_HEIGHT + 1.6
      )
        return true;
      if (x >= COURSE.rampX && y > 0.05 && y < RAMP_HEIGHT) {
        const verticalFraction = (y - COURSE.radiusY) / COURSE.radiusY;
        const sheetX =
          COURSE.rampX +
          COURSE.radiusX * Math.sqrt(Math.max(0, 1 - verticalFraction * verticalFraction));
        if (x >= sheetX - 0.045) return true;
      }
    }
    return false;
  }

  _landingMetrics() {
    this._worldAngular.copy(this.angularVelocity).applyQuaternion(this.quaternion);
    this._contactVelocity.copy(this._worldAngular).cross(this._lowest).add(this.velocity);
    this._up.copy(UP).applyQuaternion(this.quaternion);
    return {
      impact: Math.max(0, -this.velocity.y, -this._contactVelocity.y),
      lateralSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      tiltDegrees: MathUtils.radToDeg(Math.acos(MathUtils.clamp(this._up.y, -1, 1))),
      spin: this.angularVelocity.length(),
      flightTime: this.flightTime,
      fuelRemaining: this.fuel,
    };
  }

  _land(contact) {
    const metrics = this._landingMetrics();
    // The painted target is guidance only. A sound touchdown elsewhere on the
    // apron is still safe; this flag is informational rather than a damage rule.
    const onRoad =
      contact.minX >= COURSE.landingMinX &&
      contact.maxX <= COURSE.landingMaxX &&
      contact.minZ >= -COURSE.landingHalfWidth &&
      contact.maxZ <= COURSE.landingHalfWidth;
    let reason = 'Landed safe';
    let reasonCode = 'safe';
    if (metrics.tiltDegrees > LIMITS.tiltDegrees) {
      reason = metrics.tiltDegrees > 60 ? 'Roof or side impact' : 'Too much landing tilt';
      reasonCode = 'orientation';
    } else if (metrics.impact > LIMITS.impact) {
      reason = 'Impact too hard';
      reasonCode = 'impact';
    } else if (metrics.lateralSpeed > LIMITS.lateralSpeed) {
      reason = 'Too much sideways speed';
      reasonCode = 'lateral';
    } else if (metrics.spin > LIMITS.spin) {
      reason = 'Still rotating at touchdown';
      reasonCode = 'spin';
    }
    const safe = reasonCode === 'safe';
    this.position.y += COURSE.groundY - contact.lowestY;
    this.result = { ...metrics, safe, reason, reasonCode, onRoad };
    this.stage = safe ? 'success' : 'crashed';
    this.inContact = true;
    this.driveSpeed = 0;
    if (safe) {
      // The suspension absorbs the tolerated residual tilt while preserving
      // the heading at touchdown.
      this._point.copy(FORWARD).applyQuaternion(this.quaternion);
      const yaw = Math.atan2(-this._point.z, this._point.x);
      this.quaternion.setFromAxisAngle(UP, yaw);
      this.position.y = COURSE.rideHeight;
    }
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.thrust = 0;
    this.braking = 0;
    this.thrusterLevels.fill(0);
    this._clearAssist();
  }

  _finishCrash(reason, reasonCode) {
    this.result = { ...this._landingMetrics(), safe: false, reason, reasonCode, onRoad: false };
    this.stage = 'crashed';
    this.driveSpeed = 0;
    this.thrusterLevels.fill(0);
    this._clearAssist();
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.thrust = 0;
    this.braking = 0;
  }

  /**
   * Snapshot for the HUD. Distances are metres, linear speeds m/s, angular
   * speeds rad/s, and times seconds; tiltDegrees and speedKmH are explicit
   * display-unit exceptions. Altitude is the lowest hull clearance, while
   * height is the centre-of-mass Y coordinate. Fuel uses 0…100; thrust and
   * climbProgress use 0…1. Reading telemetry does not advance simulation.
   * @returns {object} Current stage, contact mode, motion, fuel, and progress.
   */
  getTelemetry() {
    this._up.copy(UP).applyQuaternion(this.quaternion);
    const hull = this._measureHull();
    return {
      stage: this.stage,
      mode: this.inContact ? 'drive' : 'flight',
      inContact: this.inContact,
      driveSpeed: this.driveSpeed,
      maxLiftAcceleration: MAX_LIFT_ACCELERATION,
      rollRate: this.angularVelocity.x,
      time: this.time,
      flightTime: this.flightTime,
      altitude: Math.max(0, hull.lowestY - COURSE.groundY),
      height: this.position.y,
      verticalSpeed: this.velocity.y,
      descentSpeed: Math.max(0, -this.velocity.y),
      horizontalSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      speed: this.velocity.length(),
      speedKmH: this.velocity.length() * 3.6,
      tiltDegrees: MathUtils.radToDeg(Math.acos(MathUtils.clamp(this._up.y, -1, 1))),
      spin: this.angularVelocity.length(),
      fuel: this.fuel,
      thrust: this.thrust,
      climbProgress: this.climbProgress,
      assist: { ...this.assist },
    };
  }
}
