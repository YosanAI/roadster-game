// Metres, seconds and radians. These dimensions reconstruct the demonstration;
// they are game geometry, rather than surveyed dimensions of Tesla's course.
/** Dimensions in metres; the painted landing rectangle is informational. */
export const COURSE = Object.freeze({
  startX: -32,
  rampX: 9,
  radiusX: 6.5,
  radiusY: 10.5,
  width: 5.8,
  topEndX: 3.5,
  releaseX: 6.2,
  rideHeight: 0.72,
  groundY: 0,
  landingMinX: -34,
  landingMaxX: 5,
  landingHalfWidth: 7,
});

/** Touchdown thresholds: m/s, m/s, degrees, and rad/s respectively. */
export const LIMITS = Object.freeze({
  impact: 5,
  lateralSpeed: 9,
  tiltDegrees: 15,
  spin: 1.2,
});

/** Downward gravitational acceleration in m/s². */
export const GRAVITY = 9.8;

/** Real, unpaused seconds after touchdown before the result menu appears. */
export const PRESENTATION = Object.freeze({
  successMenuDelaySeconds: 2,
  crashMenuDelaySeconds: 0.75,
});

// Plausible game parameters, not measured specifications of the demonstration
// vehicle. The fan supplies adhesion; the motor still has to lift the car.
/** Vehicle force, inertia, control, and gas-use tuning in SI units. */
export const VEHICLE = Object.freeze({
  mass: 1550, // kg
  rollInertia: 700, // kg·m² about the car's forward axis
  motorPower: 440000, // W
  maxMotorForce: 30000, // N
  suctionForce: 26000, // N
  tyreFriction: 1.25, // dimensionless grip coefficient
  maxBrakeForce: 36000, // N
  rollingResistance: 0.012, // dimensionless resistance coefficient
  dragArea: 0.62, // aerodynamic Cd × frontal area, m²
  airDensity: 1.225, // kg/m³
  rollRate: 3.4, // rad/s at full roll input
  rollResponse: 12, // s⁻¹: roll-rate feedback gain
  fuelPerNewtonSecond: 18 / 40000, // tank percentage points per N·s
});
