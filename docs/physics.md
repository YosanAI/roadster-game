# Physics and gameplay model

The game combines a constrained driving model on the road and suction ramp with a force-driven airborne model. The player supplies the accelerator, brake, roll, lift, and forward/backward thrust. Sideways drift is assisted automatically; manual side input overrides it. There is no timed climb, automatic leveling, or automatic landing.

The vehicle mass, motor power, suction force, nozzle forces, and damage thresholds are game tuning values. They are not measurements of Tesla's demonstration vehicle. The code is deliberately small enough to inspect and modify without a general-purpose physics engine.

## Source map

| File                                                  | Responsibility                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| [`src/game/config.js`](../src/game/config.js)         | Course dimensions, gravity, vehicle tuning, and landing limits.             |
| [`src/game/track.js`](../src/game/track.js)           | Sampled contact path, tangent, curvature, and departure point.              |
| [`src/game/thrusters.js`](../src/game/thrusters.js)   | Eight actuator groups and the force/torque sum.                             |
| [`src/game/FlightGame.js`](../src/game/FlightGame.js) | State transitions, driving, nozzle allocation, integration, and collisions. |
| [`tests/physics.test.js`](../tests/physics.test.js)   | Eighteen Node tests, including complete flights with digital controls.      |

`FlightGame.js` re-exports `COURSE`, `LIMITS`, `GRAVITY`, and `VEHICLE` for existing callers. It also exports `FlightGame` and the derived `MAX_LIFT_ACCELERATION`.

## Units and coordinates

Distances use metres, time uses seconds, mass uses kilograms, forces use newtons, and torque uses newton-metres. Angular calculations use radians. Telemetry names such as `tiltDegrees` and `speedKmH` identify their display-unit exceptions.

The car's root is its center of mass. Its local axes are:

| Local axis | Direction                            |
| ---------- | ------------------------------------ |
| +X         | Forward, through the nose.           |
| +Y         | Up, through the roof.                |
| +Z         | Left, from the driver's perspective. |

World +Y is vertical. The road approaches the ramp along world +X. After climbing the wall, the inverted car points along world −X. Flight rotation is limited to roll about the car's local X axis, so its forward heading does not change in the air.

`game.quaternion` converts car-local vectors into world-space vectors. A nozzle's exhaust plume points opposite its `forceDirection`. A fixed local-horizontal nozzle can have a world-vertical force component while the car is banked; its direction is rotated with the car, rather than kept horizontal in the world.

## Simulation API and state

```js
import { FlightGame } from './src/game/FlightGame.js';

const game = new FlightGame();
game.start(); // Enables driving; does not add speed.

game.step(elapsedSeconds, {
  throttle: 1,
  brake: 0,
  roll: 0,
  lift: 0,
  surge: 0,
  strafe: 0,
});

const telemetry = game.getTelemetry();
```

The example import is relative to the repository root. The application supplies real frame time and current input values; the simulation does not read the DOM or keyboard itself.

| Command    | Range | Meaning                                                                |
| ---------- | ----- | ---------------------------------------------------------------------- |
| `throttle` | 0…1   | Forward motor effort while attached to the course.                     |
| `brake`    | 0…1   | Wheel braking while attached. It has no airborne effect.               |
| `roll`     | −1…1  | Target roll rate. Positive rolls left; negative rolls right.           |
| `lift`     | 0…1   | Common lift request, modified when differential roll torque is needed. |
| `surge`    | −1…1  | Forward/back thrust in car coordinates.                                |
| `strafe`   | −1…1  | Right/left thrust. Positive acts toward local −Z.                      |

Missing or non-finite commands become zero, and values are clamped. There is no flight pitch command. The standard UI provides full digital presses, while the simulation API also accepts intermediate values.

| Stage      | Behavior                                                                    |
| ---------- | --------------------------------------------------------------------------- |
| `ready`    | Stopped at the road start. `start()` enables the pedals.                    |
| `drive`    | Attached to the ground section.                                             |
| `climb`    | Attached to the curved wall. Gravity can make the car roll backward.        |
| `inverted` | Attached to the upper lip. The accelerator and brake still control motion.  |
| `flight`   | Detached; the eight nozzle outputs and gravity control motion.              |
| `success`  | The touchdown passed all damage limits.                                     |
| `crashed`  | A damaging touchdown, ramp collision, or flight boundary ended the attempt. |

