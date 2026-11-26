/**
 * js/audio.js
 * ---------------------------------------------------------------------------
 * A fully procedural Web Audio engine for the "3D Christmas tree" showcase.
 *
 * There are NO audio files anywhere in this project: every bell, pad, arpeggio
 * and sound-effect is synthesised at runtime from oscillators, filtered noise
 * and a procedurally generated convolution reverb.
 *
 * Signal flow
 *
 *   music voices ──► session.out ──► musicBus ──► compressor ──┐
 *                          └─────► session.rev ──► reverbSend ─┤
 *                                                              ├─► masterGain ─► destination
 *   sfx voices  ──► sfxBus ────────────────────────────────┘
 *                     └─────► sfxRev ──► reverbSend ──► convolver ──► reverbReturn ──┘
 *
 * Everything is created lazily: importing this module touches no browser API,
 * so it is safe to import from Node (for syntax checks) or from a page that
 * has not seen a user gesture yet.
 *
 * The carols below ("Silent Night", "Jingle Bells", "We Wish You a Merry
 * Christmas") are traditional public-domain melodies, hand-coded as note
 * arrays. The arrangements (pads, arpeggi, bass, percussion) are original.
 * ---------------------------------------------------------------------------
 */

/* ========================================================================== *
 * Music theory helpers
 * ========================================================================== */

const SEMITONE_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;

/**
 * "G4" -> 392, "Bb3" -> 233.08, "F#5" -> 739.99
 * Returns 0 for an unparsable name so callers can cheaply skip.
 */
