# Architecture

The repository uses native JavaScript modules. Vite handles the development server and production packaging. Application code is plain JavaScript, HTML and CSS.

## Ownership of state

`FlightGame` is the authoritative game state. It owns pose, linear and angular velocity, contact, stage, driving speed, fuel, eight actuator levels, side-assist state and the landing result. It imports Three.js math primitives but never accesses the DOM, a renderer, an audio context or browser timing.

`app.js` assembles the components and owns presentation lifecycle: attempts, the result delay, pause, optional slow motion and the frame clock. It copies the physics pose to the rendered car. Safe touchdown restores ground controls immediately; `PRESENTATION.successMenuDelaySeconds` sets the unpaused drive-away interval before the result menu freezes vehicle motion/input. Existing particles keep fading behind that menu. Scene modules never integrate vehicle motion themselves.

`InputController` owns held keyboard codes, pointer holds and focused-button holds. It returns one stable command object. Stability matters at departure: `onStageChange()` clears that same object between simulation slices, so a still-held pedal cannot become a jet later in the current frame.

`CameraRig` owns only the viewing camera. Orbiting, zooming, responsive framing and impact shake cannot mutate the vehicle quaternion.

`createHud()` reads telemetry and results. `createEffects()` reads the car pose and actual nozzle output. The audio controller reads movement and nozzle output. Those components do not supply hidden forces or make landing decisions.

## Frame flow

1. `InputController.sample()` combines the current keyboard and touch holds into physics commands.
2. `advanceSimulation()` divides real elapsed time into calls no longer than 1/30 second. `FlightGame.step()` further subdivides them to at most 1/120 second.
3. After each outer slice, the app observes stage/contact changes. It updates control availability and clears held driving input on departure.
4. The app copies the final position and quaternion to the car mesh. Effects use `thrusterLevels`; sound and telemetry read the same state.
5. The camera interpolates using rendering time, the HUD refreshes at up to 20 Hz, and Three.js renders the scene.

Physics consumes real elapsed time at low frame rates. Optional slow motion scales the flight-stage time explicitly. Pause supplies zero simulation time; returning from a hidden tab resets the clock rather than fast-forwarding the inactive interval. A single visible stall is bounded to two seconds.

## Shared configuration

`config.js` contains SI-unit parameters and game limits. `track.js` builds the contact path from the course dimensions. The rendered ramp also uses the shared course values, while its trusses, platform details and markings remain procedural art geometry.

`thrusters.js` is the shared nozzle registry. Each entry contains a local position, local force direction, nozzle kind and maximum force. Physics sums the resulting force and `position × force` torque. The car builder keeps the actuator descriptors in the same order. Lift/side entries have one emitter each; each surge entry has four rear outlets for the aggregate force, with reverse using balanced exhaust deflection. Effects change intensity according to actual output; they do not invent extra roll or brake jets.

## Extending the game

### Add another controller

Supply the same command fields: `throttle`, `brake`, `roll`, `lift`, `surge`, `strafe`. A gamepad adapter can produce analog values without changing the physics class. Maintain the contact-mode handoff and stable command identity when integrating it into `app.js`.

### Tune driving or landing

Change the named values in `config.js`. Run the physics tests after changing motor, mass, brake, suction, lift or damage values. Successful-flight tests verify that the selected values still permit a complete attempt.

### Change the car or nozzle layout

Modify `createRoadster.js` for visual bodywork. Move flight nozzles through the registry so simulation and effects remain aligned. The collision hull in `FlightGame.js` is a separate conservative shape; update it if vehicle dimensions change materially.

### Add pitch or unrestricted flight

The current flight integrator deliberately updates roll around the car's local X axis. Additional attitude axes require physical actuator allocation, inertia and integration changes as well as UI controls and collision tests. Adding a button alone is insufficient.

### Add levels

The current course is one exported configuration used at module initialization. To support different courses in one running app, first pass a course configuration into the simulation, track builder and environment builder together. Keep artwork dimensions and contact/collision geometry consistent. Then add level selection and progression around the existing result lifecycle.

### Replace the custom physics

Rendering and controls are already separated from the simulation. An engine adapter can preserve the `FlightGame` state/telemetry surface and accept the same command object. Ground adhesion and the one-way nozzle layout would still need explicit modeling. The existing behavior tests provide useful reference outcomes during a replacement.

## Development conventions

- Use metres, seconds, kilograms, newtons and radians inside simulation code; convert only for display.
- Keep browser APIs out of the game simulation and its configuration modules.
- Read `thrusterLevels` for audiovisual effects, not requested button states.
- Put design constants beside their units and purpose; avoid unexplained per-frame forces.
- Use `npm run format` for consistent source layout and `npm run check` before packaging.
- Keep generated output in `dist/` and dependencies in `node_modules/`; edit the source under `src/`.

The page initializes one app instance. Input and camera controllers expose `dispose()` for listener cleanup if you embed them in a larger host. Scene objects and audio lifetime are documented in [Rendering](rendering.md).
