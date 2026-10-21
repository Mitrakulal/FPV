/**
 * Synthesised sound for the simulator.
 *
 * There are no audio files: every layer is generated locally with the Web Audio
 * API. The aim is a believable onboard FPV mic, not a game soundtrack:
 *
 *   - four detuned motor voices, one per prop, panned by position;
 *   - a low, filtered body that opens up with throttle instead of a shrill saw;
 *   - speed-scaled wind, a separate prop-wash layer when descending;
 *   - a quiet outdoor wind bed / indoor hall tone, plus sparse birds outside;
 *   - short one-shots for arm, disarm, touchdown, bumps, crashes and portals;
 *   - a hall reverb in the indoor world, nearly dry outside;
 *   - a master compressor + gentle mic filtering so peaks never get harsh.
 *
 * The mix is deliberately conservative. Volume and mute persist in localStorage,
 * all gains use ramps (no clicks), and a subtle master limiter catches crashes.
 */

export type AudioEnvironment = 'outdoor' | 'indoor';

export interface AudioFrame {
  motors: [number, number, number, number];
  armed: boolean;
  crashed: boolean;
  paused: boolean;
  speed: number;
  verticalSpeed: number;
  bumps: number;
  bumpSpeed: number;
  landings: number;
  landingImpact: number;
}

interface MotorVoice {
  sawA: OscillatorNode;
  sawB: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  vca: GainNode;
}

const VOLUME_KEY = 'fpv.audio.volume';
const MUTE_KEY = 'fpv.audio.muted';
const DEFAULT_VOLUME = 0.7;

/** Slight stereo spread for an onboard, centred microphone. */
const PAN = [0.3, -0.3, 0.17, -0.17];
/** Per-motor detune, in cents, so the four motors never phase into one tone. */
const DETUNE_A = [-4, 2, -7, 5];
const DETUNE_B = [6, -5, 3, -8];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable in private windows */
  }
}