function noteToFreq(name) {
  if (!name) return 0;
  const m = NOTE_RE.exec(String(name).trim());
  if (!m) return 0;
  const letter = m[1].toUpperCase();
  let semi = SEMITONE_OF[letter];
  if (semi === undefined) return 0;
  if (m[2] === '#') semi += 1;
  else if (m[2] === 'b') semi -= 1;
  const octave = parseInt(m[3], 10);
  const midi = 12 * (octave + 1) + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Parse a chord symbol such as "C", "Am", "G7", "Fmaj7", "Dsus4". */
function parseChord(symbol) {
  const m = /^([A-G])([#b]?)(maj7|m7|min7|dim|sus4|maj|min|m|7)?$/.exec(String(symbol).trim());
  if (!m) return { root: 0, intervals: [0, 4, 7] };
  let root = SEMITONE_OF[m[1]];
  if (m[2] === '#') root += 1;
  else if (m[2] === 'b') root -= 1;
  const quality = m[3] || '';
  let intervals;
  switch (quality) {
    case 'm':
    case 'min':
      intervals = [0, 3, 7];
      break;
    case 'm7':
    case 'min7':
      intervals = [0, 3, 7, 10];
      break;
    case '7':
      intervals = [0, 4, 7, 10];
      break;
    case 'maj7':
      intervals = [0, 4, 7, 11];
      break;
    case 'sus4':
      intervals = [0, 5, 7];
      break;
    case 'dim':
      intervals = [0, 3, 6];
      break;
    default:
      intervals = [0, 4, 7];
  }
  return { root, intervals };
}

/**
 * Voice a chord into actual frequencies around the C4..C5 octave so the pad
 * never turns to mud or squeals.
 */
function chordVoices(symbol, baseOctave) {
  const { root, intervals } = parseChord(symbol);
  const octave = baseOctave === undefined ? 4 : baseOctave;
  const baseIndex = 12 * (octave + 1) + root; // MIDI-ish index
  return intervals.map(function (iv) {
    const midi = baseIndex + iv;
    return 440 * Math.pow(2, (midi - 69) / 12);
  });
}

/** Low root for the bass voice (one octave below the pad voicing). */
function chordRootLow(symbol, baseOctave) {
  const { root } = parseChord(symbol);
  const octave = baseOctave === undefined ? 3 : baseOctave;
  const midi = 12 * (octave + 1) + root;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ========================================================================== *
 * Repertoire — three public-domain carols
 *
 * melody: [noteName|null, beats]   (a quarter note is 1 beat)
 * chords: [chordSymbol, beats]
 * Both streams are laid on the same beat timeline; their totals are equal.
 * ========================================================================== */

const TRACKS = [
  /* ---------------------------------------------------------------------- *
   * 1. Silent Night — 3/4, 76 BPM, 20 bars (60 beats)
   * ---------------------------------------------------------------------- */
  {
    name: '《平安夜》 Silent Night',
    bpm: 76,
    beatsPerBar: 3,
    hats: false,
    bellColor: 1.0,
    melody: [
      // Silent night
      ['G4', 1.5], ['A4', 0.5], ['G4', 1], ['E4', 3],
      // Holy night
      ['G4', 1.5], ['A4', 0.5], ['G4', 1], ['E4', 3],
      // All is calm
      ['D5', 2], ['D5', 1], ['B4', 3],
      // all is bright
      ['C5', 2], ['C5', 1], ['G4', 3],
      // Round yon virgin
      ['A4', 2], ['A4', 1], ['C5', 1.5], ['B4', 0.5], ['A4', 1],
      // mother and child
      ['G4', 2], ['A4', 1], ['G4', 1.5], ['E4', 0.5], ['E4', 1],
      // Holy infant
      ['D5', 2], ['D5', 1], ['F5', 1.5], ['D5', 0.5], ['B4', 1],
      // so tender and mild
      ['C5', 2], ['E5', 1], ['C5', 1.5], ['G4', 0.5], ['G4', 1],
      // Sleep in heavenly peace
      ['F4', 1.5], ['D4', 0.5], ['B4', 2], ['C5', 2],
      // Sleep in heavenly peace (final, resolving)
      ['F4', 1.5], ['D4', 0.5], ['B4', 1], ['C5', 3]
    ],
    chords: [
      ['C', 3], ['C', 3], ['G7', 3], ['C', 3],
      ['F', 3], ['C', 3], ['G7', 3], ['C', 3],
      ['F', 3], ['C', 3], ['F', 3], ['C', 3],
      ['G7', 3], ['C', 3], ['G7', 3], ['C', 3],
      ['G7', 3], ['C', 3], ['G7', 3], ['C', 3]
    ]
  },

  /* ---------------------------------------------------------------------- *
   * 2. Jingle Bells — 4/4, 96 BPM, 16 bars (64 beats)
   * ---------------------------------------------------------------------- */
  {
    name: '《铃儿响叮当》 Jingle Bells',
    bpm: 96,
    beatsPerBar: 4,
    hats: true,
    bellColor: 1.06,
    melody: [
      // Jingle bells, jingle bells
      ['E4', 1], ['E4', 1], ['E4', 2],
      ['E4', 1], ['E4', 1], ['E4', 2],
      // Jingle all the way
      ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
      // Oh what fun it is to ride
      ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5],
      ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
      // in a one-horse open sleigh
      ['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1],
      ['D4', 2], ['G4', 2],
      // Jingle bells, jingle bells
      ['E4', 1], ['E4', 1], ['E4', 2],
      ['E4', 1], ['E4', 1], ['E4', 2],
      // Jingle all the way
      ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
      // Oh what fun it is to ride
      ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5],
      ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
      // in a one-horse open sleigh
      ['G4', 1], ['G4', 1], ['F4', 1], ['D4', 1],
      ['C4', 4]
    ],
    chords: [
      ['C', 4], ['C', 4], ['C', 4], ['C', 4],
      ['F', 4], ['C', 4], ['G7', 4], ['G7', 4],
      ['C', 4], ['C', 4], ['C', 4], ['C', 4],
      ['F', 4], ['C', 4], ['G7', 4], ['C', 4]
    ]
  },

  /* ---------------------------------------------------------------------- *
   * 3. We Wish You a Merry Christmas — 3/4, 88 BPM, 16 bars (48 beats)
   * ---------------------------------------------------------------------- */
  {
    name: '《圣诞快乐》 We Wish You a Merry Christmas',
    bpm: 88,
    beatsPerBar: 3,
    hats: false,
    bellColor: 1.12,
    melody: [
      // We wish you a merry Christmas
      ['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
      // We wish you a merry Christmas
      ['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
      // We wish you a merry Christmas
      ['G4', 0.5], ['G4', 0.5], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1],
      // and a happy new year
      ['F5', 1], ['F5', 1], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 1],
      // Good tidings we bring
      ['C5', 0.5], ['C5', 0.5], ['D5', 1], ['C5', 1], ['F5', 1], ['E5', 2],
      // to you and your kin
      ['C5', 0.5], ['C5', 0.5], ['D5', 1], ['C5', 1], ['G5', 1], ['F5', 1],
      // We wish you a merry Christmas
      ['G4', 0.5], ['G4', 0.5], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1],
      // and a happy new year (final note held)
      ['F5', 1], ['F5', 1], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 2]
    ],
    chords: [
      ['G', 3], ['D7', 3], ['G', 3], ['D7', 3],
      ['G', 3], ['D7', 3], ['C', 3], ['D7', 3],
      ['G', 3], ['D7', 3], ['G', 3], ['D7', 3],
      ['G', 3], ['D7', 3], ['C', 3], ['G', 3]
    ]
  }
];

/* ========================================================================== *
 * Tunables
 * ========================================================================== */

const LOOKAHEAD = 0.18; // seconds of audio scheduled ahead of the clock
const TICK_MS = 25; // scheduler wake-up interval
const FADE = 1.2; // music crossfade / fade-in-out time
const REV_SEND_MUSIC = 0.32; // reverb send for the music bed
const REV_SEND_SFX = 0.22; // reverb send for one-shot effects
const REV_RETURN = 0.85; // convolver output level
const REV_SECONDS = 2.3; // impulse response length
const IR_DECAY = 2.6; // impulse response decay exponent

/* ========================================================================== *
 * Module state (created lazily, never at import time)
 * ========================================================================== */

const S = {
  ctx: null,
  master: null,
  compressor: null,
  musicBus: null,
  sfxBus: null,
  reverbSend: null,
  reverbReturn: null,
  sfxRev: null,
  noise: null,

  vol: 0.8,
  musicVol: 0.72,
  sfxVol: 0.85,

  started: false,
  inited: false,
  session: null,
  trackIndex: 0,
  failed: false,

  /* user-supplied music (optional replacement for the built-in carols) */
  userMode: false,
  userTracks: [],      // [{ name, url }]
  userIndex: 0,
  userAudio: null,     // HTMLAudioElement (created once, src swapped)
  userSource: null,    // MediaElementAudioSourceNode
  userGain: null,      // gain node -> musicBus, used for crossfade
  userStopTimer: null
};

const timers = new Set();

function later(ms, fn) {
  const id = setTimeout(function () {
    timers.delete(id);
    try {
      fn();
    } catch (e) {
      /* never let a cleanup timer break the page */
    }
  }, Math.max(0, ms));
  timers.add(id);
  return id;
}

function clearTimers() {
  for (const id of timers) clearTimeout(id);
  timers.clear();
}

/* ========================================================================== *
 * Graph construction
 * ========================================================================== */

/** White noise, gently low-passed so it reads as "air" rather than hiss. */
function buildNoiseBuffer(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    lp += (white - lp) * 0.6;
    d[i] = lp;
  }
  return buf;
}

