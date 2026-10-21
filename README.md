# Roadster / Controlled Fall

A complete **Three.js + vanilla JavaScript** game. Drive up a suction-assisted reverse-C ramp, leave the inverted lip, roll upright using lift pairs, and control the fall with lift jets, four rear propulsion outlets and automatic side-drift assistance. Roll and lift remain manual.

This is the editable source repository for the current game, organized for continued development. The car, ramp, lighting, vapor and audio are procedural; no model downloads, API keys or backend are required.

## Quick start

Use **Node.js 24** (the version in `.nvmrc`), or a compatible version satisfying `package.json`: Node 20.19+ or 22.12+. The build tool's requirements are documented in the [Vite guide](https://vite.dev/guide/).

From the extracted repository folder:

```sh
npm ci
npm run dev
```

Open the address printed by Vite, normally `http://localhost:5173`.

For your phone on the same Wi-Fi network:

```sh
npm run dev:network
```

Open the printed **Network** address on your phone. The page uses WebGL 2. Load it through the development server; opening `index.html` directly from the file manager will not resolve JavaScript modules.

## Production build

```sh
npm run build
npm run preview
```

Vite creates the deployable website in `dist/`. The download includes a verified production build for convenience; running the command regenerates it from `src/`.

The included `netlify.toml` declares `npm run build`, the `dist` publish directory, and Node 24. You can connect your own repository to Netlify, or deploy the generated `dist/` folder to another static host. The build uses relative asset URLs and includes source maps for debugging.

## Commands

| Command               | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `npm ci`              | Install the exact dependency tree from `package-lock.json` |
| `npm run dev`         | Start the local development server                         |
| `npm run dev:network` | Expose that server to devices on your local network        |
| `npm run build`       | Generate the production website                            |
| `npm run preview`     | Serve the production build locally                         |
| `npm test`            | Run physics, clock and input tests                         |
| `npm run check`       | Check JavaScript syntax and source formatting              |
| `npm run format`      | Apply the repository's formatting rules                    |

## Dependencies

| Dependency                  | Role                                                      |
| --------------------------- | --------------------------------------------------------- |
| Three.js `0.180.0`          | Rendering, geometry, materials, vectors and quaternions   |
| Vite `8.3.4`                | Development server and production bundling                |
| Prettier `3.9.10`           | Consistent formatting for editable source                 |
| Node's built-in test runner | Automated verification, with no test framework dependency |

Three.js is the only runtime package. The physics is a small, explicit JavaScript simulation isolated from rendering and the DOM. All dependency versions and the lockfile are included. Dependencies install into `node_modules/`; that generated directory is omitted from the download.

## Source map

| File or directory                  | Responsibility                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| `index.html`                       | Semantic HTML, menus, telemetry and touch controls                 |
| `src/main.js`                      | Entry point and stylesheet import                                  |
| `src/app.js`                       | Game lifecycle, frame loop and module wiring                       |
| `src/game/config.js`               | Gravity, vehicle parameters, course dimensions and damage limits   |
| `src/game/FlightGame.js`           | Driving, flight, fuel, collisions, landing decisions and telemetry |
| `src/game/track.js`                | Contact path, tangent, curvature and departure edge                |
| `src/game/thrusters.js`            | Eight actuator groups and force/torque summation                   |
| `src/game/advanceSimulation.js`    | Real-time frame advancement, pause and optional slow motion        |
| `src/input/InputController.js`     | Keyboard, simultaneous touch buttons and mode transitions          |
| `src/camera/CameraRig.js`          | Event/tracking/side cameras, orbiting, zoom and framing            |
| `src/scene/createRoadster.js`      | Procedural car geometry and nozzle meshes                          |
| `src/scene/createEnvironment.js`   | Road, C-shaped wall, trusses, lights and markings                  |
| `src/scene/createEffects.js`       | Exhaust, ground vapor, wheel animation and touchdown effects       |
| `src/scene/createContactShadow.js` | Small procedural road-shadow cue                                   |
| `src/audio/GameAudio.js`           | Optional synthesized engine, suction, jets and impact audio        |
| `src/ui/createHud.js`              | Telemetry display, stage indicators, coach and result text         |
| `src/ui/elements.js`               | Validated bindings between HTML IDs and JavaScript                 |
| `src/styles.css`                   | Formatted component styles and responsive breakpoints              |
| `tests/`                           | Behavior checks independent of browser rendering                   |
| `docs/`                            | Architecture, physics, controls, rendering and third-party notes   |

## Where to change things

Start with **`src/game/config.js`** for gravity, mass, motor power, suction, braking, damage tolerance and course dimensions. SI units are documented beside the values.