`reset()` restores the initial road state. `resetAtTop()` restores a stopped, attached car at the inverted retry position. It requires actual acceleration to drive off the lip. `release()` is a focused simulation/testing API that detaches from the inverted lip without an impulse; normal play leaves the edge automatically.

The renderer reads `position`, `quaternion`, `velocity`, `driveSpeed`, `inContact`, and `thrusterLevels`. It should not write simulation state during normal play. Tests deliberately set state to isolate particular impacts and nozzle configurations.

`getTelemetry().altitude` is the lowest hull clearance above the ground. `height` is the center-of-mass Y coordinate. `thrust` is the average level of the four lift nozzles, and `fuel` is a tank percentage from 0 to 100.

### Automatic side-drift assistance

`new FlightGame()` enables side assistance; pass `{ flightAssist: false }` for isolated manual-force simulations. Assistance never rolls or levels the car. It requests a world-Z damping force proportional to sideways velocity and compensates the sideways component of banked lift, then converts that request to a bounded local strafe valve level. Near a 90° bank it waits because the side nozzles have insufficient world-Z authority. Nonzero manual `strafe` input overrides the automatic request for that step.

All correction comes from `thrusterLevels` and is charged to the gas reserve. An empty tank provides no hidden force. `game.assist` and `getTelemetry().assist` expose enabled/active state and the actual signed automatic side output for the HUD; reset, contact and results clear activity. Roll, lift and fore/aft control remain manual.

## Contact path and manual driving

The ramp sheet is an elliptical half-loop parameterized by \(u\in[0,\pi]\):

\[
x_s=x_0+R_x\sin u,\qquad y_s=R_y(1-\cos u).
\]

The tangent angle is

\[
\alpha=\operatorname{atan2}(R_y\sin u,\ R_x\cos u).
\]

The center-of-mass path is offset inward from the sheet by the resting height \(h=0.72\,\mathrm m\):

\[
(x,y)=(x_s,y_s)+h(-\sin\alpha,\cos\alpha).
\]

`track.js` samples the curve with 320 intervals, accumulates distance along that offset path, and uses binary search plus interpolation to obtain a pose at a requested distance. Local curvature is the sampled tangent-angle change divided by segment length. The road and inverted lip join the curve as straight segments.

Track distance is driven by longitudinal velocity, not elapsed animation progress. At each substep, the driving model calculates the following forces. Let \(v\) be signed track speed, \(m\) mass, \(S\) suction force, \(\kappa\) curvature, and \(g=9.8\,\mathrm{m/s^2}\).

The modeled wheel normal load is

\[
N=\max\bigl(0,\ S+mg\cos\alpha+mv^2\max(\kappa,0)\bigr).
\]

Suction presses the car toward the sheet. Gravity increases the load on the ground and decreases it on the inverted lip. The curvature term accounts for the normal acceleration needed to follow the path.

Motor effort is bounded by force, traction, and power:

\[
F_m=u_t\min\left(F_{\max},\ \mu N,\ \frac{P}{\max(3,|v|)}\right).
\]

The 3 m/s denominator floor avoids a low-speed power singularity; the motor-force limit still controls launch acceleration. Aerodynamic drag is

\[
F_d=\tfrac12\rho(C_dA)v|v|.
\]

The signed driving force before wheel resistance is

\[
F_{\mathrm{drive}}=F_m-mg\sin\alpha-F_d.
\]

Rolling and braking resistance have combined magnitude

\[
F_r=c_rN+u_b\min(B_{\max},\mu N).
\]

Resistance opposes motion. Close to rest, the static branch holds the vehicle if the available brake/rolling resistance can balance the driving force. Brakes cannot reverse the car by themselves. Releasing the brake on a steep wall permits gravity-driven rollback.

Velocity is updated from net force divided by mass, then track distance uses the average of the old and new velocities. At the road's starting boundary, backward motion is stopped.

### Leaving the lip

The lip ends at world X = 3.5 m. The trailing axle clears it when the center of mass reaches approximately X = 2.05 m, using the 1.45 m half-wheelbase. The crossing fraction of the current substep is calculated, and any remaining time is advanced as flight.

Departure velocity is the current track tangent multiplied by `driveSpeed`. The upper lip is horizontal, so there is no initial downward kick. An initially stopped release follows exactly

\[
v_y=-gt,\qquad y=y_0-\tfrac12gt^2
\]

until a nozzle fires or a collision occurs.