/**
 * Procedural impulse response: stereo decaying noise whose brightness falls
 * off along with its amplitude (a cheap but convincing "hall" tail).
 */
function buildImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const preDelay = Math.floor(rate * 0.014);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // one-pole coefficient: brighter at the start, darker in the tail
      const coef = 0.62 - 0.45 * t;
      lp += (Math.random() * 2 - 1 - lp) * coef;
      const env = Math.pow(1 - t, IR_DECAY);
      const fade = i < preDelay ? 0 : 1;
      // a very short soft onset so the tail blooms instead of clicking
      const onset = i < preDelay * 2 ? (i - preDelay) / preDelay : 1;
      d[i] = lp * env * fade * Math.max(0, onset) * 0.9;
    }
  }
  return buf;
}

/** Create the whole node graph. Called from a user gesture (or lazily). */
function buildGraph() {
  if (S.ctx) return S.ctx;

  const AC =
    typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) {
    if (!S.failed) {
      S.failed = true;
      console.debug('[audio] Web Audio API is not available in this browser.');
    }
    return null;
  }

  let ctx;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch (e) {
    ctx = new AC();
  }
  S.ctx = ctx;
  S.noise = buildNoiseBuffer(ctx, 2.0);

  /* master ------------------------------------------------------------ */
  const master = ctx.createGain();
  master.gain.value = S.vol;
  master.connect(ctx.destination);
  S.master = master;

  /* gentle glue compressor on the music bus --------------------------- */
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 22;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.008;
  comp.release.value = 0.26;
  comp.connect(master);
  S.compressor = comp;

  const musicBus = ctx.createGain();
  musicBus.gain.value = S.musicVol;
  musicBus.connect(comp);
  S.musicBus = musicBus;

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = S.sfxVol;
  sfxBus.connect(master);
  S.sfxBus = sfxBus;

  /* convolution reverb ------------------------------------------------- */
  const conv = ctx.createConvolver();
  conv.buffer = buildImpulse(ctx, REV_SECONDS);
  const ret = ctx.createGain();
  ret.gain.value = REV_RETURN;
  conv.connect(ret);
  ret.connect(master);
  S.reverbReturn = ret;

  const send = ctx.createGain();
  send.gain.value = 1;
  send.connect(conv);
  S.reverbSend = send;

  // one shared "a touch of room" tap for the effects bus
  const sfxRev = ctx.createGain();
  sfxRev.gain.value = REV_SEND_SFX;
  sfxRev.connect(send);
  S.sfxRev = sfxRev;

  return ctx;
}

/* ========================================================================== *
 * Voice primitives — everything is enveloped with ramps, never hard-cut
 * ========================================================================== */

function dropLater(nodes, when) {
  const ctx = S.ctx;
  if (!ctx) return;
  const ms = Math.max(0, (when - ctx.currentTime) * 1000) + 160;
  later(ms, function () {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n) continue;
      try {
        n.disconnect();
      } catch (e) {
        /* already gone */
      }
    }
  });
}

/**
 * Celesta / music-box voice: a sine fundamental plus two quiet inharmonic
 * partials, fast attack, long-ish exponential decay.
 */
function voiceBell(t, freq, dur, amp, dest, rev, bright) {
  const ctx = S.ctx;
  if (!ctx || !freq) return;
  const atk = 0.008;
  const end = t + dur;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + atk);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);
  if (rev) env.connect(rev);

  const k = bright || 1;
  const partials = [
    [1, 1.0],
    [2.0, 0.22 * k],
    [2.76, 0.1 * k],
    [5.4, 0.035 * k]
  ];

  const nodes = [env];
  for (let i = 0; i < partials.length; i++) {
    const ratio = partials[i][0];
    const level = partials[i][1];
    if (level <= 0.001) continue;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    // upper partials die away faster — that is what makes it read as a bell
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * (0.45 + 0.5 / ratio));
    osc.connect(g);
    g.connect(env);
    osc.start(t);
    osc.stop(end + 0.02);
    nodes.push(osc, g);
  }
  dropLater(nodes, end);
}

/** Warm pad: two detuned sawtooths per chord tone through a low-pass. */
function voicePad(t, tones, dur, amp, dest, rev) {
  const ctx = S.ctx;
  if (!ctx || !tones || !tones.length) return;
  const atk = 0.5;
  const rel = 0.85;
  const end = t + Math.max(dur, 0.3);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1500, t);
  lp.frequency.linearRampToValueAtTime(1150, end);
  lp.Q.value = 0.35;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + atk);
  env.gain.setValueAtTime(Math.max(0.0002, amp), end);
  env.gain.linearRampToValueAtTime(0.0001, end + rel);

  lp.connect(env);
  env.connect(dest);
  if (rev) env.connect(rev);

  const nodes = [lp, env];
  const stopAt = end + rel + 0.05;
  for (let i = 0; i < tones.length; i++) {
    for (let d = 0; d < 2; d++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const detune = d === 0 ? -7 : 7;
      osc.frequency.setValueAtTime(tones[i], t);
      osc.detune.setValueAtTime(detune, t);
      osc.connect(lp);
      osc.start(t);
      osc.stop(stopAt);
      nodes.push(osc);
    }
  }
  dropLater(nodes, stopAt);
}

