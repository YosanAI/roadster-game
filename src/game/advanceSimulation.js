/**
 * Consume elapsed wall-clock seconds in bounded calls to FlightGame.step().
 * A slow render frame must not weaken gravity. Camera/effect smoothing can use
 * its own capped delta. Hidden-tab time is discarded by the app's clock reset.
 *
 * Returns simulated seconds for visual exhaust/wheel animation.
 */
export function advanceSimulation(
  game,
  command,
  elapsedSeconds,
  { paused = false, slowMotion = false, onStep = () => {} } = {},
) {
  let remaining = paused ? 0 : Math.min(Math.max(0, elapsedSeconds), 2);
  let simulatedSeconds = 0;
  while (remaining > 1e-8) {
    const slice = Math.min(remaining, 1 / 30);
    const simulationDt = slice * (slowMotion && game.stage === 'flight' ? 0.5 : 1);
    game.step(simulationDt, command);
    // May clear the shared command as wheel contact ends within this frame.
    onStep();
    simulatedSeconds += simulationDt;
    remaining -= slice;
  }
  return simulatedSeconds;
}