export class SimAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private analyser!: AnalyserNode;
  private motorBus!: GainNode;
  private sfxBus!: GainNode;
  private ambienceBus!: GainNode;
  private reverbWet!: GainNode;
  private motorVerbSend!: GainNode;
  private sfxVerbSend!: GainNode;
  private ambVerbSend!: GainNode;

  private voices: MotorVoice[] = [];
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windHiss!: GainNode;
  private windFilter!: BiquadFilterNode;
  private washGain!: GainNode;
  private washDepth!: GainNode;
  private washFilter!: BiquadFilterNode;
  private propAirGain!: GainNode;
  private propAirFilter!: BiquadFilterNode;

  private outdoorAmbience!: GainNode;
  private indoorAmbience!: GainNode;
  private birdAt = Infinity;
  private suspendTimer = 0;

  private environment: AudioEnvironment = 'outdoor';
  private volumeValue = DEFAULT_VOLUME;
  private mutedValue = false;
  private hidden = false;

  private wasArmed = false;
  private wasCrashed = false;
  private lastSpeed = 0;
  private lastBumps = 0;
  private lastLandings = 0;
  private lastBumpAt = -10;
  private lastLandingAt = -10;

  constructor() {
    try {
      const raw = localStorage.getItem(VOLUME_KEY);
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isFinite(n)) this.volumeValue = clamp(n / 100, 0, 1);
      }
      this.mutedValue = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* defaults are fine */
    }
    this.watchVisibility();
  }

  get volume(): number {
    return this.volumeValue;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture; safe to call repeatedly. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.hidden) {
        void this.ctx.resume().catch(() => {});
      }
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }

    this.ctx = ctx;
    try {
      this.build(ctx);
    } catch {
      this.ctx = null;
      return;
    }

    this.applyEnvironment(true);
    this.applyMaster(false);
    this.birdAt = ctx.currentTime + 16 + Math.random() * 14;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  setEnvironment(environment: AudioEnvironment): void {
    if (this.environment === environment) return;
    this.environment = environment;
    this.applyEnvironment(false);
  }

  setVolume(volume: number): void {
    const next = clamp(volume, 0, 1);
    if (Math.abs(next - this.volumeValue) < 0.0001) return;
    this.volumeValue = next;
    store(VOLUME_KEY, String(Math.round(next * 100)));
    this.applyMaster(false);
  }

  setMuted(muted: boolean): void {
    if (this.mutedValue === muted) return;
    this.mutedValue = muted;
    store(MUTE_KEY, muted ? '1' : '0');
    this.applyMaster(false);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.mutedValue);
    return this.mutedValue;
  }

  /** Called once per rendered frame. Counters make the event detection cheap. */
  update(frame: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.wasArmed = frame.armed;
      this.wasCrashed = frame.crashed;
      this.lastBumps = frame.bumps;
      this.lastLandings = frame.landings;
      this.lastSpeed = frame.speed;
      return;
    }

    const t = ctx.currentTime;
    const active = !frame.paused && !frame.crashed;
    const crashedNow = frame.crashed;

    // Arm / disarm tones. Do not chirp while paused: the menu is a quiet place.
    if (!frame.paused) {
      if (frame.armed && !this.wasArmed) this.armTone();
      else if (!frame.armed && this.wasArmed) this.disarmTone();
    }
    this.wasArmed = frame.armed;

    // A crash is the one loud event. Scale it by the speed just before impact.
    if (crashedNow && !this.wasCrashed && !frame.paused) {
      this.crashSound(clamp(this.lastSpeed / 15, 0.3, 1));
    }
    this.wasCrashed = crashedNow;

    // Bumps and landings arrive as monotonic counters from the physics model.
    if (frame.bumps < this.lastBumps) this.lastBumps = 0;
    if (frame.bumps > this.lastBumps) {
      if (!crashedNow && !frame.paused && t - this.lastBumpAt > 0.16) {
        this.bumpSound(clamp(frame.bumpSpeed / 4.5, 0.12, 1));
        this.lastBumpAt = t;
      }
      this.lastBumps = frame.bumps;
    }

    if (frame.landings < this.lastLandings) this.lastLandings = 0;
    if (frame.landings > this.lastLandings) {
      if (!crashedNow && !frame.paused && t - this.lastLandingAt > 0.25) {
        this.touchdownSound(clamp(frame.landingImpact / 9, 0.15, 1));
        this.lastLandingAt = t;
      }
      this.lastLandings = frame.landings;
    }

    // ------------------------------------------------------------- motors
    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (!voice) continue;
      const level = active ? clamp(frame.motors[i] ?? 0, 0, 1) : 0;
      const freq = 64 + level * 268;
      const gain = level > 0.0015 ? 0.104 * Math.pow(level, 0.82) : 0;
      const cutoff = 520 + level * 4300;

      voice.vca.gain.setTargetAtTime(gain, t, 0.055);
      voice.sawA.frequency.setTargetAtTime(freq, t, 0.035);
      voice.sawB.frequency.setTargetAtTime(freq, t, 0.035);
      voice.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
      voice.filter.frequency.setTargetAtTime(cutoff, t, 0.06);
    }

    // --------------------------------------------------------------- wind
    const speed = frame.paused ? 0 : Math.max(0, frame.speed);
    const indoor = this.environment === 'indoor';
    const avg = active
      ? (frame.motors[0] + frame.motors[1] + frame.motors[2] + frame.motors[3]) / 4
      : 0;
    const windLow = Math.min(indoor ? 0.03 : 0.06, speed * (indoor ? 0.0011 : 0.0026));
    const windHigh = Math.min(indoor ? 0.012 : 0.03, speed * (indoor ? 0.0004 : 0.0012));
    this.windGain.gain.setTargetAtTime(windLow, t, 0.12);
    this.windHiss.gain.setTargetAtTime(windHigh, t, 0.12);
    this.windFilter.frequency.setTargetAtTime((indoor ? 380 : 520) + speed * 18, t, 0.2);

    // Broadband prop air at hover. Without it the saw stack sounds like a synth.
    this.propAirGain.gain.setTargetAtTime(avg * 0.045, t, 0.09);
    this.propAirFilter.frequency.setTargetAtTime(780 + avg * 1500, t, 0.1);

    // Prop wash is a separate broadband layer; only present while descending.
    const wash =
      active && avg > 0.02
        ? clamp(-frame.verticalSpeed / 6, 0, 1.4) * avg * 0.07
        : 0;
    this.washGain.gain.setTargetAtTime(wash, t, 0.08);
    this.washDepth.gain.setTargetAtTime(wash * 0.4, t, 0.08);
    this.washFilter.frequency.setTargetAtTime(260 + avg * 180, t, 0.1);

    // ------------------------------------------------------------- ambience
    if (!indoor && !this.mutedValue && !this.hidden && ctx.state === 'running' && t >= this.birdAt) {
      this.bird(t + 0.04);
      this.birdAt = t + 20 + Math.random() * 28;
    }

    this.lastSpeed = frame.speed;
  }

  /** Confirmation bell for the indoor course. */
  portal(step: number, complete: boolean): void {
    if (!this.audible()) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.015;

    if (complete) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => this.bell(t + i * 0.09, freq, 0.85, 0.034));
      this.bell(t + 0.02, 261.63, 1.2, 0.018);
      return;
    }

    const scale = [0, 2, 4, 7, 9, 12];
    const semitone = scale[Math.min(Math.max(0, step), scale.length - 1)]!;
    const freq = 523.25 * Math.pow(2, semitone / 12);
    this.bell(t, freq, 0.55, 0.036);
    this.bell(t + 0.06, freq * 1.5, 0.48, 0.018);
  }

  stats(): {
    ready: boolean;
    state: string;
    environment: AudioEnvironment;
    volume: number;
    muted: boolean;
    voices: number;
    reduction: number;
    rms: number;
    peak: number;
    master: number;
    motor: number;
    wind: number;
    wash: number;
    wet: number;
  } {
    let rms = 0;
    let peak = 0;
    if (this.ctx && this.analyser) {
      const data = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] ?? 0);
        rms += v * v;
        if (v > peak) peak = v;
      }
      rms = Math.sqrt(rms / data.length);
    }
    return {
      ready: this.ctx !== null,
      state: this.ctx?.state ?? 'none',
      environment: this.environment,
      volume: this.volumeValue,
      muted: this.mutedValue,
      voices: this.voices.length,
      reduction: this.ctx ? this.limiter.reduction : 0,
      rms,
      peak,
      master: this.ctx ? this.master.gain.value : 0,
      motor: this.voices[0]?.vca.gain.value ?? 0,
      wind: this.ctx ? this.windGain.gain.value : 0,
      wash: this.ctx ? this.washGain.gain.value : 0,
      wet: this.ctx ? this.reverbWet.gain.value : 0,
    };
  }

  // ---------------------------------------------------------------- graph
  private build(ctx: AudioContext): void {
    this.noise = makeNoise(ctx);

    const mix = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 38;
    highpass.Q.value = 0.7;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 15000;
    lowpass.Q.value = 0.45;
    const airTame = ctx.createBiquadFilter();
    airTame.type = 'highshelf';
    airTame.frequency.value = 4800;
    airTame.gain.value = -2.5;

    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -13;
    limiter.knee.value = 10;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.24;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;

    mix.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(airTame);
    airTame.connect(master);
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    this.master = master;
    this.limiter = limiter;
    this.analyser = analyser;

    // Buses. Everything passes through the same master so the volume slider and
    // the limiter govern the whole flight, not just the motors.
    const motorBus = ctx.createGain();
    motorBus.gain.value = 0.9;
    const motorHP = ctx.createBiquadFilter();
    motorHP.type = 'highpass';
    motorHP.frequency.value = 35;
    motorHP.Q.value = 0.6;
    const motorLP = ctx.createBiquadFilter();
    motorLP.type = 'lowpass';
    motorLP.frequency.value = 6800;
    motorLP.Q.value = 0.5;
    motorBus.connect(motorHP);
    motorHP.connect(motorLP);
    motorLP.connect(mix);
    this.motorBus = motorBus;

    const sfxBus = ctx.createGain();
    sfxBus.connect(mix);
    this.sfxBus = sfxBus;

    const ambienceBus = ctx.createGain();
    ambienceBus.connect(mix);
    this.ambienceBus = ambienceBus;

    // Reverb send/return. The same impulse is used all the time; the map only
    // changes the send and wet level, which is cheap and cannot glitch.
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 1.6);
    const send = ctx.createGain();
    send.gain.value = 1;
    const sendHP = ctx.createBiquadFilter();
    sendHP.type = 'highpass';
    sendHP.frequency.value = 260;
    sendHP.Q.value = 0.6;
    const returnLP = ctx.createBiquadFilter();
    returnLP.type = 'lowpass';
    returnLP.frequency.value = 4500;
    returnLP.Q.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    send.connect(sendHP);
    sendHP.connect(convolver);
    convolver.connect(returnLP);
    returnLP.connect(wet);
    wet.connect(mix);
    this.reverbWet = wet;

    this.motorVerbSend = ctx.createGain();
    motorBus.connect(this.motorVerbSend);
    this.motorVerbSend.connect(send);
    this.sfxVerbSend = ctx.createGain();
    sfxBus.connect(this.sfxVerbSend);
    this.sfxVerbSend.connect(send);
    this.ambVerbSend = ctx.createGain();
    ambienceBus.connect(this.ambVerbSend);
    this.ambVerbSend.connect(send);

    this.buildMotors(ctx);
    this.buildWind(ctx);
    this.buildAmbience(ctx);
  }

  private buildMotors(ctx: AudioContext): void {
    for (let i = 0; i < 4; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.9;

      const vca = ctx.createGain();
      vca.gain.value = 0;
      const panner = ctx.createStereoPanner();
      panner.pan.value = PAN[i] ?? 0;

      const sawA = ctx.createOscillator();
      sawA.type = 'sawtooth';
      sawA.frequency.value = 64;
      sawA.detune.value = DETUNE_A[i] ?? 0;
      const sawB = ctx.createOscillator();
      sawB.type = 'sawtooth';
      sawB.frequency.value = 64;
      sawB.detune.value = DETUNE_B[i] ?? 0;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 32;

      const gainA = ctx.createGain();
      gainA.gain.value = 0.6;
      const gainB = ctx.createGain();
      gainB.gain.value = 0.44;
      const gainSub = ctx.createGain();
      gainSub.gain.value = 0.28;

      sawA.connect(gainA);
      gainA.connect(filter);
      sawB.connect(gainB);
      gainB.connect(filter);
      sub.connect(gainSub);
      gainSub.connect(filter);
      filter.connect(vca);
      vca.connect(panner);
      panner.connect(this.motorBus);

      sawA.start();
      sawB.start();
      sub.start();
      this.voices.push({ sawA, sawB, sub, filter, vca });
    }
  }

  private buildWind(ctx: AudioContext): void {
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 520;
    low.Q.value = 0.55;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0;
    source.connect(low);
    low.connect(lowGain);
    lowGain.connect(this.motorBus);
    this.windGain = lowGain;
    this.windFilter = low;

    // A slow gust LFO on the cutoff keeps the wind from sounding like a loop.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.11;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 75;
    gust.connect(gustDepth);
    gustDepth.connect(low.frequency);
    gust.start();

    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 1500;
    hiss.Q.value = 0.55;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    source.connect(hiss);
    hiss.connect(hissGain);
    hissGain.connect(this.motorBus);
    this.windHiss = hissGain;

    const propAir = ctx.createBiquadFilter();
    propAir.type = 'bandpass';
    propAir.frequency.value = 900;
    propAir.Q.value = 0.65;
    const propAirGain = ctx.createGain();
    propAirGain.gain.value = 0;
    source.connect(propAir);
    propAir.connect(propAirGain);
    propAirGain.connect(this.motorBus);
    this.propAirGain = propAirGain;
    this.propAirFilter = propAir;

    const wash = ctx.createBufferSource();
    wash.buffer = this.noise;
    wash.loop = true;
    const washFilter = ctx.createBiquadFilter();
    washFilter.type = 'bandpass';
    washFilter.frequency.value = 300;
    washFilter.Q.value = 1.25;
    const washGain = ctx.createGain();
    washGain.gain.value = 0;
    wash.connect(washFilter);
    washFilter.connect(washGain);
    washGain.connect(this.motorBus);
    this.washGain = washGain;
    this.washFilter = washFilter;

    const washLfo = ctx.createOscillator();
    washLfo.frequency.value = 6.1;
    const washDepth = ctx.createGain();
    washDepth.gain.value = 0;
    washLfo.connect(washDepth);
    washDepth.connect(washGain.gain);
    washLfo.start();

    this.washDepth = washDepth;
    source.start();
    wash.start();
  }

  private buildAmbience(ctx: AudioContext): void {
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;

    const outdoor = ctx.createGain();
    outdoor.gain.value = 0;
    outdoor.connect(this.ambienceBus);
    this.outdoorAmbience = outdoor;

    const bed = ctx.createBiquadFilter();
    bed.type = 'lowpass';
    bed.frequency.value = 300;
    bed.Q.value = 0.4;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.02;
    source.connect(bed);
    bed.connect(bedGain);
    bedGain.connect(outdoor);

    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.006;
    gust.connect(gustDepth);
    gustDepth.connect(bedGain.gain);
    gust.start();

    const leaves = ctx.createBiquadFilter();
    leaves.type = 'bandpass';
    leaves.frequency.value = 900;
    leaves.Q.value = 0.4;
    const leavesGain = ctx.createGain();
    leavesGain.gain.value = 0.004;
    source.connect(leaves);
    leaves.connect(leavesGain);
    leavesGain.connect(outdoor);

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 75;
    rumble.Q.value = 0.5;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.012;
    source.connect(rumble);
    rumble.connect(rumbleGain);
    rumbleGain.connect(outdoor);

    const indoor = ctx.createGain();
    indoor.gain.value = 0;
    indoor.connect(this.ambienceBus);
    this.indoorAmbience = indoor;

    const hall = ctx.createBiquadFilter();
    hall.type = 'lowpass';
    hall.frequency.value = 120;
    hall.Q.value = 0.5;
    const hallGain = ctx.createGain();
    hallGain.gain.value = 0.012;
    source.connect(hall);
    hall.connect(hallGain);
    hallGain.connect(indoor);

    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 460;
    air.Q.value = 0.55;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.0045;
    source.connect(air);
    air.connect(airGain);
    airGain.connect(indoor);

    source.start();
  }

  // -------------------------------------------------------------- one-shots
  private audible(): boolean {
    return (
      this.ctx !== null &&
      !this.mutedValue &&
      !this.hidden &&
      this.ctx.state === 'running'
    );
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.002, attack) + decay);
    return g;
  }

  private tone(
    t: number,
    freq: number,
    dur: number,
    peak: number,
    type: OscillatorType = 'triangle',
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = this.env(t, peak, 0.006, dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private armTone(): void {
    if (!this.audible()) return;
    const t = this.ctx!.currentTime + 0.02;
    this.tone(t, 880, 0.07, 0.042);
    this.tone(t + 0.1, 1318.5, 0.1, 0.04);
  }

  private disarmTone(): void {
    if (!this.audible()) return;
    const t = this.ctx!.currentTime + 0.02;
    this.tone(t, 987.8, 0.08, 0.034);
    this.tone(t + 0.1, 659.3, 0.12, 0.03);
  }

  private crashSound(k: number): void {
    if (!this.audible()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.004;

    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(100, t);
    body.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    const bodyGain = this.env(t, 0.17 * k, 0.004, 0.28);
    body.connect(bodyGain);
    bodyGain.connect(this.sfxBus);
    body.start(t);
    body.stop(t + 0.36);

    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noise;
    const crunchFilter = ctx.createBiquadFilter();
    crunchFilter.type = 'lowpass';
    crunchFilter.frequency.setValueAtTime(1800, t);
    crunchFilter.frequency.exponentialRampToValueAtTime(320, t + 0.2);
    crunchFilter.Q.value = 0.7;
    const crunchGain = this.env(t, 0.15 * k, 0.002, 0.22);
    crunch.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(this.sfxBus);
    crunch.start(t);
    crunch.stop(t + 0.29);

    this.tone(t + 0.008, 1450, 0.16, 0.014 * k, 'triangle');
    this.tone(t + 0.014, 2350, 0.12, 0.008 * k, 'triangle');
  }

  private touchdownSound(k: number): void {
    if (!this.audible()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.004;

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(118, t);
    thud.frequency.exponentialRampToValueAtTime(54, t + 0.13);
    const thudGain = this.env(t, 0.075 * k, 0.003, 0.14);
    thud.connect(thudGain);
    thudGain.connect(this.sfxBus);
    thud.start(t);
    thud.stop(t + 0.2);

    const grit = ctx.createBufferSource();
    grit.buffer = this.noise;
    const gritFilter = ctx.createBiquadFilter();
    gritFilter.type = 'lowpass';
    gritFilter.frequency.value = 650;
    gritFilter.Q.value = 0.6;
    const gritGain = this.env(t, 0.022 * k, 0.002, 0.075);
    grit.connect(gritFilter);
    gritFilter.connect(gritGain);
    gritGain.connect(this.sfxBus);
    grit.start(t);
    grit.stop(t + 0.12);
  }

  private bumpSound(k: number): void {
    if (!this.audible()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.003;

    const knock = ctx.createBufferSource();
    knock.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.4;
    const gain = this.env(t, 0.04 * k, 0.002, 0.055);
    knock.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    knock.start(t);
    knock.stop(t + 0.08);

    this.tone(t, 140, 0.055, 0.018 * k, 'sine');
  }

  private bell(t: number, freq: number, dur: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const partials: Array<[number, number]> = [
      [1, 1],
      [2.005, 0.22],
      [3.99, 0.06],
    ];
    for (const [ratio, amp] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * ratio, t);
      const g = this.env(t, peak * amp, 0.005, dur);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    }
  }

  private bird(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.8;
    pan.connect(this.outdoorAmbience);

    const base = 2200 + Math.random() * 1400;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const at = t + i * (0.09 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (0.85 + Math.random() * 0.2), at);
      osc.frequency.exponentialRampToValueAtTime(
        base * (1.15 + Math.random() * 0.25),
        at + 0.055,
      );
      const g = this.env(at, 0.006 + Math.random() * 0.005, 0.006, 0.06);
      osc.connect(g);
      g.connect(pan);
      osc.start(at);
      osc.stop(at + 0.11);
    }
  }

  // ------------------------------------------------------------- mix state
  private applyEnvironment(instant: boolean): void {
    if (!this.ctx) return;
    const indoor = this.environment === 'indoor';
    const t = this.ctx.currentTime;
    const tc = instant ? 0.001 : 0.6;
    this.outdoorAmbience.gain.setTargetAtTime(indoor ? 0 : 1, t, tc);
    this.indoorAmbience.gain.setTargetAtTime(indoor ? 1 : 0, t, tc);
    this.motorVerbSend.gain.setTargetAtTime(indoor ? 0.55 : 0.06, t, tc);
    this.sfxVerbSend.gain.setTargetAtTime(indoor ? 0.6 : 0.16, t, tc);
    this.ambVerbSend.gain.setTargetAtTime(indoor ? 0.25 : 0.05, t, tc);
    this.reverbWet.gain.setTargetAtTime(indoor ? 0.17 : 0.05, t, tc);
    if (!indoor) {
      this.birdAt = Math.max(this.birdAt, t + 10 + Math.random() * 14);
    }
  }

  private applyMaster(instant: boolean): void {
    if (!this.ctx) return;
    const target = this.hidden || this.mutedValue ? 0 : this.volumeValue;
    const t = this.ctx.currentTime;
    if (instant) this.master.gain.setValueAtTime(target, t);
    else this.master.gain.setTargetAtTime(target, t, 0.06);
  }

  private watchVisibility(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      if (!this.ctx) return;
      if (this.hidden) {
        this.applyMaster(false);
        this.suspendTimer = window.setTimeout(() => {
          if (this.hidden && this.ctx && this.ctx.state === 'running') {
            void this.ctx.suspend().catch(() => {});
          }
        }, 450);
      } else {
        if (this.suspendTimer) {
          window.clearTimeout(this.suspendTimer);
          this.suspendTimer = 0;
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
        this.applyMaster(false);
      }
    });
  }
}

/** Four seconds of white noise, reused by every noise layer. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * A decorrelated stereo hall. Noise with a smooth decay sounds less like a
 * metallic plate than a sparse impulse train and is much cheaper to author.
 */
function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const preDelay = Math.floor(ctx.sampleRate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      if (i < preDelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, 2.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buffer;
}