/** Soft triangle arpeggio pluck. */
function voicePluck(t, freq, dur, amp, dest, rev) {
  const ctx = S.ctx;
  if (!ctx || !freq) return;
  const end = t + dur;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);
  if (rev) env.connect(rev);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(1200, end);

  osc.connect(lp);
  lp.connect(env);
  osc.start(t);
  osc.stop(end + 0.02);
  dropLater([env, osc, lp], end);
}

/** Round sine/triangle bass with a short body. */
function voiceBass(t, freq, dur, amp, dest, rev) {
  const ctx = S.ctx;
  if (!ctx || !freq) return;
  const end = t + dur;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  env.connect(dest);
  if (rev) env.connect(rev);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  const sub = ctx.createOscillator();
  sub.type = 'triangle';
  sub.frequency.setValueAtTime(freq * 1.002, t);
  const subGain = ctx.createGain();
  subGain.gain.value = 0.35;
  sub.connect(subGain);
  subGain.connect(env);
  osc.connect(env);

  osc.start(t);
  sub.start(t);
  osc.stop(end + 0.03);
  sub.stop(end + 0.03);
  dropLater([env, osc, sub, subGain], end);
}

/** Brushed noise hat: a band-passed noise burst. Routed through the owning
 *  session bus so it crossfades with the rest of the arrangement. */
function voiceHat(t, amp, dur, dest) {
  const ctx = S.ctx;
  if (!ctx || !S.noise || !dest) return;
  const end = t + dur;
  const src = ctx.createBufferSource();
  src.buffer = S.noise;
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.setValueAtTime(7600, t);
  hp.Q.value = 0.9;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(hp);
  hp.connect(env);
  env.connect(dest);
  src.start(t, Math.random() * Math.max(0.01, S.noise.duration - 0.3));
  src.stop(end + 0.02);
  dropLater([src, hp, env], end);
}

/* ========================================================================== *
 * Arrangement compilation
 * ========================================================================== */

/**
 * Turn the declarative track data into a flat, beat-ordered event list.
 * One event per scheduled action, so the scheduler stays trivial.
 */
function compileTrack(track) {
  const events = [];

  let beat = 0;
  for (let i = 0; i < track.melody.length; i++) {
    const entry = track.melody[i];
    const note = entry[0];
    const dur = entry[1] || 1;
    const freq = noteToFreq(note);
    if (freq) {
      events.push({ beat: beat, kind: 'melody', freq: freq, dur: dur });
    }
    // breathe: leave a small gap before the next attack so bells do not smear
    beat += dur;
  }
  const melodyBeats = beat;

  beat = 0;
  for (let i = 0; i < track.chords.length; i++) {
    const sym = track.chords[i][0];
    const dur = track.chords[i][1] || 3;
    const tones = chordVoices(sym, 4);

    events.push({ beat: beat, kind: 'pad', tones: tones, dur: dur });
    events.push({
      beat: beat,
      kind: 'bass',
      freq: chordRootLow(sym, 3),
      dur: Math.min(dur, 2.2)
    });

    // gentle broken chord over the bar, skipping the last beat so the next
    // chord can breathe
    const arpTones = tones.concat([tones[0] * 2]);
    let step = 0;
    const steps = Math.max(0, Math.floor((dur - 0.25) / 0.75));
    for (let s = 0; s < steps; s++) {
      events.push({
        beat: beat + s * 0.75,
        kind: 'arp',
        freq: arpTones[(s + i) % arpTones.length],
        dur: 0.5
      });
      step++;
    }
    beat += dur;
  }
  const chordBeats = beat;

  if (track.hats) {
    const total = Math.max(melodyBeats, chordBeats);
    for (let b = 0; b < total; b += 1) {
      const strong = b % 4 === 0;
      events.push({
        beat: b,
        kind: 'hat',
        amp: strong ? 0.05 : 0.028,
        dur: strong ? 0.16 : 0.1
      });
    }
  }

  events.sort(function (a, b) {
    return a.beat - b.beat;
  });

  return {
    events: events,
    loopBeats: Math.max(melodyBeats, chordBeats, 1)
  };
}

/* ========================================================================== *
 * Sessions (one per playing arrangement — that is how crossfading works)
 * ========================================================================== */

function createSession(track) {
  const ctx = S.ctx;
  const out = ctx.createGain();
  out.gain.value = 0.0001;
  out.connect(S.musicBus);

  const rev = ctx.createGain();
  rev.gain.value = 0.0001;
  rev.connect(S.reverbSend);

  const compiled = compileTrack(track);

  return {
    track: track,
    events: compiled.events,
    loopBeats: compiled.loopBeats,
    spb: 60 / track.bpm, // seconds per beat
    out: out,
    rev: rev,
    cursor: 0,
    loopBase: ctx.currentTime + 0.08,
    timer: null,
    dead: false,
    fadeOutAt: 0,
    bright: track.bellColor || 1
  };
}

