# Rendering and assets

The presentation uses Three.js and native browser APIs. The detailed car comes from the user-supplied [`roadster-rocket.glb`](../src/assets/roadster-rocket.glb), bundled locally with its embedded textures. The ramp, support frames, markings, arena light fixtures and exhaust are built from JavaScript geometry. The asphalt and smoke textures are generated; audio is synthesized.

## Responsibilities

| Module                                                          | Responsibility                                                               | Public interface                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`createRoadster.js`](../src/scene/createRoadster.js)           | GLB loading, normalized geometry, wheel rig and nozzle hooks                 | `await loadRoadster()`; `createRoadster(parsedScene)` |
| [`createVehicleLights.js`](../src/scene/createVehicleLights.js) | Actual headlamp/rear-bar materials, illumination and brake feedback          | `createVehicleLights(car, model)`                     |
| [`createEnvironment.js`](../src/scene/createEnvironment.js)     | Arena, ramp, markings, lighting and static batching                          | `createEnvironment(scene)`                            |
| [`createEffects.js`](../src/scene/createEffects.js)             | Actual thruster plumes, ground vapor, touchdown particles and wheel rotation | `createEffects(scene)`                                |
| [`GameAudio.js`](../src/audio/GameAudio.js)                     | Optional synthesized motor, suction, jet and result sounds                   | `new GameAudio()`                                     |

These modules read game state. They do not apply forces, change the vehicle pose, detect collisions or decide whether a landing succeeds. Those decisions belong to [`FlightGame.js`](../src/game/FlightGame.js). The app copies the simulation position and quaternion onto the car before updating its visual effects.

## Coordinates and dimensions

All positions use metres, times use seconds and rotations use radians.

| Coordinate | Vehicle-local meaning    | Initial world orientation               |
| ---------- | ------------------------ | --------------------------------------- |
| `+X`       | Forward, toward the nose | Along the approach road toward the ramp |
| `+Y`       | Up, through the roof     | Up from the asphalt                     |
| `+Z`       | Left side                | Across the road                         |

The car group's origin is the simulation's centre-of-mass reference. The GLB is already in metres, facing source `−Z`. The adapter rotates it by `−π/2` around Y to face game `+X` and offsets it by `−0.72` metres in Y without scaling. `ROADSTER_DIMENSIONS` records a length of `4.84`, width of `2.118`, rest height of `0.72` and tyre radius of `0.365` metres. Wheel groups rotate around their local Z axes. The flat physics ground is `y = 0`; thin visual surfaces use small offsets to avoid coincident faces.

The curved riding surface follows the ellipse defined by `COURSE` in [`config.js`](../src/game/config.js):

```js
x = COURSE.rampX + COURSE.radiusX * Math.sin(t);
y = COURSE.radiusY * (1 - Math.cos(t));
// 0 <= t <= Math.PI
```

The underside of the horizontal lip continues from the top of that curve. `createEnvironment.js` derives its named `RAMP_PROFILE` from the same configuration. The trusses, lamps, paint offsets and other decorative dimensions are authored separately; inspect those details when making a substantial change to the course dimensions.

## Car loading and rigging

`loadRoadster()` uses Three.js `GLTFLoader` to load the bundled 7.8 MB GLB before the app enables play. Vite emits the model as a local build asset. Its four embedded PNGs require no external texture host. A failed load displays a model-specific startup error.

`createRoadster(parsedScene)` adapts a loaded scene without editing the source asset:

- Clone materials and bake normalized transforms into copies of the geometry.
- Place four wheel pivots at their axle centres. Tyres, spokes, hubs and rotors rotate together; the gold brake calipers remain fixed to the body.
- Batch opaque parts by material within the body or each wheel's animation group. Transparent glass and labels remain separate for sorting. This retains the detailed geometry while reducing draw calls.
- Capture the actual headlamp, rear light and nozzle anchors before removing the original hierarchy.

The factory exposes these animation hooks on `car.userData`:

| Hook                   | Use                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `wheels`               | Four wheel groups. Effects advance `rotation.z` from signed `game.driveSpeed`.                                                 |
| `wheelRadius`          | Actual tyre radius, `0.365` metres, used to convert driving distance into wheel rotation.                                      |
| `brakeCalipers`        | Four fixed groups at the wheel centres, independent of wheel rotation.                                                         |
| `thrusters`            | Eight actuator descriptors in registry order. Surge entries include four rear `outlets`; each outlet has a mesh and direction. |
| `lights`               | Two headlights and targets, front/rear lamp materials, and brake-response `update`/`reset` hooks.                              |
| `bodyBounds`           | Bounds of the car body before the hidden exhaust volumes are added. These are visual bounds, not the collision hull.           |
| `paintMaterials`       | Body materials used by the reversible damage tint.                                                                             |
| `markDamaged(boolean)` | Darken and roughen the body, or restore the normal finish.                                                                     |

