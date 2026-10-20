import { MathUtils } from 'three';
import { COURSE } from './config.js';

/** Shared contact geometry in metres. */
export const RAMP_HEIGHT = COURSE.radiusY * 2;
export const AXLE_HALF_LENGTH = 1.45;
export const DEPARTURE_X = COURSE.topEndX - AXLE_HALF_LENGTH;

/**
 * Sample the road, the inside of the elliptical ramp, and the inverted lip.
 * Arc length is accumulated along the car centre-of-mass path, not the sheet.
 * The order and resolution preserve the original game's integration behavior.
 */
function buildTrack() {
  const points = [];
  const add = (x, y, angle) => {
    const previous = points.at(-1);
    const distance = previous ? previous.distance + Math.hypot(x - previous.x, y - previous.y) : 0;
    points.push({ x, y, angle, distance });
  };
  add(COURSE.startX, COURSE.rideHeight, 0);
  add(COURSE.rampX, COURSE.rideHeight, 0);
  const groundEnd = points.at(-1).distance;
  for (let i = 1; i <= 320; i++) {
    const t = (Math.PI * i) / 320;
    const angle = Math.atan2(COURSE.radiusY * Math.sin(t), COURSE.radiusX * Math.cos(t));
    add(
      COURSE.rampX + COURSE.radiusX * Math.sin(t) - COURSE.rideHeight * Math.sin(angle),
      COURSE.radiusY * (1 - Math.cos(t)) + COURSE.rideHeight * Math.cos(angle),
      angle,
    );
  }
  const curveEnd = points.at(-1).distance;
  add(COURSE.releaseX, RAMP_HEIGHT - COURSE.rideHeight, Math.PI);
  const retryDistance = points.at(-1).distance;
  // The front wheels cross the edge first. Contact ends when the trailing axle
  // clears it; the centre of mass is then about 2.05 m along the world X axis.
  add(DEPARTURE_X, RAMP_HEIGHT - COURSE.rideHeight, Math.PI);
  return { points, groundEnd, curveEnd, retryDistance, length: points.at(-1).distance };
}

export const TRACK = buildTrack();

/**
 * Interpolate the constrained driving pose at a distance along the track.
 * @param {number} distance Metres measured from the starting position.
 * @returns {{x: number, y: number, angle: number, curvature: number, stage: 'drive'|'climb'|'inverted'}}
 * Angle is in radians; curvature is angle change per metre.
 */
export function sampleTrack(distance) {
  let low = 0;
  let high = TRACK.points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (TRACK.points[middle].distance < distance) low = middle;
    else high = middle;
  }
  const a = TRACK.points[low];
  const b = TRACK.points[high];
  const length = b.distance - a.distance;
  const mix = MathUtils.clamp((distance - a.distance) / length, 0, 1);
  return {
    x: MathUtils.lerp(a.x, b.x, mix),
    y: MathUtils.lerp(a.y, b.y, mix),
    angle: MathUtils.lerp(a.angle, b.angle, mix),
    curvature: (b.angle - a.angle) / length,
    stage: distance < TRACK.groundEnd ? 'drive' : distance < TRACK.curveEnd ? 'climb' : 'inverted',
  };
}
