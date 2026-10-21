# Controls and input behavior

The same car has two control modes. While its wheels are attached to the course,
the player drives using the pedal and brake. Once the trailing axle clears the
inverted lip, suction ends and the interface switches to flight controls. There
is no separate release action.

The starting screen has an **EVENT** camera overview. Select **START FROM GROUND**
or press **Enter** to begin. The car starts stationary and the camera switches to
**TRACKING**. Hold the pedal to drive along the road, up the curved wall, and
along the underside of the top lip. Brake to control the departure speed. After
leaving the edge, release any driving key before pressing a flight control.

## Driving controls

These controls are available during the `drive`, `climb`, and `inverted` stages.
They are disabled while the game is ready, paused, showing help, or finished.

| Action     | Keyboard                        | Touch or mouse | Input field    |
| ---------- | ------------------------------- | -------------- | -------------- |
| Accelerate | Hold **W** or **↑**             | Hold **PEDAL** | `throttle = 1` |
| Brake      | Hold **S**, **↓**, or **Space** | Hold **BRAKE** | `brake = 1`    |

Suction maintains contact; it does not propel the car. Gravity still acts along
the slope, so releasing the pedal can let the car slow down or roll backward.
The brake opposes motion and can hold a stopped car on the wall. Driving follows
the fixed course centerline; there is no steering input during contact.

## Flight controls

These controls become available in the `flight` stage. Hold a button or key to
request thrust, and release it to stop that request. Side assist automatically
checks sideways drift; roll stays manual, with the counter-thrust response
described below.

| Action          | Keyboard       | Touch or mouse | Input field   |
| --------------- | -------------- | -------------- | ------------- |
| Roll left       | **Q**          | **ROLL L**     | `roll = +1`   |
| Roll right      | **E**          | **ROLL R**     | `roll = -1`   |
| Lift            | **Space**      | **LIFT**       | `lift = 1`    |
| Forward thrust  | **W** or **↑** | **FORWARD**    | `surge = +1`  |
| Backward thrust | **S** or **↓** | **BACK**       | `surge = -1`  |
| Left thrust     | **A** or **←** | **LEFT**       | `strafe = -1` |
| Right thrust    | **D** or **→** | **RIGHT**      | `strafe = +1` |

Directions are relative to the car, not the screen or the world. The interface
calls the local forward/back and left/right controls **HORIZONTAL**. If the car
is banked, a local sideways force can also have a vertical component in the
world. Lift always pushes through the car's roof direction. While the car is
fully inverted, that direction points toward the ground; roll upright before
using lift to slow the fall.

### Automatic side assist

The computer cancels sideways drift during flight by firing the actual left/right
jets. The **SIDE ASSIST** strip identifies its correction direction, and the
corresponding **LEFT** or **RIGHT** control glows green while the computer is
firing it. With no correction needed, the strip shows **MONITORING**. This is
flight assistance, not an automatic landing: roll with Q/E, control descent with
LIFT, and brake forward/backward travel with W/S.

Hold A/D, a left/right arrow, or a side button to override the computer on that
axis. Release to return side control to the computer. Assistance uses the shared
gas reserve and cannot produce thrust when the tank is empty. It does not change
the contact driving controls.

Several controls can be held together, including with separate fingers.
Opposing requests on the same axis cancel: W with S gives zero surge, A with D
gives zero strafe, and Q with E gives a zero target roll rate. Forward/backward thrust
changes velocity; releasing W/S does not cancel that drift. Use the opposite
forward/backward control to slow down. Releasing a side override returns lateral
control to side assist.

There is no pitch control, flight wheel brake, or nozzle that pushes in local
negative Y. Each nozzle uses the shared gas reserve. Exhaust points opposite
the force applied to the car.

## Contact-to-flight handoff

The mode follows the simulation's `inContact` state. Reaching the inverted lip
still counts as driving. Flight begins only when the trailing axle clears the
edge, and the car retains its departure velocity.

The input handoff intentionally requires a fresh press:

1. Clear active keyboard actions, pointer holds, focused-button holds, and
   pressed button styling when switching from drive to flight.
2. Remember every physical key code still held at that moment in the blocked
   set. A capture-phase key listener records these codes before a focused
   button can stop event propagation.
3. Ignore further keydown events for a blocked code, including operating-system
   repeats and activation of a newly focused flight button.
4. Unblock the code on keyup. A subsequent press can activate its new action.

This prevents a held W pedal from becoming forward thrust, or a held Space
brake from becoming lift. It also covers Space or Enter used to hold a
keyboard-focused pedal: hiding and disabling that pedal can move focus, but
the physical key remains blocked until released. A touch or mouse hold is
cleared at departure too; press the desired flight button again.

## Keyboard focus, pointer capture, and interrupted input

- **Tab** and **Shift+Tab** move through the available interface controls. A
  focused hold button accepts **Space** or **Enter**, and stops on key release
  or loss of focus. Other focused buttons retain normal browser keyboard
  activation instead of triggering a global game action.
- The game uses `KeyboardEvent.code`, so letter shortcuts refer to physical key
  positions. Ctrl, Command, and Alt combinations are left to the browser.
- Hold buttons capture their pointer. Moving outside a button while holding
  continues the action; pointer release, cancellation, or lost capture ends
  it. Each pointer is tracked separately for simultaneous touch controls.
- Opening or closing help, pausing, starting an attempt, and finishing an
  attempt clear active input. The ready, result, pause, and help states cannot
  apply driving or flight commands.
- Window blur and page visibility changes clear active and blocked key
  tracking. The hidden page does not advance the game. Returning to it resets
  the frame clock so background time does not become a large simulation step.