The app reuses the car across attempts by resetting wheel/light animation and damage state. Separate cars adapted from the same parsed scene have independent geometry, materials and animation state.

`createVehicleLights.js` illuminates the model's white headlamp guides and daytime strip, with two forward-facing spotlights. The rear light uses the uploaded model's full-width red blade and its existing `MeshPhysicalMaterial.emissive` colour. Its emission follows the exact geometry of the red strip, remaining visible independently of scene lighting. There is no central rear point light or circular spill. Actual grounded `game.braking` increases `emissiveIntensity` from `TAIL_INTENSITY` to `TAIL_INTENSITY + BRAKE_BOOST`; flight controls do not trigger brake lights. Those constants live at the top of `createVehicleLights.js`, and reset restores the normal lamp intensities.

This uses the standard [Three.js emissive material properties](https://threejs.org/docs/#MeshStandardMaterial.emissive). The model supplies the illuminated strip's shape; no additional light geometry, postprocessing or library is needed.

## One registry for eight actuator groups

[`thrusters.js`](../src/game/thrusters.js) is the shared actuator definition. Effects read `game.thrusterLevels` in registry order. Lift and side actuators each drive one outlet; each surge actuator drives the four rear outlets as a balanced group. The GLB's named nozzle lips/rims supply the visual emitter positions, offset slightly beyond the housings to prevent clipping. Physics retains the registry's effective force positions; surge positions represent equivalent resultant-force locations.

| Units                      | Force direction   | Exhaust direction         |
| -------------------------- | ----------------- | ------------------------- |
| Four underbody lifts       | Local `+Y`        | Local `−Y`                |
| Front/back horizontal pair | Local `−X` / `+X` | Opposite the unit's force |
| Left/right horizontal pair | Local `−Z` / `+Z` | Opposite the unit's force |

Lift and side exhaust directions oppose their force direction. The four rear outlets point backward for forward thrust; for reverse/braking they deflect gas forward and outward in balanced pairs. The sideways components cancel, giving the aggregate reverse force. Lift output never reverses. The force solver controls differential lift; the renderer shows the resulting per-unit levels. It does not invent additional pitch jets, counterjets or braking exhaust.

The four rear housings are active propulsion outlets. Forward and reverse remain two one-way control channels in the simplified force solver, sharing those four physical housings; reverse is a thrust-reverser approximation, not rear suction. No front exhaust is drawn. Each channel scales emission for its narrower outlets while retaining enough samples per outlet for a continuous fast jet. All outlets share the same fixed particle budget.

## Exhaust smoke and ground clouds

Each active nozzle has a short, translucent blue core surrounded by textured white/gray smoke. Vapor follows actual `game.thrusterLevels` and each outlet's fixed exhaust direction. Jet speed is 34–50 m/s relative to the nozzle. Births are distributed between the previous and current world-space nozzle positions, with fractional-frame ages and the full nozzle velocity inherited. This avoids detached beads when the car falls fast or renders at a low frame rate. Projected nozzle direction stretches the billboards into overlapping jet streaks; expansion and turbulence break them into fading wisps. Most jet vapor lasts 0.65–1.15 seconds, with sparse residual wisps lasting 1.3–1.8 seconds.

[`createSmokePool.js`](../src/scene/createSmokePool.js) bakes a shared 256 × 256 texture atlas once. Its 16 distinct billows come from integrating density and approximate light attenuation through fractal 3D noise. This gives each puff internal shadows and irregular edges without downloaded textures or an additional particle library. The fragment shader slowly advects the texture to keep the smoke evolving.

Smoke uses camera-facing instanced quads rather than point sprites, so large nearby billows are not limited by the GPU's point-size cap. All smoke kinds share one normal-blended pool, sorted back to front using the current camera before GPU upload. Depth testing lets opaque scene geometry occlude the smoke; smoke does not write depth. A world-height fade blends the lower edges into the road. This is a particle approximation of volumetric smoke, not a fluid simulation or scene-wide fog.

### Ground interaction and persistence

Effects transform each active nozzle origin and exhaust direction into world coordinates. A downward ray intersects the ground plane at:

```js
distance = -worldOrigin.y / worldExhaustDirection.y;
```

Only positive intersections inside the effective range, `6 + 2 * level` metres, produce ground clouds. This works while the car is airborne, including downward-pointing horizontal units when the car banks. An upward-pointing jet cannot disturb the ground.

Closer, stronger jets emit more vapor. Large numbers of translucent wisps expand rapidly around the car, with outward wash traveling at 10–16 m/s and some entrained gas rolling up through the body envelope. Their combined volume can engulf the car without increasing each wisp's opacity into a heavy fire-smoke billow. The cloud dilutes quickly: ground wisps last 1.35–2.25 seconds and fade early as they expand. Jet vapor reaching the road also turns outward instead of bouncing upward. Existing gas remains in world space when the car drives away.

All ground-vapor quantity, expansion, spread, entrainment and lifetime values are grouped in [`effectsConfig.js`](../src/scene/effectsConfig.js) under `GROUND_VAPOR`. Increase `particlesPerSecond` for more volume, `entrainmentFraction` for more gas around/above the body, and `expansionPerSecond` for faster diffusion. Keep opacity low and use `lifetimeMin`/`lifetimeMax` to adjust how quickly it clears. The propulsion jets keep their previous tuning. Touchdown dust and crash sparks remain separate feedback.

### Fixed particle budget

| Pool             | Capacity | Blending and purpose                                    |
| ---------------- | -------: | ------------------------------------------------------- |
| Smoke            |    3,072 | Normal blending; exhaust, ground clouds and crash smoke |
| Crash sparks     |       32 | Additive point sprites; short impact sparks             |
| Touchdown debris |       48 | Normal point sprites; contact dust                      |

The smoke pool uses one instanced draw call and reusable typed arrays for simulation and GPU attributes. It uploads only live instances, sorted together across smoke kinds. Emission uses accumulated seconds rather than one particle per frame. At capacity, a ring buffer reuses the oldest slot. The atlas is shared across effects instances; no per-frame geometry or texture construction is required.

`reset()` clears visibility, emission credits, crash continuations and wheel/plume animation while retaining the allocated objects and buffers. Pausing freezes aging and emission while still updating sort order if the camera orbits. The app passes the current camera as the optional fifth argument to `effects.update(dt, game, car, input, camera)`. An optional sixth argument, `{ vehiclePaused: true }`, freezes vehicle emissions and wheel animation under the result menu while existing vapor keeps dissipating.

## Lighting and performance knobs

The arena uses a dark background, hemisphere fill, white directional floodlighting, two non-shadowing spotlights and subtle red spill. The directional light owns the single shadow map, initially `1024 × 1024`. The car's opaque two-sided materials cast from their back faces to avoid self-shadow banding on shallow body panels. Repeated structural beams and barriers use instancing; repeated static boxes are batched by material within their semantic groups.

Useful places to adjust rendering cost are:

- **Renderer resolution:** the app owns pixel ratio, antialiasing and shadow settings. Resolution changes affect the whole frame.
- **Shadow map size:** change the directional light configuration in `addLights` inside `createEnvironment.js`.
- **Car draw calls:** keep opaque parts batched by material within each animation group; preserve separate transparent surfaces for sorting. Reducing polygon detail requires a revised model asset.
- **Ramp tessellation:** `createRampStrip` defaults to 112 segments. The visible strips and their normals use that subdivision.
- **Particle capacity:** `SMOKE_CAPACITY` in `effectsConfig.js` and the small point-pool constants in `createEffects.js` bound memory and effect density. Emission rates, smoke lifetime, expansion and opacity control cloud fullness and overdraw; check mobile performance when increasing them.

Rendering tuning should preserve actuator IDs and directions, body scale, wheel radius and the riding surface shared with physics. Changing a force or collision tolerance belongs in the game modules rather than a visual effect.

## Audio and lifecycle

`GameAudio` creates its Web Audio graph only when sound is enabled. Enable it from a user click or tap. A continuous sine oscillator represents the motor; filtered noise represents suction and actual jet output. The suction noise starts only when the tyres reach the ramp (`climb`/`inverted` contact stages); the approach road and safe drive-away use motor sound without suction. Temporary result tones disconnect their nodes when finished.

For compatibility, `effects.update(dt, game, car, input)` and `audio.update(game, input, paused)` still accept an `input` argument. Neither uses raw controls to invent actuator activity: both read simulation state. Pass elapsed seconds through the app's frame loop, copy the pose before the effects update, and call touchdown feedback once when entering a terminal result state.

Node tests parse the bundled GLB through a test loader that substitutes simple data textures for its embedded PNGs. They verify the actual geometry, rig, materials, batching and lights without a DOM or WebGL context. Procedural scene and effect construction also run in Node. Decoding the embedded images, pixel-level appearance, shader compilation and audible output still require a browser check.
