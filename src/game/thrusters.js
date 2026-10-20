// The eight active flight nozzles. Positions and force directions are expressed
// in car coordinates: +X forward, +Y through the roof, +Z toward the left side.
// A visible exhaust plume points opposite its nozzle's forceDirection.
// Forces are game tuning values, not measured specifications of Tesla hardware.
/**
 * @typedef {object} ThrusterConfig
 * @property {string} id Stable identifier shared by physics and exhaust meshes.
 * @property {'lift'|'horizontal'} kind
 * @property {readonly [number, number, number]} position Offset from the car centre of mass, metres.
 * @property {readonly [number, number, number]} forceDirection Fixed local unit vector.
 * @property {number} maxForce Maximum positive force, newtons.
 * @property {-1|1} [side] Sign of local Z for a lift nozzle.
 * @property {'surge'|'strafe'} [axis] Command axis for a horizontal nozzle.
 * @property {-1|1} [commandSign] Command sign that opens a horizontal nozzle.
 */

/** @param {ThrusterConfig} entry @returns {Readonly<ThrusterConfig>} */
const nozzle = (entry) =>
  Object.freeze({
    ...entry,
    position: Object.freeze(entry.position),
    forceDirection: Object.freeze(entry.forceDirection),
  });

/** @type {ReadonlyArray<Readonly<ThrusterConfig>>} */
export const THRUSTERS = Object.freeze([
  nozzle({
    id: 'lift-front-left',
    kind: 'lift',
    position: [1.19, -0.448, 0.64],
    forceDirection: [0, 1, 0],
    side: 1,
    maxForce: 10000,
  }),
  nozzle({
    id: 'lift-rear-left',
    kind: 'lift',
    position: [-1.19, -0.448, 0.64],
    forceDirection: [0, 1, 0],
    side: 1,
    maxForce: 10000,
  }),
  nozzle({
    id: 'lift-front-right',
    kind: 'lift',
    position: [1.19, -0.448, -0.64],
    forceDirection: [0, 1, 0],
    side: -1,
    maxForce: 10000,
  }),
  nozzle({
    id: 'lift-rear-right',
    kind: 'lift',
    position: [-1.19, -0.448, -0.64],
    forceDirection: [0, 1, 0],
    side: -1,
    maxForce: 10000,
  }),
  nozzle({
    id: 'surge-forward',
    kind: 'horizontal',
    position: [-2.24, 0, 0],
    forceDirection: [1, 0, 0],
    axis: 'surge',
    commandSign: 1,
    maxForce: 6500,
  }),
  nozzle({
    id: 'surge-backward',
    kind: 'horizontal',
    position: [2.24, 0, 0],
    forceDirection: [-1, 0, 0],
    axis: 'surge',
    commandSign: -1,
    maxForce: 6500,
  }),
  nozzle({
    id: 'strafe-positive',
    kind: 'horizontal',
    position: [0, 0, 0.97],
    forceDirection: [0, 0, -1],
    axis: 'strafe',
    commandSign: 1,
    maxForce: 6500,
  }),
  nozzle({
    id: 'strafe-negative',
    kind: 'horizontal',
    position: [0, 0, -0.97],
    forceDirection: [0, 0, 1],
    axis: 'strafe',
    commandSign: -1,
    maxForce: 6500,
  }),
]);

/**
 * Sum the local force and r × F torque produced by the actual nozzle levels.
 * totalForce is the sum of individual force magnitudes, not the magnitude of
 * the resultant vector: opposing nozzles both consume gas even if forces cancel.
 * @param {ArrayLike<number>} levels Valve openings in THRUSTERS order, 0…1.
 * @returns {{force: number[], torque: number[], totalForce: number}}
 * Force is in newtons; torque is in N·m; totalForce is in newtons.
 */
export function getThrusterWrench(levels) {
  const force = [0, 0, 0];
  const torque = [0, 0, 0];
  let totalForce = 0;
  for (let i = 0; i < THRUSTERS.length; i++) {
    const t = THRUSTERS[i];
    const level = Math.max(0, Math.min(1, Number.isFinite(levels[i]) ? levels[i] : 0));
    const magnitude = level * t.maxForce;
    const [x, y, z] = t.position;
    const fx = t.forceDirection[0] * magnitude;
    const fy = t.forceDirection[1] * magnitude;
    const fz = t.forceDirection[2] * magnitude;
    force[0] += fx;
    force[1] += fy;
    force[2] += fz;
    torque[0] += y * fz - z * fy;
    torque[1] += z * fx - x * fz;
    torque[2] += x * fy - y * fx;
    totalForce += magnitude;
  }
  return { force, torque, totalForce };
}
