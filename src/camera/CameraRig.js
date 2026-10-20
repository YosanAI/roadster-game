import { MathUtils, Spherical, Vector3 } from 'three';

const MODES = ['event', 'tracking', 'side'];
const clamp = MathUtils.clamp;

/**
 * Camera framing, responsive projection, orbit gestures, zoom and impact shake.
 * It only reads the game's pose; camera input never rotates the vehicle.
 */
export class CameraRig {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.mode = 'event';
    this.shake = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this.drag = null;
    this.target = new Vector3(-3, 9, 0);
    this.desiredTarget = new Vector3();
    this.desiredCamera = new Vector3();
    this.offset = new Vector3();
    this.spherical = new Spherical();
    this.events = new AbortController();
    this.bindEvents();
  }

  reset(mode = this.mode) {
    this.mode = mode;
    this.shake = 0;
    this.orbitYaw = this.orbitPitch = 0;
    this.zoom = 1;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.orbitYaw = this.orbitPitch = 0;
    this.zoom = 1;
    return this.mode;
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 54 : 44;
    this.camera.updateProjectionMatrix();
  }

  /** Camera smoothing uses render time independently of the physics clock. */
  update(dt, game, { width, height, snap = false }) {
    const portrait = width < height;
    const finished = game.stage === 'success' || game.stage === 'crashed';
    const flight = game.stage === 'flight';
    const { desiredTarget, offset, spherical, target, desiredCamera, camera } = this;

    if (this.mode === 'event' || game.stage === 'ready') {
      // The establishing view keeps the starting car and ramp clear of the HUD.
      if (portrait) {
        desiredTarget.set(-26, 3, 0);
        offset.set(-70, 12, 38);
      } else if (height < 620) {
        desiredTarget.set(-18, 6, 0);
        offset.set(-10, 9, 62);
      } else {
        desiredTarget.set(-17, 7.5, 0);
        offset.set(-15, 10, 70);
      }
    } else if (this.mode === 'side') {
      desiredTarget.copy(game.position);
      desiredTarget.y = flight
        ? Math.max(3, game.position.y - 1.8)
        : finished
          ? 2
          : Math.max(5, game.position.y - 2);
      offset.set(0, 4.4, portrait ? 27 : 34);
    } else if (game.stage === 'drive' || game.stage === 'climb') {
      desiredTarget.copy(game.position);
      desiredTarget.x += portrait ? 1.5 : 4.5;
      const groundTargetHeight = !portrait && height < 620 ? 1.8 : 3.8;
      desiredTarget.y = Math.max(groundTargetHeight, game.position.y + 0.4);
      offset.set(-11, 6.5, portrait ? 22 : 26);
    } else if (game.stage === 'inverted') {
      desiredTarget.copy(game.position);
      desiredTarget.x -= 1.7;
      desiredTarget.y -= 3;
      offset.set(-13.5, 5.5, portrait ? 21 : 24);
    } else {
      desiredTarget.copy(game.position);
      desiredTarget.y = Math.max(1.5, game.position.y - (flight ? 1.2 : -0.8));
      offset.set(-10, finished ? 5 : 7, portrait ? 23 : 26);
    }

    spherical.setFromVector3(offset);
    spherical.theta += this.orbitYaw;
    spherical.phi = clamp(spherical.phi + this.orbitPitch, 0.2, 1.51);
    spherical.radius *= this.zoom;
    offset.setFromSpherical(spherical);
    const smoothing = snap ? 1 : 1 - Math.exp(-dt * (flight ? 6 : finished ? 2.5 : 2.8));
    target.lerp(desiredTarget, smoothing);
    desiredCamera.copy(target).add(offset);
    desiredCamera.y = Math.max(1.5, desiredCamera.y);
    camera.position.lerp(desiredCamera, smoothing);
    camera.lookAt(target);

    if (this.shake > 0.003) {
      camera.position.x += (Math.random() - 0.5) * this.shake;
      camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
    }
  }

  bindEvents() {
    const { signal } = this.events;
    this.canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        this.canvas.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    this.canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!this.drag || this.drag.id !== event.pointerId) return;
        this.orbitYaw -= (event.clientX - this.drag.x) * 0.006;
        this.orbitPitch = clamp(this.orbitPitch - (event.clientY - this.drag.y) * 0.004, -0.9, 0.5);
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
      },
      { signal },
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.canvas.addEventListener(
        type,
        () => {
          this.drag = null;
        },
        { signal },
      );
    }
    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoom = clamp(this.zoom * Math.exp(event.deltaY * 0.001), 0.36, 2.2);
      },
      { passive: false, signal },
    );
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
  }

  dispose() {
    this.events.abort();
    this.drag = null;
  }
}
