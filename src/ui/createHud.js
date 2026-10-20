import { GRAVITY, LIMITS } from '../game/config.js';

/** Presentation only: reads game telemetry and results without changing physics. */
export function createHud(ui, { coarsePointer = false } = {}) {
  function setStage(game, controlMode) {
    const s = game.stage;
    const inverted = s === 'inverted';
    const flight = s === 'flight';
    const finished = s === 'success' || s === 'crashed';
    document.body.dataset.controlMode = controlMode;
    ui['control-mode-label'].textContent = controlMode === 'flight' ? 'THRUST MODE' : 'DRIVE MODE';
    ui['drive-controls'].hidden = controlMode !== 'drive';
    ui['flight-controls'].hidden = controlMode !== 'flight';
    ui.coach.hidden = s === 'ready' || finished;
    ui['stage-climb'].className =
      s === 'drive' || s === 'climb' ? 'active' : s !== 'ready' ? 'done' : '';
    ui['stage-release'].className = inverted ? 'active' : flight || finished ? 'done' : '';
    ui['stage-land'].className = flight ? 'active' : s === 'success' ? 'done' : '';
    const status = {
      ready: 'READY ON THE ROAD',
      drive: 'DRIVE MODE / SUCTION ACTIVE',
      climb: 'DRIVE MODE / CLIMBING',
      inverted: 'DRIVE MODE / INVERTED',
      flight: 'SUCTION OFF / MANUAL FLIGHT',
      success: 'TOUCHDOWN CONFIRMED',
      crashed: 'VEHICLE DAMAGED',
    };
    ui.status.textContent = status[s];
    ui['status-dot'].className =
      `status-dot ${s === 'crashed' ? 'red' : s === 'flight' ? '' : 'green'}`;
  }

  function showResult(result) {
    const safe = result.safe;
    ui.result.hidden = false;
    ui.result.classList.toggle('crash', !safe);
    document.body.classList.add('result-open');
    ui['result-eyebrow'].textContent = safe
      ? 'TOUCHDOWN CONFIRMED / VEHICLE INTACT'
      : 'VEHICLE DAMAGED / ATTEMPT FAILED';
    ui['result-icon'].textContent = safe ? '✓' : '×';
    ui['result-title'].textContent = safe ? 'Landed safe.' : 'Game over.';
    const reasons = {
      orientation:
        'The car hit at the wrong angle. Get the wheels underneath you before touchdown.',
      impact: 'The impact was too hard. Start your lift burn earlier to slow the descent.',
      lateral: 'Too much horizontal speed. Use an opposing horizontal jet before touchdown.',
      spin: 'You were still rotating at contact. Release the rotation controls earlier.',
      ramp: 'The car struck the ramp. Clear the wall before firing lift.',
      bounds: 'The car left the test course. Use horizontal thrust to stay over the asphalt.',
      timeout: 'The flight lasted too long. Use short lift pulses and settle onto the road.',
    };
    ui['result-description'].textContent = safe
      ? 'More levels coming soon.'
      : reasons[result.reasonCode] || result.reason;
    ui['result-impact'].innerHTML = `${result.impact.toFixed(1)} <small>m/s</small>`;
    ui['result-tilt'].innerHTML = `${result.tiltDegrees.toFixed(1)} <small>°</small>`;
    ui['result-impact'].className = result.impact <= LIMITS.impact ? 'good' : 'warning';
    ui['result-tilt'].className = result.tiltDegrees <= LIMITS.tiltDegrees ? 'good' : 'warning';
    ui.retry.textContent = safe ? 'FLY AGAIN ↗' : 'RETRY FROM THE TOP ↗';
    if (safe) {
      try {
        const previous = Number(localStorage.getItem('roadster-best-impact') || 99);
        if (result.impact < previous)
          localStorage.setItem('roadster-best-impact', String(result.impact));
      } catch {
        /* The game remains playable when local storage is disabled. */
      }
    }
  }

  function update(game) {
    const t = game.getTelemetry();
    const finalMetrics = game.result;
    const driving = game.inContact && !finalMetrics;
    ui['telemetry-title'].textContent = driving ? 'DRIVE TELEMETRY' : 'FLIGHT TELEMETRY';
    ui['motion-label'].textContent = finalMetrics ? 'IMPACT' : driving ? 'SPEED' : 'DESCENT';
    ui['motion-unit'].textContent = driving ? 'km/h' : 'm/s';
    ui.altitude.textContent = t.altitude.toFixed(1);
    ui.descent.textContent = (
      finalMetrics ? finalMetrics.impact : driving ? game.driveSpeed * 3.6 : t.descentSpeed
    ).toFixed(1);
    const tilt = finalMetrics ? finalMetrics.tiltDegrees : t.tiltDegrees;
    ui.tilt.textContent = Math.round(tilt);
    ui.descent.className = driving
      ? game.driveSpeed < -0.2
        ? 'warning'
        : ''
      : (finalMetrics ? finalMetrics.impact : t.descentSpeed) > LIMITS.impact
        ? 'warning'
        : '';
    ui.tilt.className =
      !driving && tilt > LIMITS.tiltDegrees ? 'warning' : game.stage === 'flight' ? 'good' : '';
    ui['attitude-tag'].textContent = tilt <= 15 ? 'LEVEL' : tilt > 145 ? 'INVERTED' : 'ROTATING';
    ui['attitude-tag'].className = `attitude-tag ${driving || tilt <= 15 ? 'good' : 'warning'}`;
    ui['fuel-value'].textContent = `${Math.ceil(t.fuel)}%`;
    ui['fuel-progress'].style.width = `${t.fuel}%`;
    ui['fuel-progress'].style.background = t.fuel < 20 ? '#ef7765' : '#bfdce5';
    ui['climb-progress'].style.width = `${game.climbProgress * 100}%`;
    if (game.stage === 'drive') {
      ui.coach.className = 'coach';
      ui['coach-title'].textContent =
        Math.abs(game.driveSpeed) < 0.2 ? 'PRESS THE PEDAL' : 'YOU ARE DRIVING';
      ui['coach-detail'].textContent = coarsePointer
        ? 'Hold PEDAL to accelerate. Use BRAKE to slow or stop.'
        : 'W / ↑ accelerates. S / ↓ brakes. Release the pedal to coast.';
    } else if (game.stage === 'climb') {
      ui.coach.className = 'coach';
      ui['coach-title'].textContent = 'DRIVE UP THE WALL';
      ui['coach-detail'].textContent =
        'Suction holds the tires to the ramp. Keep using the pedal and brake.';
    } else if (game.stage === 'inverted') {
      ui.coach.className = 'coach';
      ui['coach-title'].textContent = 'INVERTED / STILL IN DRIVE MODE';
      ui['coach-detail'].textContent =
        'Ease forward off the edge. Thrust controls appear when the tires clear.';
    } else if (game.stage === 'flight') {
      const tooTilted = t.tiltDegrees > 20;
      const stoppingDistance =
        t.descentSpeed ** 2 /
        (2 *
          Math.max(1, t.maxLiftAcceleration * Math.cos((t.tiltDegrees * Math.PI) / 180) - GRAVITY));
      ui.coach.className = `coach ${tooTilted || stoppingDistance > t.altitude * 0.55 ? 'danger' : 'success'}`;
      if (t.fuel < 0.1) {
        ui['coach-title'].textContent = 'GAS DEPLETED';
        ui['coach-detail'].textContent = 'No thrust available. Hold for touchdown.';
      } else if (tooTilted) {
        ui['coach-title'].textContent = 'ROLL UPRIGHT';
        ui['coach-detail'].textContent = coarsePointer
          ? 'Hold a ROLL button. Release when the tilt approaches 0°.'
          : 'Hold Q or E. Release when the tilt approaches 0°.';
      } else if (t.verticalSpeed > 0.7) {
        ui['coach-title'].textContent = 'EASE OFF THE LIFT';
        ui['coach-detail'].textContent =
          'You are climbing. Let gravity bring you down, then pulse to brake.';
      } else if (stoppingDistance > t.altitude * 0.5 || t.descentSpeed > 7) {
        ui['coach-title'].textContent = 'BURN TO BRAKE';
        ui['coach-detail'].textContent = coarsePointer
          ? 'Hold LIFT to slow the descent. Keep the tilt below 15°.'
          : 'Hold SPACE to slow the descent. Keep the tilt below 15°.';
      } else if (t.horizontalSpeed > LIMITS.lateralSpeed) {
        ui['coach-title'].textContent = 'COUNTER THE HORIZONTAL DRIFT';
        ui['coach-detail'].textContent =
          'Use the opposite horizontal jet to slow your travel before contact.';
      } else if (t.altitude < 4 && t.descentSpeed < 4.5) {
        ui['coach-title'].textContent = 'KEEP IT LEVEL';
        ui['coach-detail'].textContent = 'Small lift pulses. Settle onto all four wheels.';
      } else {
        ui['coach-title'].textContent = 'WHEELS DOWN';
        ui['coach-detail'].textContent =
          'Pulse lift to control your descent. Touch down under 5 m/s.';
      }
    }
  }

  return { setStage, showResult, update };
}