## Retry, help, and options

| Action                 | Keyboard                      | Interface                                         | Behavior                                                                                                                    |
| ---------------------- | ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Start                  | **Enter** on the ready screen | **START FROM GROUND**                             | Start stationary on the road.                                                                                               |
| Retry                  | **R**                         | Footer **RESTART**                                | Restart on the road during ready/drive/climb; restart stopped on the inverted lip during inverted/flight or after a result. |
| Retry from top         | —                             | Secondary **Retry from the top**                  | Start stopped on the inverted lip in drive mode; pedal to the edge.                                                         |
| Replay the full course | **Enter** after a result      | Primary **START FROM GROUND** on the result panel | Restart stationary on the road.                                                                                             |
| Pause or resume        | **Escape**, with help closed  | —                                                 | Toggle the explicit pause state and clear active input.                                                                     |
| Show instructions      | **/** or **?**                | Header **?**                                      | Open the modal help dialog and suspend simulation.                                                                          |
| Close instructions     | **Escape** while help is open | **×**, **GOT IT**, or the backdrop                | Close help and clear input; an explicit pause remains paused.                                                               |
| Change camera          | **C**                         | Camera button                                     | Cycle EVENT → TRACKING → SIDE, resetting orbit and zoom.                                                                    |
| Toggle sound           | **M**                         | Sound button                                      | Enable or mute generated audio; sound starts off.                                                                           |
| Toggle slow motion     | **T**                         | **SLOW MOTION**                                   | Use 0.5× simulation time in flight only. The default is normal speed.                                                       |
| Toggle fullscreen      | **F**                         | Fullscreen button                                 | Request or exit browser fullscreen when supported.                                                                          |

A retry resets the car, gas reserve, effects, pause state, and camera orbit. It
selects TRACKING and returns keyboard focus to the scene. Sound and the optional
slow-motion setting keep the player's current choices between attempts.

### Camera gestures

Drag an uncovered part of the scene with a mouse or finger to orbit the camera.
Scroll over the scene to zoom. Camera movement never steers the car, and touches
on the hold controls do not start an orbit gesture.

- **EVENT** frames the road and C-shaped wall as a wide overview.
- **TRACKING** follows the car with separate road/climb, inverted, and flight
  framing. This is selected automatically when an attempt begins.
- **SIDE** follows from a more side-on view.

Before an attempt starts, the establishing view keeps the starting car clear
of the intro and telemetry regardless of the selected camera label. Portrait
and short landscape screens use their own framing and control spacing.

## Thruster axes and the eight nozzles

The nozzle definitions are in [`src/game/thrusters.js`](../src/game/thrusters.js).
Positions are metres relative to the car's center of mass; force directions
are unit vectors in the same local coordinates. Force values are game tuning,
not measured specifications of the demonstration vehicle.

| Local axis | Positive direction         |
| ---------- | -------------------------- |
| X          | Forward, through the nose  |
| Y          | Up, through the roof       |
| Z          | Toward the car's left side |

| Nozzle ID          | Position `(x, y, z)`     | Force direction | Maximum force | Request                   |
| ------------------ | ------------------------ | --------------- | ------------- | ------------------------- |
| `lift-front-left`  | `(1.19, -0.448, 0.64)`   | `+Y`            | 10,000 N      | Lift / roll mixer         |
| `lift-rear-left`   | `(-1.19, -0.448, 0.64)`  | `+Y`            | 10,000 N      | Lift / roll mixer         |
| `lift-front-right` | `(1.19, -0.448, -0.64)`  | `+Y`            | 10,000 N      | Lift / roll mixer         |
| `lift-rear-right`  | `(-1.19, -0.448, -0.64)` | `+Y`            | 10,000 N      | Lift / roll mixer         |
| `surge-forward`    | `(-2.24, 0, 0)`          | `+X`            | 6,500 N       | Forward / positive surge  |
| `surge-backward`   | `(2.24, 0, 0)`           | `-X`            | 6,500 N       | Backward / negative surge |
| `strafe-positive`  | `(0, 0, 0.97)`           | `-Z`            | 6,500 N       | Right / positive strafe   |
| `strafe-negative`  | `(0, 0, -0.97)`          | `+Z`            | 6,500 N       | Left / negative strafe    |

The strafe command signs are intentionally opposite the local Z sign: positive
strafe means the player's right, which is local negative Z. Keep that convention
consistent across input, physics, the car model, and exhaust effects.

### How roll responds

Roll is rotation around the car's local X axis. A positive roll request from Q
tilts the roof toward local positive Z, the car's left side. From zero roll
rate, the **right** lift pair produces that positive torque. E requests the
opposite direction and initially fires the **left** pair. Front and rear
nozzles on a side receive equal levels so their pitch torques cancel.

The mixer asks for a target roll rate, compares it with the current roll rate,
and allocates actual nozzle thrust to produce the correcting torque:

- Without lift, it fires the side pair needed to accelerate or check rotation.
- With lift held, it reduces one side relative to the other to retain roll
  authority. Once no correcting torque is needed, all four lift nozzles can
  fire equally.
- Releasing Q/E requests zero roll rate. The opposite pair fires to slow the
  existing rotation. This uses gas and adds local upward force; it does not
  snap the attitude upright or apply artificial angular damping.
- When gas is exhausted, the nozzles cannot correct the remaining rotation.

The simulation derives force and torque from the same eight nozzle levels
used by the effects: each torque is the nozzle position cross its force
(`r × F`). To change control feel, keep the signs above stable and adjust the
documented vehicle tuning rather than changing the visual exhaust direction.
