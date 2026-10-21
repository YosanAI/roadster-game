// Ground vapor tuning. Keep each wisp translucent; quantity and rapid expansion
// supply the cloud's volume without making it behave like heavy fire smoke.
export const GROUND_VAPOR = Object.freeze({
  particlesPerSecond: 110, // Per full-power outlet, before ground-distance scaling.
  lifetimeMin: 1.35, // Seconds. Residual vapor clears shortly after thrust stops.
  lifetimeMax: 2.25,
  sizeMin: 0.9, // Initial billboard width, metres.
  sizeMax: 1.5,
  expansionPerSecond: 2.25, // Metres per second; fast dilution into the surrounding air.
  opacity: 0.16,
  opacityVariation: 0.06,
  outwardSpeedMin: 10, // Metres per second at full power.
  outwardSpeedMax: 16,
  upwardSpeedMin: 0.75, // Initial entrainment around the body, not sustained buoyancy.
  upwardSpeedMax: 1.7,
  entrainmentFraction: 0.4, // Portion that rolls up around the body before spreading.
  entrainmentOutwardFactor: 0.2,
  entrainmentUpwardBoost: 1.8,
  drag: 1.1,
  turbulence: 0.9,
  billboardWidth: 1.5,
  billboardHeight: 1.1,
});

// One bounded, shared instanced pool; jets retain their existing appearance.
export const SMOKE_CAPACITY = 3072;