/**
 * Freeze a gain at its current automated value before writing new automation,
 * so a crossfade starting mid-ramp never jumps.
 */
function holdCurrent(param, when) {
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(when);
      return;
    }
  } catch (e) {
    /* older engines: fall through */
  }
  const v = Math.max(0.0001, param.value);
  param.cancelScheduledValues(when);
  param.setValueAtTime(v, when);
}

function rampUpSession(sess, seconds) {
  const ctx = S.ctx;
  const now = ctx.currentTime;
  holdCurrent(sess.out.gain, now);
  sess.out.gain.linearRampToValueAtTime(1, now + seconds);
  holdCurrent(sess.rev.gain, now);
  sess.rev.gain.linearRampToValueAtTime(REV_SEND_MUSIC, now + seconds);
}

function rampDownSession(sess, seconds) {
  const ctx = S.ctx;
  const now = ctx.currentTime;
  const end = now + seconds;
  sess.fadeOutAt = end;
  holdCurrent(sess.out.gain, now);
  sess.out.gain.linearRampToValueAtTime(0.0001, end);
  holdCurrent(sess.rev.gain, now);
  sess.rev.gain.linearRampToValueAtTime(0.0001, end);
}

function teardownSession(sess) {
  if (!sess || sess.dead) return;
  sess.dead = true;
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  later(260, function () {
    try {
      sess.out.disconnect();
    } catch (e) {
      /* noop */
    }
    try {
      sess.rev.disconnect();
    } catch (e) {
      /* noop */
    }
  });
}

/** Dispatch one compiled event at absolute time `t` (ctx clock). */
function dispatch(sess, ev, t) {
  switch (ev.kind) {
    case 'melody': {
      const dur = Math.max(0.35, Math.min(ev.dur * sess.spb * 1.35, 2.6));
      voiceBell(t, ev.freq, dur, 0.2, sess.out, sess.rev, sess.bright);
      break;
    }
    case 'pad': {
      const dur = ev.dur * sess.spb;
      voicePad(t, ev.tones, dur, 0.085, sess.out, sess.rev);
      break;
    }
    case 'bass': {
      const dur = ev.dur * sess.spb;
      voiceBass(t, ev.freq, dur, 0.16, sess.out, sess.rev);
      break;
    }
    case 'arp': {
      // a touch of humanisation keeps the arpeggio from sounding like a click track
      const jitter = (Math.random() - 0.5) * 0.006;
      voicePluck(t + jitter, ev.freq, ev.dur * sess.spb * 1.6, 0.05, sess.out, sess.rev);
      break;
    }
    case 'hat': {
      voiceHat(t, ev.amp, ev.dur, sess.out);
      break;
    }
    default:
      break;
  }
}

/* -------------------------------------------------------------------------- *
 * Look-ahead scheduler
 * -------------------------------------------------------------------------- */

function startScheduler(sess) {
  const tick = function () {
    const ctx = S.ctx;
    if (!ctx || sess.dead) return;

    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    // Recover gracefully if the tab was throttled or the clock jumped.
    if (sess.loopBase < now - 0.5) {
      sess.loopBase = now + 0.06;
      sess.cursor = 0;
    }

    let guard = 0;
    while (guard++ < 600) {
      const ev = sess.events[sess.cursor];
      if (!ev) {
        // end of the arrangement: loop it
        sess.loopBase += sess.loopBeats * sess.spb;
        sess.cursor = 0;
        const first = sess.events[0];
        if (!first) break;
        if (sess.loopBase + first.beat * sess.spb > horizon) break;
        continue;
      }
      const t = sess.loopBase + ev.beat * sess.spb;
      if (t >= horizon) break;
      if (t >= now - 0.06) {
        if (!sess.fadeOutAt || t <= sess.fadeOutAt) dispatch(sess, ev, t);
      }
      sess.cursor++;
    }

    if (sess.fadeOutAt && now >= sess.fadeOutAt) {
      teardownSession(sess);
      return;
    }
    sess.timer = setTimeout(tick, TICK_MS);
  };

  sess.timer = setTimeout(tick, 0);
}

/* ========================================================================== *
 * Sound effects (all synthesised, all routed through sfxBus + a little room)
 * ========================================================================== */

function sfxOut() {
  return { dry: S.sfxBus, wet: S.sfxRev };
}

function noiseBurst(t, dur, filterType, freqStart, freqEnd, amp, q) {
  const ctx = S.ctx;
  if (!ctx || !S.noise) return;
  const end = t + dur;
  const src = ctx.createBufferSource();
  src.buffer = S.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freqStart, t);
  if (freqEnd && freqEnd !== freqStart) {
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), end);
  }
  f.Q.value = q === undefined ? 1 : q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + Math.min(0.02, dur * 0.3));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(f);
  f.connect(env);
  env.connect(S.sfxBus);
  if (S.sfxRev) env.connect(S.sfxRev);
  src.start(t, Math.random() * Math.max(0.01, S.noise.duration - 0.5));
  src.stop(end + 0.03);
  dropLater([src, f, env], end);
}

function toneBlip(t, type, freqStart, freqEnd, dur, amp, filterHz) {
  const ctx = S.ctx;
  if (!ctx) return;
  const end = t + dur;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t);
  if (freqEnd && freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), end);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(Math.max(0.0002, amp), t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let tail = osc;
  if (filterHz) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filterHz;
    osc.connect(lp);
    tail = lp;
    tail.connect(env);
  } else {
    osc.connect(env);
  }
  env.connect(S.sfxBus);
  if (S.sfxRev) env.connect(S.sfxRev);
  osc.start(t);
  osc.stop(end + 0.03);
  dropLater([osc, env, tail], end);
}