Edit **`src/game/thrusters.js`** for nozzle positions, directions and maximum force. The solver uses four local +Y lift groups and four local X/Z horizontal control groups. Each forward/reverse surge group drives the four rear outlets, with reverse represented by outward/forward exhaust deflection. See the rendering documentation for outlet positions.

Edit **`src/input/InputController.js`** to change keyboard mappings or add an input source. `FlightGame` accepts numeric commands and does not know whether they came from a keyboard, a touch screen or a test pilot.

Edit **`src/camera/CameraRig.js`** for framing and camera movement, and **`src/styles.css`** for UI appearance. Both keep camera gestures independent of car rotation.

The scene modules use named helpers and sections for materials, body panels, wheels, trusses, nozzles and effects. Rendering budgets and performance knobs are described in [Rendering](docs/rendering.md).

## Play

Choose **Start driving**, then press the pedal. Suction holds the tyres to the road, wall and inverted lip. Use the brake to manage departure speed. Controls automatically change when the trailing wheels leave the edge.

| Mode    | Action                         | Keyboard                     |
| ------- | ------------------------------ | ---------------------------- |
| Driving | Pedal                          | W / up arrow                 |
| Driving | Wheel brake                    | S / down arrow / Space       |
| Flight  | Roll left / right              | Q / E                        |
| Flight  | Lift                           | Space                        |
| Flight  | Forward / backward thrust      | W / S or up / down arrows    |
| Flight  | Override automatic side thrust | A / D or left / right arrows |

The on-screen buttons support simultaneous holds. A held driving key must be released before it can activate a flight jet. Other shortcuts and the exact input behavior are in [Controls](docs/controls.md).

For a first attempt, approach the edge around 30 km/h, roll upright after departure, then pulse lift and brake forward/backward drift. The computer cancels sideways drift; the SIDE ASSIST indicator and green side controls show when it fires. Manual A/D input overrides that assistance. Releasing a roll button commands a real counter-roll burn from the opposite lift pair; it does not automatically level the car.

A safe landing displays **Landed safe. More levels coming soon.** A damaging landing displays **Game over.**, its cause, impact speed and tilt. Retry from the top starts stopped on the inverted lip; replay starts from the road.

## Physics model

Gravity is exactly **9.8 m/s²**, with real time enabled by default on all devices. Contact driving integrates motor force over mass with traction/power limits, drag, rolling resistance, brakes and tangential gravity. Departure preserves actual tangent velocity.

The four lift nozzles can only push along the car's local +Y direction. LIFT engages them together; roll creates a left/right difference, and the opposite pair stops the spin. Four horizontal control groups supply forward, backward, left and right forces along local X/Z. Forward thrust uses four rear outlets; reverse redirects their gas forward/outward. Side assistance commands the real side valves and consumes gas. A banked sideways nozzle follows the banked car. Pitch and yaw rotation are constrained during flight.

This is a focused stunt-game model: driving follows a sampled ramp path, airborne attitude is roll-only, and vehicle force parameters are gameplay values. Course geometry and the procedural car approximate the event reference. Detailed formulas, state/API contracts, numerical integration, constraints and damage rules are in [Physics](docs/physics.md).

## Verification

```sh
npm test
npm run check
npm run build
```

The physics suite covers the eight nozzle directions, exact gravity, gradual driving acceleration, braking/holding, wall rollback, contact loss, force and torque from roll, counter-roll fuel use, disabled pitch, collisions, damage thresholds and complete successful digital-control flights at several update rates. Clock tests cover uneven render timing, pause/slow behavior and input clearing within a frame. Input tests cover key mappings and the held-pedal handoff. Additional suites cover side assistance, its HUD indicators, moving-nozzle jet continuity, rear outlet groups and vapor persistence.

For the repository refactor, numerical state was compared with the published game across **1,901 snapshots**, including full safe flights and a crash/reset sequence, with exact matches. Car and environment geometry/material/instance data and deterministic particle states also matched. Recent effects and control changes were also checked with headless Chromium, including mobile viewport emulation. Physical-device playtesting remains separate from those browser checks.

## Further documentation

- [Architecture and extension points](docs/architecture.md)
- [Physics, units and tuning](docs/physics.md)
- [Controls and game flow](docs/controls.md)
- [Procedural rendering and performance](docs/rendering.md)
- [Third-party notices](docs/third-party.md)

## Visual references

- [Official Roadster event video](https://www.youtube.com/watch?v=qt5p-_tE8d0)
- [Event photo gallery](https://www.exoticcartrends.com/news/tesla-roadster-reveal-2026/)

Reference photographs are not bundled. The game is an unofficial fan recreation with procedural assets.