## Eight fixed flight nozzles

`THRUSTERS` is shared by physics and the car's exhaust meshes. Its array order is also the order of `game.thrusterLevels`. The forward and backward channels each represent the balanced resultant of four rear outlets. For reverse, exhaust deflects forward/outward at the rear; this game approximation does not rely on rear suction or a front plume.

| Index | ID                 | Local position, m        | Local force direction | Maximum force |
| ----- | ------------------ | ------------------------ | --------------------- | ------------- |
| 0     | `lift-front-left`  | `(1.19, −0.448, 0.64)`   | +Y                    | 10,000 N      |
| 1     | `lift-rear-left`   | `(−1.19, −0.448, 0.64)`  | +Y                    | 10,000 N      |
| 2     | `lift-front-right` | `(1.19, −0.448, −0.64)`  | +Y                    | 10,000 N      |
| 3     | `lift-rear-right`  | `(−1.19, −0.448, −0.64)` | +Y                    | 10,000 N      |
| 4     | `surge-forward`    | `(−2.24, 0, 0)`          | +X                    | 6,500 N       |
| 5     | `surge-backward`   | `(2.24, 0, 0)`           | −X                    | 6,500 N       |
| 6     | `strafe-positive`  | `(0, 0, 0.97)`           | −Z, right             | 6,500 N       |
| 7     | `strafe-negative`  | `(0, 0, −0.97)`          | +Z, left              | 6,500 N       |

Every valve level \(\lambda_i\) is nonnegative. There is no local −Y lift nozzle. All four lift nozzles together produce 40,000 N, equivalent to approximately 25.806 m/s² before gravity for the 1,550 kg car.

For each nozzle, `getThrusterWrench()` computes

\[
\mathbf F_i=\lambda_i F_{i,\max}\mathbf d_i,\qquad
\boldsymbol\tau_i=\mathbf r_i\times\mathbf F_i.
\]

The returned local force and torque are sums over all eight nozzles. Horizontal nozzles sit at center-of-mass height with force lines through the center, so they contribute no rotation. Fore/aft lift nozzles on the same side always receive equal levels, canceling pitch torque.

## Roll allocation and counter-roll force

Roll uses the actual torque of the lift nozzles. For a local upward force at lateral offset \(z\), its roll torque is \(\tau_x=-zF_y\). The pair on local −Z therefore generates positive roll torque, lowering the left side of the car.

The rate controller requests

\[
\tau_{\mathrm{request}}=I_{xx}k\left(u_{\mathrm{roll}}\omega_{\max}-\omega_x\right).
\]

The request is divided by the available pair torque and clamped to \([-1,1]\). With 0.64 m lever arms, the pair torque limit is 12,800 N·m. The current roll inertia is 700 kg·m², and the target rate is 3.4 rad/s.

If the normalized torque request is \(d\), the allocator uses

\[
\lambda_{\mathrm{strong}}=\max(u_{\mathrm{lift}},|d|),\qquad
\lambda_{\mathrm{weak}}=\lambda_{\mathrm{strong}}-|d|.
\]

The sign of \(d\) chooses the stronger side.

- With full lift and no roll torque needed, all four nozzles fire equally.
- With roll alone, one lift pair fires and provides both roll torque and positive local-Y force.
- With full lift and roll together, one pair is reduced to create differential torque.
- Releasing the roll button sets the target rate to zero. The opposite pair fires to slow rotation, consuming gas and adding its own positive local-Y force.

The controller stops roll rate; it does not choose an upright orientation. With no gas remaining, there is no rate-braking torque. Existing roll motion continues. Firing a lift pair while inverted adds downward world acceleration, so a roll burn must not be mistaken for gravity-only free fall.

The integrator uses only roll torque during flight. The current symmetric nozzle layout produces no pitch or yaw torque. Adding asymmetric nozzle locations or unequal fore/aft levels would require extending the rotational model, not merely adding an entry to the nozzle list.

## Airborne integration and gas

Each simulation substep is at most 1/120 second. `step()` processes at most 0.25 second per call so a suspended tab does not cause a large catch-up jump. The application normally passes much smaller real-time slices.

Roll acceleration is \(\alpha_x=\tau_x/I_{xx}\). The model advances roll angle and velocity using that acceleration, rotates the local force using the midpoint orientation, and computes

\[
\mathbf a=\frac{R(q_{\mathrm{mid}})\mathbf F}{m}+(0,-g,0).
\]