const SFX = {
  /* a soft bell — ornament lit */
  chime: function (t) {
    const base = 1046.5 * (0.94 + Math.random() * 0.16);
    voiceBell(t, base, 1.5, 0.11, S.sfxBus, S.sfxRev, 1.15);
    voiceBell(t + 0.02, base * 1.5, 0.9, 0.035, S.sfxBus, S.sfxRev, 1.0);
  },

  /* a tiny bubble pop — hover / pin */
  pop: function (t) {
    toneBlip(t, 'sine', 780, 190, 0.09, 0.2);
    noiseBurst(t, 0.045, 'bandpass', 2400, 1200, 0.045, 2.2);
  },

  /* finger swipe / tree rotation */
  whoosh: function (t) {
    const ctx = S.ctx;
    const src = ctx.createBufferSource();
    src.buffer = S.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    const dur = 0.62;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.42);
    bp.frequency.exponentialRampToValueAtTime(520, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.14, t + 0.1);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(env);
    env.connect(S.sfxBus);
    if (S.sfxRev) env.connect(S.sfxRev);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.05);
    dropLater([src, bp, env], t + dur);
  },

  /* the star-lighting flourish: sparkle run + low boom */
  star: function (t) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093.0];
    for (let i = 0; i < notes.length; i++) {
      const at = t + i * 0.055;
      voiceBell(at, notes[i], 1.1 + i * 0.09, 0.075 - i * 0.006, S.sfxBus, S.sfxRev, 1.2);
    }
    // airy shimmer on top
    noiseBurst(t + 0.05, 1.4, 'highpass', 5200, 7200, 0.05, 0.7);
    // the boom
    const ctx = S.ctx;
    const end = t + 1.7;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.exponentialRampToValueAtTime(38, end);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.3, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env);
    env.connect(S.sfxBus);
    if (S.sfxRev) env.connect(S.sfxRev);
    osc.start(t);
    osc.stop(end + 0.05);
    dropLater([osc, env], end);
  },

  /* snow toggle — airy shimmer */
  snow: function (t) {
    noiseBurst(t, 1.15, 'highpass', 3600, 6200, 0.085, 0.6);
    noiseBurst(t + 0.06, 0.9, 'bandpass', 1800, 3200, 0.03, 1.4);
    const pings = [1568, 1976, 2349, 2637];
    for (let i = 0; i < pings.length; i++) {
      voiceBell(t + 0.05 + i * 0.11, pings[i], 0.9, 0.03, S.sfxBus, S.sfxRev, 1.25);
    }
  },

  /* camera shutter — opening a photo */
  photo: function (t) {
    noiseBurst(t, 0.05, 'bandpass', 3200, 2100, 0.16, 3.0);
    noiseBurst(t + 0.075, 0.075, 'bandpass', 1850, 1200, 0.12, 2.4);
    toneBlip(t + 0.002, 'square', 620, 240, 0.035, 0.05, 1800);
  },

  /* gentle "that gesture is not a gesture" blip */
  error: function (t) {
    toneBlip(t, 'sine', 233, 196, 0.16, 0.13, 900);
    toneBlip(t + 0.14, 'sine', 196, 165, 0.22, 0.11, 800);
  }
};

/* ========================================================================== *
 * Public API
 * ========================================================================== */

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Make sure the context is actually running, WITHOUT implicitly creating one.
 * Creating an AudioContext outside a user gesture is blocked (and warns) in
 * every modern browser, so anything that can be triggered from page code must
 * go through init() first. We only resume an existing context.
 */
function ensureRunning() {
  if (!S.inited || !S.ctx) return null;
  const ctx = S.ctx;
  if (ctx.state === 'suspended') {
    try {
      ctx.resume().catch(function () {});
    } catch (e) {
      /* noop */
    }
  }
  return ctx;
}

