/**
 * Optional synthesized motor, suction and cold-gas soundscape.
 * Construction is silent and does not create an AudioContext. The app enables
 * audio from a user gesture through setEnabled, satisfying browser autoplay rules.
 * No recorded audio files, network requests or physics decisions are involved.
 */
export class GameAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
  }

  /**
   * Enable/resume audio or smoothly mute the master gain.
   * Call from a click or tap handler when enabling sound for the first time.
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.master) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) {
      this.enabled = false;
      return;
    }
    if (!this.context) this._initialize(Context);
    await this.context.resume();
    this.master.gain.setTargetAtTime(0.27, this.context.currentTime, 0.04);
  }

  /** Create the persistent oscillator/noise graph only on first use. */
  _initialize(Context) {
    const audioContext = (this.context = new Context());
    this.master = audioContext.createGain();
    this.master.gain.value = 0;
    this.master.connect(audioContext.destination);

    this.motor = audioContext.createOscillator();
    this.motor.type = 'sine';
    this.motor.frequency.value = 80;
    this.motorGain = audioContext.createGain();
    this.motorGain.gain.value = 0;
    this.motor.connect(this.motorGain).connect(this.master);
    this.motor.start();

    const noiseBuffer = audioContext.createBuffer(
      1,
      audioContext.sampleRate * 2,
      audioContext.sampleRate,
    );
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    this.noiseBuffer = noiseBuffer;
    const source = audioContext.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    this.noiseFilter = audioContext.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 1500;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = audioContext.createGain();
    this.noiseGain.gain.value = 0;
    source.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    source.start();
  }

  /**
   * Smooth sound parameters toward the latest simulation state.
   * @param {import('../game/FlightGame.js').FlightGame} game Read-only state.
   * @param {object} input Reserved for compatibility; sound uses actual actuator output.
   * @param {boolean} [paused=false] Suppress driving and flight sound while paused.
   */
  update(game, input, paused = false) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const driving =
      game.inContact && ['drive', 'climb', 'inverted', 'success'].includes(game.stage) && !paused;
    const moving = driving && Math.abs(game.driveSpeed) > 0.08;
    const holding = driving && !moving;
    // Adhesion is needed on the ramp, not along the flat approach or after
    // touchdown. Motor and suction share no activation rule on the road.
    const suction = driving && (game.stage === 'climb' || game.stage === 'inverted');
    const flying = game.stage === 'flight' && !paused;
    this.motor.frequency.setTargetAtTime(
      moving ? 100 + game.velocity.length() * 13 : 90,
      now,
      0.12,
    );
    this.motorGain.gain.setTargetAtTime(moving ? 0.13 : holding ? 0.04 : 0, now, 0.1);
    const activeJets = game.thrusterLevels
      ? [...game.thrusterLevels].reduce((sum, level) => sum + level, 0)
      : 0;
    const thrustNoise = flying ? activeJets * 0.14 : 0;
    this.noiseGain.gain.setTargetAtTime(suction ? (moving ? 0.1 : 0.07) : thrustNoise, now, 0.04);
    this.noiseFilter.frequency.setTargetAtTime(flying ? 2200 : 450, now, 0.08);
  }

  /**
   * Schedule a short sine tone and disconnect its temporary nodes when finished.
   * @param {number} frequency Frequency in hertz.
   * @param {number} [duration=0.12] Tone duration in seconds.
   * @param {number} [volume=0.18] Peak gain before the master volume.
   * @param {number} [delay=0] Delay from the audio clock's current time, in seconds.
   */
  tone(frequency, duration = 0.12, volume = 0.18, delay = 0) {
    if (!this.context || !this.enabled) return;
    const audioContext = this.context;
    const startTime = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  /** @param {boolean} safe Choose the landing confirmation or crash tone. */
  touchdown(safe) {
    if (!this.context || !this.enabled) return;
    this.tone(safe ? 100 : 48, safe ? 0.24 : 0.65, safe ? 0.4 : 0.65);
    if (safe) [440, 554.37, 659.25].forEach((hz, i) => this.tone(hz, 0.5, 0.12, 0.2 + i * 0.13));
  }
}
