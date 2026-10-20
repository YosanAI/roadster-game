# Rendering and procedural assets

The presentation uses Three.js and native browser APIs. The car, ramp, support frames, markings, light fixtures and exhaust are built from JavaScript geometry. The asphalt texture is generated from deterministic pixel data. There are no downloaded models, image textures, recorded sound files or rendering frameworks.

## Responsibilities

| Module                                                      | Responsibility                                                               | Public interface                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| [`createRoadster.js`](../src/scene/createRoadster.js)       | Car geometry, materials and animation hooks                                  | `createRoadster({ color, detailed })` |
| [`createEnvironment.js`](../src/scene/createEnvironment.js) | Arena, ramp, markings, lighting and static batching                          | `createEnvironment(scene)`            |
| [`createEffects.js`](../src/scene/createEffects.js)         | Actual thruster plumes, ground vapor, touchdown particles and wheel rotation | `createEffects(scene)`                |
| [`GameAudio.js`](../src/audio/GameAudio.js)                 | Optional synthesized motor, suction, jet and result sounds                   | `new GameAudio()`                     |

These modules read game state. They do not apply forces, change the vehicle pose, detect collisions or decide whether a landing succeeds. Those decisions belong to [`FlightGame.js`](../src/game/FlightGame.js). The app copies the simulation position and quaternion onto the car before updating its visual effects.

## Coordinates and dimensions

All positions use metres, times use seconds and rotations use radians.

| Coordinate | Vehicle-local meaning    | Initial world orientation               |
| ---------- | ------------------------ | --------------------------------------- |
| `+X`       | Forward, toward the nose | Along the approach road toward the ramp |
| `+Y`       | Up, through the roof     | Up from the asphalt                     |
| `+Z`       | Left side                | Across the road                         |

The car group's origin is the simulation's centre-of-mass reference. `ROADSTER_DIMENSIONS.restHeight` is `0.72` metres. Wheel groups rotate around their local Z axes, and the visual tyre radius is `0.36` metres. The flat physics ground is `y = 0`; thin visual surfaces use small offsets to avoid coincident faces.

The curved riding surface follows the ellipse defined by `COURSE` in [`config.js`](../src/game/config.js):

```js
x = COURSE.rampX + COURSE.radiusX * Math.sin(t);
y = COURSE.radiusY * (1 - Math.cos(t));
// 0 <= t <= Math.PI
```

The underside of the horizontal lip continues from the top of that curve. `createEnvironment.js` derives its named `RAMP_PROFILE` from the same configuration. The trusses, lamps, paint offsets and other decorative dimensions are authored separately; inspect those details when making a substantial change to the course dimensions.

## Car construction

`createRoadster` builds a lofted body from cross sections along X. The outer lower edges rise over the wheels, leaving actual wheel openings. Separate polygon surfaces form the canopy and angular rear haunches. Tyres, closed aero discs, lamps, mirrors, sill details, the rear wing and diffuser complete the model.

The geometry helpers have distinct purposes:

- `createBodyShellGeometry` generates the body loft and wheel openings.
- `createPolygonGeometry` triangulates faceted panels with separate face normals.
- `createWheelArchGeometry` creates the narrow fender bands.
- `mergeTransformedParts` bakes many same-material details into one geometry. It consumes and disposes the supplied temporary geometries after copying their vertices.

The factory exposes these animation hooks on `car.userData`:

| Hook                   | Use                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `wheels`               | Four wheel groups. Effects advance `rotation.z` from signed `game.driveSpeed`.                                       |
| `thrusters`            | Eight plume descriptors in shared registry order. Each includes its ID, definition, mesh and exhaust direction.      |
| `bodyBounds`           | Bounds of the car body before the hidden exhaust volumes are added. These are visual bounds, not the collision hull. |
| `paintMaterials`       | Body materials used by the reversible damage tint.                                                                   |
| `markDamaged(boolean)` | Darken and roughen the body, or restore the normal finish.                                                           |

`detailed: false` reduces wheel tessellation and omits small close-view details. It preserves the overall silhouette, wheel hooks and eight-unit actuator layout. The app can reuse the same car across attempts by resetting animation and damage state.

## One registry for all eight emitters

[`thrusters.js`](../src/game/thrusters.js) is the shared actuator definition. The car creates its plume meshes from that registry, and effects read `game.thrusterLevels` in the same order.