export const AudioEngine = {
  /* ------------------------------------------------------------------ */
  /* lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  /** Create the AudioContext (lazily). Call from a user gesture. */
  init() {
    const ctx = buildGraph();
    if (!ctx) return null;
    S.inited = true;
    if (ctx.state === 'suspended') {
      try {
        ctx.resume().catch(function () {});
      } catch (e) {
        /* noop */
      }
    }
    if (S.master) S.master.gain.value = S.vol;
    if (S.musicBus) S.musicBus.gain.value = S.musicVol;
    if (S.sfxBus) S.sfxBus.gain.value = S.sfxVol;
    return ctx;
  },

  /** Is music currently playing? */
  get started() {
    return S.started === true;
  },

  /** Start the background music (fades in over ~1.2s). */
  start() {
    if (S.started && S.session) return true;
    const ctx = ensureRunning();
    if (!ctx) {
      console.debug('[audio] start() ignored — no AudioContext yet (call init() from a gesture).');
      return false;
    }
    if (ctx.state !== 'running') {
      console.debug('[audio] start() ignored — AudioContext is ' + ctx.state + '.');
      return false;
    }
    if (S.started && (S.session || (S.userMode && S.userAudio))) return true;

    if (S.userMode && S.userTracks.length) {
      S.started = true;
      this._playUserTrack(true);
      return true;
    }

    const sess = createSession(TRACKS[S.trackIndex]);
    S.session = sess;
    S.started = true;
    rampUpSession(sess, FADE);
    startScheduler(sess);
    return true;
  },

  /** Stop the music with a click-free fade. */
  stop() {
    const sess = S.session;
    const hadUser = S.userMode && S.userAudio;
    S.started = false;
    S.session = null;
    if (!S.ctx) return false;

    if (hadUser) {
      const gain = S.userGain;
      const audio = S.userAudio;
      const now = S.ctx.currentTime;
      if (gain) {
        holdCurrent(gain.gain, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
      }
      if (S.userStopTimer) clearTimeout(S.userStopTimer);
      S.userStopTimer = setTimeout(function () {
        try { audio.pause(); } catch (e) { /* noop */ }
        S.userStopTimer = null;
      }, FADE * 1000 + 120);
      if (!sess) return true;
    }

    if (!sess) return false;
    rampDownSession(sess, FADE);
    // the session keeps scheduling during the fade, then tears itself down
    later(FADE * 1000 + 900, function () {
      teardownSession(sess);
    });
    return true;
  },

  /** Convenience for a UI button: returns the new started state. */
  toggle() {
    if (S.started) this.stop();
    else this.start();
    return S.started;
  },

  /** Stop everything and close the context. */
  dispose() {
    this._disposeUserAudio();
    const sess = S.session;
    S.session = null;
    S.started = false;
    if (sess) {
      sess.dead = true;
      if (sess.timer) clearTimeout(sess.timer);
      sess.timer = null;
      try {
        sess.out.disconnect();
      } catch (e) {
        /* noop */
      }
      try {
        sess.rev.disconnect();
      } catch (e) {
        /* noop */
      }
    }
    clearTimers();
    const ctx = S.ctx;
    S.ctx = null;
    S.inited = false;
    S.master = null;
    S.compressor = null;
    S.musicBus = null;
    S.sfxBus = null;
    S.reverbSend = null;
    S.reverbReturn = null;
    S.sfxRev = null;
    S.noise = null;
    S.failed = false;
    if (ctx) {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {
        /* already closed */
      }
    }
  },

  /* ------------------------------------------------------------------ */
  /* transport                                                          */
  /* ------------------------------------------------------------------ */

  /** Advance to the next track (custom playlist if loaded, otherwise a carol), crossfading. */
  nextTrack() {
    if (S.userMode && S.userTracks.length) {
      S.userIndex = (S.userIndex + 1) % S.userTracks.length;
      if (S.started) this._playUserTrack(true);
      return S.userIndex;
    }
    S.trackIndex = (S.trackIndex + 1) % TRACKS.length;
    if (!S.started || !S.ctx || S.ctx.state !== 'running') return S.trackIndex;

    const old = S.session;
    const sess = createSession(TRACKS[S.trackIndex]);
    S.session = sess;
    rampUpSession(sess, FADE);
    startScheduler(sess);

    if (old) {
      rampDownSession(old, FADE);
      later(FADE * 1000 + 900, function () {
        teardownSession(old);
      });
    }
    return S.trackIndex;
  },

  get trackName() {
    if (S.userMode && S.userTracks.length) return S.userTracks[S.userIndex].name;
    return TRACKS[S.trackIndex].name;
  },

  get trackIndex() {
    return S.userMode ? S.userIndex : S.trackIndex;
  },

  get trackCount() {
    return S.userMode ? S.userTracks.length : TRACKS.length;
  },

  /** True when a user-supplied playlist is currently active. */
  get isUserMode() {
    return S.userMode && S.userTracks.length > 0;
  },

  /** Names of the loaded custom tracks (for UI display). */
  get userTrackNames() {
    return S.userTracks.map(function (t) { return t.name; });
  },

  /* ------------------------------------------------------------------ */
  /* user-supplied music                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Replace the built-in carols with local audio files.
   * @param {File[]|{name:string,url:string}[]} files browser File objects, or pre-made {name,url} entries
   * @returns {number} number of tracks accepted
   */
  loadUserTracks(files) {
    const list = Array.from(files || []).filter(function (f) {
      return f && (typeof f.url === 'string' || /^audio\//.test(f.type || '') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i.test(f.name || ''));
    });
    if (!list.length) return 0;

    // tear down any previous custom playlist
    this._disposeUserAudio();
    S.userTracks = list.map(function (f, i) {
      const url = typeof f.url === 'string' ? f.url : URL.createObjectURL(f);
      let name = f.name || ('曲目 ' + (i + 1));
      name = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      return { name: name, url: url, ownUrl: typeof f.url !== 'string' };
    });
    S.userIndex = 0;
    S.userMode = true;

    // If music was playing, switch immediately to the new playlist.
    if (S.started && S.ctx && S.ctx.state === 'running') {
      this._playUserTrack(true);
    }
    return S.userTracks.length;
  },

  /** Discard the custom playlist and return to the built-in carols. */
  restoreBuiltin() {
    this._disposeUserAudio();
    S.userMode = false;
    S.userTracks = [];
    S.userIndex = 0;
    if (S.started && S.ctx && S.ctx.state === 'running') {
      // crossfade back into the current built-in track
      const old = S.session;
      const sess = createSession(TRACKS[S.trackIndex]);
      S.session = sess;
      rampUpSession(sess, FADE);
      startScheduler(sess);
      if (old) {
        rampDownSession(old, FADE);
        later(FADE * 1000 + 900, function () { teardownSession(old); });
      }
    }
  },

  /** Internal: (re)build the <audio> element graph and play the current user track. */
  _playUserTrack(crossfade) {
    const ctx = S.ctx;
    if (!ctx || !S.userTracks.length) return false;
    const track = S.userTracks[S.userIndex];

    if (!S.userAudio) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.loop = false;
      audio.preload = 'auto';
      audio.addEventListener('ended', function () {
        if (S.userMode && S.started) AudioEngine.nextTrack();
      });
      const src = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = crossfade ? 0.0001 : 1;
      src.connect(gain);
      gain.connect(S.musicBus);
      S.userAudio = audio;
      S.userSource = src;
      S.userGain = gain;
    }

    const audio = S.userAudio;
    const gain = S.userGain;
    // fade out the scheduled carol session if one is active
    const old = S.session;
    S.session = null;
    if (old) {
      rampDownSession(old, FADE);
      later(FADE * 1000 + 900, function () { teardownSession(old); });
    }

    audio.src = track.url;
    audio.load();
    const now = ctx.currentTime;
    if (crossfade) {
      holdCurrent(gain.gain, now);
      gain.gain.linearRampToValueAtTime(1, now + FADE);
    } else {
      gain.gain.setValueAtTime(1, now);
    }
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (e) { console.debug('[audio] custom track play failed', e); });
    }
    return true;
  },

  _disposeUserAudio() {
    if (S.userStopTimer) {
      clearTimeout(S.userStopTimer);
      S.userStopTimer = null;
    }
    if (S.userAudio) {
      try { S.userAudio.pause(); } catch (e) { /* noop */ }
      S.userAudio.removeAttribute('src');
      S.userAudio.load();
      S.userAudio = null;
    }
    if (S.userSource) { try { S.userSource.disconnect(); } catch (e) { /* noop */ } S.userSource = null; }
    if (S.userGain) { try { S.userGain.disconnect(); } catch (e) { /* noop */ } S.userGain = null; }
    S.userTracks.forEach(function (t) {
      if (t.ownUrl && t.url) { try { URL.revokeObjectURL(t.url); } catch (e) { /* noop */ } }
    });
    S.userTracks = [];
  },

  /* ------------------------------------------------------------------ */
  /* levels                                                             */
  /* ------------------------------------------------------------------ */

  setVolume(v) {
    S.vol = clamp01(v);
    if (S.ctx && S.master) {
      const now = S.ctx.currentTime;
      S.master.gain.cancelScheduledValues(now);
      S.master.gain.setTargetAtTime(S.vol, now, 0.06);
    }
    return S.vol;
  },

  get volume() {
    return S.vol;
  },

  setMusicVolume(v) {
    S.musicVol = clamp01(v);
    if (S.ctx && S.musicBus) {
      const now = S.ctx.currentTime;
      S.musicBus.gain.cancelScheduledValues(now);
      S.musicBus.gain.setTargetAtTime(S.musicVol, now, 0.06);
    }
    return S.musicVol;
  },

  get musicVolume() {
    return S.musicVol;
  },

  setSfxVolume(v) {
    S.sfxVol = clamp01(v);
    if (S.ctx && S.sfxBus) {
      const now = S.ctx.currentTime;
      S.sfxBus.gain.cancelScheduledValues(now);
      S.sfxBus.gain.setTargetAtTime(S.sfxVol, now, 0.06);
    }
    return S.sfxVol;
  },

  get sfxVolume() {
    return S.sfxVol;
  },

  /* ------------------------------------------------------------------ */
  /* effects                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Fire a one-shot effect.
   * @param {string} name chime | pop | whoosh | star | snow | photo | error
   */
  sfx(name) {
    const fn = SFX[name];
    if (!fn) {
      console.debug('[audio] unknown sfx: ' + name);
      return false;
    }
    const ctx = ensureRunning();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      console.debug('[audio] sfx("' + name + '") ignored — AudioContext is ' + ctx.state + '.');
      return false;
    }
    try {
      fn(Math.max(ctx.currentTime, 0) + 0.001);
      return true;
    } catch (e) {
      console.debug('[audio] sfx failed', e);
      return false;
    }
  },

  /** Names of every available effect. */
  get sfxNames() {
    return Object.keys(SFX);
  },

  /* ------------------------------------------------------------------ */
  /* low level helper                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Play a single bell note. Handy for custom flourishes.
   * @param {number} freq Hz
   * @param {number} dur  seconds
   * @param {object} [opts] { amp, bus: 'music'|'sfx', bright, when }
   */
  playNote(freq, dur, opts) {
    const ctx = ensureRunning();
    if (!ctx || ctx.state !== 'running') return false;
    const o = opts || {};
    const dest = o.bus === 'sfx' ? S.sfxBus : S.musicBus;
    const rev = o.bus === 'sfx' ? S.sfxRev : (S.session ? S.session.rev : null);
    if (!dest) return false;
    const when = o.when ? ctx.currentTime + o.when : ctx.currentTime + 0.001;
    voiceBell(when, freq, Math.max(0.05, dur || 0.6), o.amp === undefined ? 0.12 : o.amp, dest, rev, o.bright || 1);
    return true;
  }
};

export default AudioEngine;
