import * as THREE from 'three';
import { loadRoadster } from './scene/createRoadster.js';
import { createEnvironment } from './scene/createEnvironment.js';
import { FlightGame, COURSE } from './game/FlightGame.js';
import { createEffects } from './scene/createEffects.js';
import { GameAudio } from './audio/GameAudio.js';

import { InputController } from './input/InputController.js';
import { CameraRig } from './camera/CameraRig.js';
import { createContactShadow } from './scene/createContactShadow.js';
import { advanceSimulation } from './game/advanceSimulation.js';
import { getUiElements } from './ui/elements.js';
import { createHud } from './ui/createHud.js';
import { PRESENTATION } from './game/config.js';

/** Assemble one game page: physics, renderers, input and presentation stay separate. */
export function startGameApp() {
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const ui = getUiElements();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: ui.scene,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarsePointer ? 1.4 : 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    boot().catch(showFatal);
  } catch (error) {
    showFatal(error);
  }

  function showFatal(error) {
    console.error('Roadster game could not start:', error);
    ui.loading.hidden = true;
    ui.fatal.hidden = false;
    ui['fatal-message'].textContent =
      error?.name === 'VehicleModelError'
        ? error.message
        : 'The 3D scene could not start. Please use a browser with WebGL 2 and hardware acceleration enabled, then reload.';
  }

  async function boot() {
    const scene = new THREE.Scene();
    const environment = createEnvironment(scene);
    const car = await loadRoadster();
    const game = new FlightGame();
    const audio = new GameAudio();
    const effects = createEffects(scene);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.08, 330);
    scene.add(car);

    const contactShadow = createContactShadow();
    const cameraRig = new CameraRig(camera, ui.scene);
    const hud = createHud(ui, { coarsePointer });
    scene.add(contactShadow);

    let attempt = 1;
    // Real time on every device. Slow motion is always an explicit opt-in.
    let slow = false;
    let paused = false;
    let priorStage = '';
    let priorControlMode = 'idle';
    let elapsed = 0;
    let lastTime = performance.now();
    let hudElapsed = 0;
    let resultDelay = 0;
    let resultShown = false;
    let toastTimer;
    const inputs = new InputController({
      buttons: document.querySelectorAll('[data-action]'),
      getContext: () => ({
        game,
        paused,
        helpOpen: ui['help-dialog'].open,
        resultOpen: resultShown,
      }),
      onShortcut,
      onVisibilityChange: () => {
        lastTime = performance.now();
      },
    });
    const input = inputs.command;

    function toast(message) {
      clearTimeout(toastTimer);
      ui.toast.textContent = message;
      ui.toast.hidden = false;
      toastTimer = setTimeout(() => {
        ui.toast.hidden = true;
      }, 2600);
    }

    function setSlow(value) {
      slow = value;
      ui.slow.setAttribute('aria-pressed', String(slow));
    }

    function resetPresentation() {
      inputs.clear();
      effects.reset();
      car.userData.markDamaged?.(false);
      ui.result.hidden = true;
      ui['drive-controls'].hidden = true;
      ui['flight-controls'].hidden = true;
      ui.coach.hidden = true;
      document.body.classList.remove('result-open');
      resultShown = false;
      resultDelay = 0;
      cameraRig.reset();
      paused = false;
      document.body.classList.remove('paused');
      ui['attempt-count'].textContent = `ATTEMPT ${String(attempt).padStart(2, '0')}`;
    }

    function begin({ fromTop = false, increment = false } = {}) {
      if (increment) attempt++;
      game.reset();
      resetPresentation();
      ui.intro.hidden = true;
      document.body.classList.add('playing');
      if (fromTop) game.resetAtTop();
      else game.start();
      cameraRig.reset('tracking');
      ui['camera-label'].textContent = 'TRACKING';
      priorStage = '';
      onStageChange();
      audio.tone(250, 0.15, 0.13);
      ui.scene.focus({ preventScroll: true });
    }

    function onStageChange() {
      if (priorStage === game.stage) return;
      priorStage = game.stage;
      const s = game.stage;
      const inverted = s === 'inverted';
      const flight = s === 'flight';
      const finished = s === 'success' || s === 'crashed';
      const controlMode =
        s === 'ready' || s === 'crashed' ? 'idle' : game.inContact ? 'drive' : 'flight';
      if (controlMode !== priorControlMode) {
        // Neither road pedals nor held flight jets may carry into the other
        // control mode. A fresh press is required after either contact change.
        inputs.clear({ suppressHeld: priorControlMode !== 'idle' && controlMode !== 'idle' });
        priorControlMode = controlMode;
      }
      hud.setStage(game, controlMode);
      inputs.syncAvailability();
      if (inverted) audio.tone(660, 0.15, 0.13);
      if (flight) {
        audio.tone(480, 0.07, 0.12);
        audio.tone(240, 0.12, 0.09, 0.06);
      }
      if (finished) {
        resultDelay = Math.max(
          0,
          s === 'success'
            ? PRESENTATION.successMenuDelaySeconds
            : PRESENTATION.crashMenuDelaySeconds,
        );
        audio.touchdown(s === 'success');
        effects.touchdown(s === 'success', game.result.impact, game.position);
        car.userData.markDamaged?.(s === 'crashed');
        cameraRig.shake = s === 'crashed' ? Math.min(0.35, game.result.impact * 0.012) : 0.045;
      }
    }

    function showResult() {
      if (resultShown) return;
      resultShown = true;
      inputs.clear();
      inputs.syncAvailability();
      hud.showResult(game.result);
    }

    function updateCamera(dt, snap = false) {
      cameraRig.update(dt, game, {
        width: ui.game.clientWidth,
        height: ui.game.clientHeight,
        snap,
      });
    }

    function resize() {
      const width = ui.game.clientWidth;
      const height = ui.game.clientHeight;
      renderer.setSize(width, height, false);
      cameraRig.resize(width, height);
    }

    function cycleCamera() {
      const mode = cameraRig.cycle();
      ui['camera-label'].textContent = mode.toUpperCase();
      ui.camera.setAttribute('aria-label', `Camera: ${mode}. Change camera`);
      toast(
        `${mode === 'event' ? 'Event overview' : mode === 'tracking' ? 'Tracking camera' : 'Side view'} · drag to orbit`,
      );
    }

    async function toggleSound() {
      try {
        await audio.setEnabled(!audio.enabled);
      } catch {
        audio.enabled = false;
      }
      ui['sound-label'].textContent = audio.enabled ? 'SOUND ON' : 'SOUND OFF';
      ui.sound.setAttribute('aria-label', audio.enabled ? 'Turn sound off' : 'Turn sound on');
      ui.sound.classList.toggle('good', audio.enabled);
      if (audio.enabled) audio.tone(450, 0.08, 0.1);
    }

    async function toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (ui.game.requestFullscreen) await ui.game.requestFullscreen();
        else toast('Use your browser’s fullscreen or landscape mode.');
      } catch {
        toast('Fullscreen is unavailable here. Try opening the game in your browser.');
      }
    }

    function openHelp() {
      inputs.clear();
      ui['help-dialog'].showModal();
    }

    ui.start.addEventListener('click', () => begin());
    ui.retry.addEventListener('click', () => begin({ fromTop: true, increment: true }));
    ui.replay.addEventListener('click', () => begin({ increment: true }));
    ui.restart.addEventListener('click', () =>
      begin({
        fromTop: !['ready', 'drive', 'climb'].includes(game.stage),
        increment: game.stage !== 'ready',
      }),
    );
    ui.slow.addEventListener('click', () => setSlow(!slow));
    ui.camera.addEventListener('click', cycleCamera);
    ui.sound.addEventListener('click', toggleSound);
    ui.fullscreen.addEventListener('click', toggleFullscreen);
    ui.help.addEventListener('click', openHelp);
    ui['close-help'].addEventListener('click', () => ui['help-dialog'].close());
    ui['help-done'].addEventListener('click', () => ui['help-dialog'].close());
    ui['help-dialog'].addEventListener('close', () => inputs.clear());
    ui['help-dialog'].addEventListener('click', (event) => {
      if (event.target === ui['help-dialog']) {
        const r = ui['help-dialog'].getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          ui['help-dialog'].close();
      }
    });

    function onShortcut(code) {
      switch (code) {
        case 'Enter':
          if (game.stage === 'ready') begin();
          else if (game.result) begin({ increment: true });
          break;
        case 'KeyR':
          begin({
            fromTop: !['ready', 'drive', 'climb'].includes(game.stage),
            increment: game.stage !== 'ready',
          });
          break;
        case 'KeyT':
          setSlow(!slow);
          break;
        case 'KeyC':
          cycleCamera();
          break;
        case 'KeyM':
          toggleSound();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
        case 'Slash':
          openHelp();
          break;
        case 'Escape':
          paused = !paused;
          inputs.clear();
          document.body.classList.toggle('paused', paused);
          break;
      }
    }

    ui.scene.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      paused = true;
      inputs.clear();
      showFatal(new Error('WebGL context lost'));
    });

    window.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', resize);
    setSlow(slow);
    resize();
    car.position.copy(game.position);
    updateCamera(1, true);
    onStageChange();
    hud.update(game);
    renderer.render(scene, camera);
    ui.loading.hidden = true;

    function frame(now) {
      requestAnimationFrame(frame);
      const realDt = Math.max(0, (now - lastTime) / 1000);
      const dt = Math.min(realDt, 0.1);
      lastTime = now;
      if (document.hidden) return;
      elapsed += dt;
      inputs.sample();
      const isPaused = paused || ui['help-dialog'].open;
      const wasResultPending = Boolean(game.result) && !resultShown;
      const effectsDt = advanceSimulation(game, input, realDt, {
        paused: isPaused || resultShown,
        slowMotion: slow,
        onStep: onStageChange,
      });
      car.position.copy(game.position);
      car.quaternion.copy(game.quaternion);
      updateCamera(dt);
      // Freeze the vehicle under the result menu, while letting residual gas
      // and touchdown particles continue to dissipate behind it.
      effects.update(
        isPaused ? 0 : resultShown ? dt : Math.min(effectsDt, 0.1),
        game,
        car,
        input,
        camera,
        {
          vehiclePaused: resultShown,
        },
      );
      environment.update(elapsed, game.stage);
      audio.update(game, input, isPaused || resultShown);
      contactShadow.position.set(game.position.x, 0.023, game.position.z);
      contactShadow.material.opacity = Math.max(0.08, 0.43 - game.position.y * 0.011);
      const shadowScale = 1 + Math.max(0, game.position.y - COURSE.rideHeight) * 0.024;
      contactShadow.scale.set(shadowScale, shadowScale, 1);
      if (game.result && !resultShown && !isPaused) {
        // Begin counting on the frame after touchdown, so a slow impact frame
        // cannot consume the player's drive-away window. Zero remains immediate.
        if (wasResultPending) resultDelay -= realDt;
        if (resultDelay <= 0) showResult();
      }
      hudElapsed += dt;
      if (hudElapsed >= 1 / 20) {
        hud.update(game);
        hudElapsed = 0;
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
}