| Units                      | Force direction   | Exhaust direction         |
| -------------------------- | ----------------- | ------------------------- |
| Four underbody lifts       | Local `+Y`        | Local `−Y`                |
| Front/back horizontal pair | Local `−X` / `+X` | Opposite the unit's force |
| Left/right horizontal pair | Local `−Z` / `+Z` | Opposite the unit's force |

For every unit, `exhaustDirection = -forceDirection`. Lift output never reverses. The force solver controls differential lift; the renderer shows the resulting per-unit levels. It does not invent additional pitch jets, counterjets or braking exhaust.

The four decorative rear outlet housings are part of the car's appearance. They are separate from the eight active registry entries and are not animated as extra controls. Effects never relocate or rotate a registered emitter to make a visual approximation of a different force.

## Exhaust and ground vapor

Each active emitter has a pale blue cone and a pooled vapor trail. Plume length, width and opacity follow that emitter's actual output. The cone geometry is aligned with local `−Y` before its fixed nozzle orientation is applied.

For ground interaction, effects transform the nozzle origin and exhaust direction into world coordinates. A downward ray intersects the ground plane when:

```js
distance = -worldOrigin.y / worldExhaustDirection.y;
```

Only positive intersections inside the effective range, `6 + 2 * level` metres, produce ground mist. This works while the car is still airborne. A downward-pointing horizontal unit can also produce mist after the car rotates; an upward-pointing jet cannot.

The blue cone is clipped at the asphalt. White/gray mist then spreads sideways from the intersection, staying close to the ground and fading after the burn. It is localized particle geometry, not `scene.fog`, and is independent of the one-shot touchdown dust.

### Fixed particle budget

| Pool             | Capacity | Blending and purpose                                  |
| ---------------- | -------: | ----------------------------------------------------- |
| Vapor            |      112 | Additive blue gas and short crash sparks              |
| Ground mist      |       80 | Normal blending; flattened white/gray ground wisps    |
| Touchdown debris |       48 | Normal blending; contact dust and limited crash smoke |
| **Total**        |  **240** | **Three `THREE.Points` objects**                      |

Each pool owns reusable typed arrays for position, velocity, color, size, alpha and lifetime. Emission uses accumulated seconds rather than one particle per frame. When a pool fills, its ring buffer reuses the oldest slot. Shader-generated soft sprites require no image textures.

`reset()` clears particle visibility, emission credits and wheel/plume animation. It keeps the existing objects and GPU buffers for the next attempt. The normal update path does not construct new particle geometries.

## Lighting and performance knobs

The arena uses a dark background, hemisphere fill, white directional floodlighting, two non-shadowing spotlights and subtle red spill. The directional light owns the single shadow map, initially `1024 × 1024`. Repeated structural beams and barriers use instancing; repeated static boxes are batched by material within their semantic groups.

Useful places to adjust rendering cost are:

- **Renderer resolution:** the app owns pixel ratio, antialiasing and shadow settings. Resolution changes affect the whole frame.
- **Shadow map size:** change the directional light configuration in `addLights` inside `createEnvironment.js`.
- **Car detail:** choose `createRoadster({ detailed: false })` for fewer wheel segments and decorative parts.
- **Ramp tessellation:** `createRampStrip` defaults to 112 segments. The visible strips and their normals use that subdivision.
- **Particle capacity:** the three pool constants at the top of `createEffects.js` bound memory and effect density. Emission rates, mist lifetime and sprite flattening are nearby rendering controls.

Rendering tuning should preserve actuator IDs and directions, body scale, wheel radius and the riding surface shared with physics. Changing a force or collision tolerance belongs in the game modules rather than a visual effect.

## Audio and lifecycle

`GameAudio` creates its Web Audio graph only when sound is enabled. Enable it from a user click or tap. A continuous sine oscillator represents the motor; filtered noise represents suction and actual jet output. Temporary result tones disconnect their nodes when finished.

For compatibility, `effects.update(dt, game, car, input)` and `audio.update(game, input, paused)` still accept an `input` argument. Neither uses raw controls to invent actuator activity: both read simulation state. Pass elapsed seconds through the app's frame loop, copy the pose before the effects update, and call touchdown feedback once when entering a terminal result state.

Scene construction can be smoke-tested in Node because the procedural assets and data texture do not need a DOM or WebGL context. Pixel-level appearance, shader compilation and audible output still require a browser check.