Position and velocity then use

\[
\mathbf p_{n+1}=\mathbf p_n+\mathbf v_n\Delta t+\tfrac12\mathbf a\Delta t^2,
\qquad
\mathbf v_{n+1}=\mathbf v_n+\mathbf a\Delta t.
\]

This is exact for constant gravity alone. No world-space flight drag, automatic horizontal brake, artificial downward force, or default slow motion is added.

Gas use follows the sum of actual individual nozzle-force magnitudes:

\[
\Delta\text{fuel}=k_f\Delta t\sum_i\lambda_iF_{i,\max}.
\]

It is not based on resultant force: two opposing nozzles still both consume gas. If a substep needs more gas than remains, all active valve levels are scaled by the available fraction and the force/torque sum is recomputed. The tank is an abstract percentage; pressure decay, changing vehicle mass, fan power consumption, and battery energy are not modeled.

## Contact, damage, and game over

Ground contact uses eight rotated body corners plus four tyre contact points. This identifies roof, side, nose, and tyre impacts at different heights. The collision support points are intentionally separate from the visible car mesh.

For the lowest rotated contact offset \(\mathbf r\), contact-point velocity is

\[
\mathbf v_c=\mathbf v+\boldsymbol\omega_{\mathrm{world}}\times\mathbf r.
\]

Impact speed is the maximum of zero, downward center-of-mass speed, and downward contact-point speed. Tilt is the angle between the car's up vector and world up. A touchdown succeeds only when all of these limits pass:

| Quantity               | Inclusive safe limit |
| ---------------------- | -------------------- |
| Tilt                   | 15°                  |
| Downward impact speed  | 5 m/s                |
| Total horizontal speed | 9 m/s                |
| Angular speed          | 1.2 rad/s            |

The painted target does not decide success. `result.onRoad` records whether the full footprint lies inside it, but a sound touchdown elsewhere on the apron also succeeds.

Failure reasons are selected in the order orientation, impact, horizontal speed, then spin. All measured values remain in `result`. A safe touchdown settles the tolerated tilt, preserves heading, and stops the car. A crash also ends motion; post-impact tumbling and structural deformation are not simulated.

Airborne ramp collision checks use the support points against the elliptical sheet and inverted lip. Initial tyre contact with the lip is ignored until the full car has peeled away, preventing the existing release contact from being classified as a new collision. The curved wall stays active throughout departure.

Flight also ends outside the configured coarse world limits—X below −110 m or above 75 m, absolute Z above 65 m, or Y above 75 m—or after 45 seconds airborne. These are game boundaries, not vehicle damage calculations.

## Model limits and tuning

Road driving is constrained to a known longitudinal path. Suction is treated as an ideal attachment constraint; there is no free tyre steering, lateral slip solver, suspension articulation, or loss-of-adhesion simulation. The finite normal-load calculation determines available traction, but the car stays attached until the lip departure condition. The ramp and body use compact analytical/sample-based collision tests rather than general mesh collision.

To change behavior, start in the following places:

| Change                                                        | Location                          |
| ------------------------------------------------------------- | --------------------------------- |
| Gravity, mass, inertia, motor, suction, braking, and gas use  | `config.js`: `GRAVITY`, `VEHICLE` |
| Ground/ellipse/lip dimensions and retry position              | `config.js`: `COURSE`             |
| Damage tolerances                                             | `config.js`: `LIMITS`             |
| Nozzle positions, directions, and force capacities            | `thrusters.js`: `THRUSTERS`       |
| Contact sampling and half-wheelbase                           | `track.js`                        |
| Body support points, collision margins, and flight boundaries | `FlightGame.js`                   |
| Controller allocation and substep size                        | `FlightGame.js`                   |

Keep the left/right and fore/aft lift layout symmetric unless you also extend the rotational dynamics. The renderer reads the same nozzle registry, so nozzle placement and force-direction changes remain visible.

Run `npm test`, or `node --test tests/physics.test.js tests/assist.test.js`, after a physics change. The manual-force tests explicitly disable assistance and cover exact gravity, manual driving and stopping, rollback and static holding, natural departure, the eight-nozzle force model, counter-roll gas/force, removed pitch and airborne wheel braking, damage, and successful digital-input flights at several frame rates. The automated pilots exist only in the tests; no equivalent auto-landing function is exported to the game.
