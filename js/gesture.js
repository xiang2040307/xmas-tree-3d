/**
 * gesture.js — hand-gesture input module (MediaPipe Tasks Vision HandLandmarker).
 *
 * Self-contained ES module. No imports from other project files, no top-level
 * side effects: importing this file is safe in Node (no navigator / document).
 *
 * Export: `GestureEngine` singleton.
 *
 *   GestureEngine.supported        -> bool
 *   GestureEngine.enabled          -> bool
 *   GestureEngine.pointer          -> last payload | null
 *   await GestureEngine.init({ video?, onFrame?, onStatus? })
 *   await GestureEngine.start()
 *   GestureEngine.stop()
 *   GestureEngine.onFrame(cb)      cb(payload)
 *   GestureEngine.onGesture(cb)    cb({ name, hand })
 *   GestureEngine.setMirror(bool)  default true (selfie)
 *   GestureEngine.setShowOverlay() no-op, stored for compatibility
 *   GestureEngine.dispose()
 *
 * payload (emitted at <= ~30fps):
 *   { x, y, px, py, pinch, hand, gesture, moved, pinchEdge, gestureEdge,
 *     handCount, twoHandSpan }
 *   handCount === 2 means both hands are visible; twoHandSpan (0..1) is the
 *   normalized palm-to-palm distance, used for two-hand zoom (spread = grow).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Relative URLs resolved against this module (js/ -> ../vendor/...). */
const URL_BUNDLE = '../vendor/mediapipe/vision_bundle.mjs';
const URL_WASM_DIR = '../vendor/mediapipe/wasm';
const URL_MODEL = '../vendor/mediapipe/models/hand_landmarker.task';

/** Cursor smoothing / mapping. */
const EMA_CURSOR = 0.35;
const DEADZONE = 0.012; // in -1..1 cursor space
const CURSOR_GAIN = 1.25; // slight gain so users need not reach frame edges
const MOVE_EPSILON = 0.004;

/** Pinch strength smoothing + hysteresis. */
const EMA_PINCH = 0.5;
const PINCH_DOWN = 0.75;
const PINCH_UP = 0.55;

/** Gesture stabilization window. */
const STABILIZE_MS = 180;

/** Detection throttle (~30fps). */
const MIN_FRAME_MS = 1000 / 30 - 1;

/** Finger extension ratio thresholds (tip distance from wrist / pip distance). */
const EXT_RATIO = 1.15;
const THUMB_RATIO = 1.15;

/** Camera constraints. */
const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 640 },
  height: { ideal: 480 },
};

// Hand landmark indices (MediaPipe canonical 21-point layout).
const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

// ---------------------------------------------------------------------------
// Small helpers (no browser globals touched)
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const dist2d = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const hasDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

let status = 'idle';
let mirror = true;
let showOverlay = false;

let videoEl = null;
let ownsVideoEl = false;
let stream = null;
let landmarker = null;
let visionNs = null;
let loadingPromise = null;

let frameCb = null;
let gestureCb = null;
let statusCb = null;

let running = false;
let busy = false;
let rafId = 0;
let vfcId = 0;
let lastProcessTs = 0;
let lastDetectTs = 0;
let disposed = false;

// Smoothing / tracking state.
let emaX = 0.5;
let emaY = 0.5;
let hasCursor = false;
let emaPinch = 0;
let lastEmitX = 0;
let lastEmitY = 0;
let pinchEngaged = false;
let lastHand = 0;

// Gesture stabilization state.
let candidate = 'none';
let candidateSince = 0;
let stableGesture = 'none';

// Two-hand zoom state. When both palms are visible, the distance between them
// drives `twoHandSpan` (0..1). main.js watches `handCount === 2` + this value.
let twoHandSpan = 0;
let twoHandSpanActive = false;

// Reusable payload (avoid per-frame allocation).
const payload = {
  x: 0,
  y: 0,
  px: 0.5,
  py: 0.5,
  pinch: 0,
  hand: 0,
  gesture: 'none',
  moved: false,
  pinchEdge: null,
  gestureEdge: null,
  handCount: 0,
  twoHandSpan: 0,
};

// ---------------------------------------------------------------------------
// Status reporting
// ---------------------------------------------------------------------------

function emitStatus(phase, message) {
  status = phase;
  if (!statusCb) return;
  try {
    statusCb({ phase, message });
  } catch (err) {
    // A throwing UI callback must never break the loop.
    if (typeof console !== 'undefined') console.warn('[gesture] onStatus threw:', err);
  }
}

function stoppedMessage() {
  return '手势控制已关闭，使用鼠标/触摸';
}

// ---------------------------------------------------------------------------
// Video element management
// ---------------------------------------------------------------------------

function ensureVideoElement(provided) {
  if (provided) {
    videoEl = provided;
    ownsVideoEl = false;
    try {
      videoEl.playsInline = true;
      videoEl.muted = true;
      videoEl.autoplay = true;
    } catch {
      /* ignore */
    }
    return videoEl;
  }

  // Reuse whatever we already have (caller-provided or self-created) so that
  // start() never swaps out a <video> the caller passed to init().
  if (videoEl) return videoEl;

  const el = document.createElement('video');
  el.playsInline = true;
  el.muted = true;
  el.autoplay = true;
  el.setAttribute('playsinline', '');
  el.setAttribute('muted', '');
  el.setAttribute('autoplay', '');
  // Fully hidden but still decodable (display:none can pause decoding in some
  // browsers, so keep it out of flow and 1px instead).
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);

  videoEl = el;
  ownsVideoEl = true;
  return el;
}

function releaseVideoElement() {
  if (!videoEl) return;
  try {
    videoEl.pause();
  } catch {
    /* ignore */
  }
  try {
    videoEl.srcObject = null;
  } catch {
    /* ignore */
  }
  if (ownsVideoEl) {
    try {
      videoEl.remove();
    } catch {
      /* ignore */
    }
  }
  videoEl = null;
  ownsVideoEl = false;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function describeCameraError(err) {
  const name = err && err.name ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝，已回退到鼠标/触摸';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有找到摄像头，已回退到鼠标/触摸';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '摄像头被其他程序占用，已回退到鼠标/触摸';
  }
  if (name === 'OverconstrainedError') {
    return '摄像头不支持所需分辨率，已回退到鼠标/触摸';
  }
  return '摄像头不可用，已回退到鼠标/触摸';
}

async function openCamera() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia unsupported'), { name: 'NotSupportedError' });
  }
  return navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
}

// ---------------------------------------------------------------------------
// MediaPipe loading
// ---------------------------------------------------------------------------

async function createLandmarker(basePath) {
  const { HandLandmarker } = visionNs;
  const vision = await visionNs.FilesetResolver.forVisionTasks(basePath);
  const modelAssetPath = new URL(URL_MODEL, import.meta.url).href;

  const common = {
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, {
      ...common,
      baseOptions: { modelAssetPath, delegate: 'GPU' },
    });
  } catch (gpuErr) {
    if (typeof console !== 'undefined') {
      console.warn('[gesture] GPU delegate unavailable, falling back to CPU:', gpuErr);
    }
    return HandLandmarker.createFromOptions(vision, {
      ...common,
      baseOptions: { modelAssetPath, delegate: 'CPU' },
    });
  }
}

async function loadMediaPipe() {
  if (landmarker) return landmarker;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const bundleHref = new URL(URL_BUNDLE, import.meta.url).href;
    // NOTE: no trailing slash — the bundle builds `${base}/vision_wasm_internal.js`.
    const wasmBase = new URL(URL_WASM_DIR, import.meta.url).href.replace(/\/+$/, '');

    visionNs = await import(bundleHref);
    landmarker = await createLandmarker(wasmBase);
    return landmarker;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Per-frame geometry -> payload
// ---------------------------------------------------------------------------

function classify(lm, extFlags, pinch) {
  const [thumb, index, middle, ring, pinky] = extFlags;
  const count = (thumb ? 1 : 0) + (index ? 1 : 0) + (middle ? 1 : 0) + (ring ? 1 : 0) + (pinky ? 1 : 0);

  // Order matters: in a real fist the thumb tip often rests against the index
  // tip, which reads as a very high pinch value. Check curl first so a fist
  // stays a fist, and only accept "pinch" when the index is actually out.
  if (count <= 1) return 'fist';
  if (pinch > PINCH_DOWN && index) return 'pinch';
  // 三指（食中无伸、小指弯）：切换照片显示
  if (index && middle && ring && !pinky) return 'three';
  if (count >= 4) return 'open';
  if (index && !middle && !ring && !pinky) return 'point';
  if (index && middle && !ring && !pinky) return 'victory';
  return 'none';
}

/** Palm center in normalized image space (wrist + four MCP joints). */
function palmCenter(lm) {
  return {
    x: (lm[WRIST].x + lm[INDEX_MCP].x + lm[MIDDLE_MCP].x + lm[RING_MCP].x + lm[PINKY_MCP].x) / 5,
    y: (lm[WRIST].y + lm[INDEX_MCP].y + lm[MIDDLE_MCP].y + lm[RING_MCP].y + lm[PINKY_MCP].y) / 5,
  };
}

function computeExtended(lm) {
  const wrist = lm[WRIST];
  const ratio = (tipIdx, pipIdx) => {
    const pipD = dist2d(wrist, lm[pipIdx]);
    if (pipD < 1e-6) return 0;
    return dist2d(wrist, lm[tipIdx]) / pipD;
  };

  const thumbMcpD = dist2d(wrist, lm[THUMB_MCP]);
  const thumbExtended = thumbMcpD > 1e-6 && dist2d(wrist, lm[THUMB_TIP]) / thumbMcpD > THUMB_RATIO;

  return [
    thumbExtended,
    ratio(INDEX_TIP, INDEX_PIP) > EXT_RATIO,
    ratio(MIDDLE_TIP, MIDDLE_PIP) > EXT_RATIO,
    ratio(RING_TIP, RING_PIP) > EXT_RATIO,
    ratio(PINKY_TIP, PINKY_PIP) > EXT_RATIO,
  ];
}

function processLandmarks(lm, now) {
  // --- palm center: wrist + the four MCP joints -------------------------
  const rawX = (lm[WRIST].x + lm[INDEX_MCP].x + lm[MIDDLE_MCP].x + lm[RING_MCP].x + lm[PINKY_MCP].x) / 5;
  const rawY = (lm[WRIST].y + lm[INDEX_MCP].y + lm[MIDDLE_MCP].y + lm[RING_MCP].y + lm[PINKY_MCP].y) / 5;

  // Mirror for selfie view, then map 0..1 -> -1..1 with gain.
  const mx = mirror ? 1 - rawX : rawX;
  const targetX = mx;
  const targetY = rawY;

  if (!hasCursor) {
    emaX = targetX;
    emaY = targetY;
    hasCursor = true;
  } else {
    emaX += (targetX - emaX) * EMA_CURSOR;
    emaY += (targetY - emaY) * EMA_CURSOR;
  }

  // Deadzone in -1..1 space around the mapped value.
  let nx = (emaX - 0.5) * 2 * CURSOR_GAIN;
  let ny = -(emaY - 0.5) * 2 * CURSOR_GAIN;
  if (Math.abs(nx) < DEADZONE) nx = 0;
  if (Math.abs(ny) < DEADZONE) ny = 0;
  nx = clamp(nx, -1, 1);
  ny = clamp(ny, -1, 1);

  // --- pinch ------------------------------------------------------------
  const handScale = Math.max(dist2d(lm[WRIST], lm[MIDDLE_MCP]), 1e-4);
  const pinchRaw = 1 - clamp(dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / (handScale * 1.2), 0, 1);
  emaPinch += (pinchRaw - emaPinch) * EMA_PINCH;

  // --- fingers / gesture ------------------------------------------------
  const extFlags = computeExtended(lm);
  const gesture = classify(lm, extFlags, emaPinch);

  // --- stabilization ----------------------------------------------------
  let gestureEdge = null;
  if (gesture !== candidate) {
    candidate = gesture;
    candidateSince = now;
  } else if (gesture !== stableGesture && now - candidateSince >= STABILIZE_MS) {
    stableGesture = gesture;
    if (gesture !== 'none') gestureEdge = gesture;
  }

  // --- pinch hysteresis -------------------------------------------------
  let pinchEdge = null;
  if (!pinchEngaged && emaPinch >= PINCH_DOWN) {
    pinchEngaged = true;
    pinchEdge = 'down';
  } else if (pinchEngaged && emaPinch <= PINCH_UP) {
    pinchEngaged = false;
    pinchEdge = 'up';
  }

  // --- payload ----------------------------------------------------------
  const moved = Math.abs(nx - lastEmitX) + Math.abs(ny - lastEmitY) > MOVE_EPSILON;
  lastEmitX = nx;
  lastEmitY = ny;

  payload.x = nx;
  payload.y = ny;
  payload.px = (nx + 1) * 0.5;
  payload.py = (1 - ny) * 0.5;
  payload.pinch = emaPinch;
  payload.hand = lastHand;
  payload.gesture = stableGesture;
  payload.moved = moved;
  payload.pinchEdge = pinchEdge;
  payload.gestureEdge = gestureEdge;

  return payload;
}

function resetTracking() {
  hasCursor = false;
  emaPinch = 0;
  pinchEngaged = false;
  lastHand = 0;
  candidate = 'none';
  candidateSince = 0;
  stableGesture = 'none';
  twoHandSpanActive = false;
  twoHandSpan = 0;
}

// ---------------------------------------------------------------------------
// Detection loop
// ---------------------------------------------------------------------------

function handleResult(result, now) {
  const hands = result && result.landmarks;
  if (!hands || hands.length === 0) {
    // No hand this frame. Still emit so the UI can hide the cursor; reset the
    // trackers so the next hand appearance snaps instead of interpolating
    // across the gap.
    lastHand = 0;
    resetTracking();

    payload.gesture = 'none';
    payload.hand = 0;
    payload.moved = false;
    payload.pinchEdge = null;
    payload.gestureEdge = null;
    payload.pinch = 0;
    payload.handCount = 0;
    twoHandSpanActive = false;
    payload.twoHandSpan = 0;

    if (frameCb) {
      try {
        frameCb(payload);
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[gesture] onFrame threw:', err);
      }
    }
    return;
  }

  // --- two hands visible: drive continuous zoom span ---------------------
  if (hands.length >= 2) {
    const a = palmCenter(hands[0]);
    const b = palmCenter(hands[1]);
    // Image-space distance between the two palms, normalized by frame diagonal.
    // 0.08 (hands close) -> 0, 0.75 (hands wide apart) -> 1.
    const d = dist2d(a, b);
    const span = clamp((d - 0.08) / 0.67, 0, 1);

    twoHandSpanActive = true;
    twoHandSpan = span;
    payload.handCount = hands.length;
    payload.twoHandSpan = span;

    // Cursor follows the midpoint of the two hands (keeps hover working).
    const mx = mirror ? 1 - (a.x + b.x) / 2 : (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (!hasCursor) { emaX = mx; emaY = my; hasCursor = true; }
    else { emaX += (mx - emaX) * EMA_CURSOR; emaY += (my - emaY) * EMA_CURSOR; }
    payload.x = clamp((emaX - 0.5) * 2 * CURSOR_GAIN, -1, 1);
    payload.y = clamp(-(emaY - 0.5) * 2 * CURSOR_GAIN, -1, 1);
    payload.px = (payload.x + 1) * 0.5;
    payload.py = (1 - payload.y) * 0.5;
    payload.hand = 0; // suppress single-hand click/click-drag while zooming
    payload.pinch = 0;
    payload.pinchEdge = null;
    payload.gestureEdge = null;
    payload.moved = false;

    if (frameCb) {
      try { frameCb(payload); } catch (err) { if (typeof console !== 'undefined') console.warn('[gesture] onFrame threw:', err); }
    }
    return;
  }

  twoHandSpanActive = false;
  twoHandSpan = 0;
  payload.handCount = 1;
  payload.twoHandSpan = 0;

  const lm = hands[0];

  // Handedness label: 1 = left, 2 = right (MediaPipe image-space label).
  let hand = 0;
  const handedness = result.handednesses || result.handedness;
  if (handedness && handedness[0] && handedness[0][0]) {
    const label = String(handedness[0][0].categoryName || '').toLowerCase();
    hand = label === 'left' ? 1 : label === 'right' ? 2 : 0;
  }
  lastHand = hand;

  const out = processLandmarks(lm, now);

  if (frameCb) {
    try {
      frameCb(out);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[gesture] onFrame threw:', err);
    }
  }
  if (out.gestureEdge && gestureCb) {
    try {
      gestureCb({ name: out.gestureEdge, hand: out.hand });
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[gesture] onGesture threw:', err);
    }
  }
}

async function detectOnce() {
  if (!landmarker || !videoEl || busy) return;
  if (videoEl.readyState < 2) return;

  const now = performance.now();
  if (now - lastProcessTs < MIN_FRAME_MS) return;
  lastProcessTs = now;

  // MediaPipe requires strictly increasing timestamps.
  let ts = now;
  if (ts <= lastDetectTs) ts = lastDetectTs + 1;
  lastDetectTs = ts;

  busy = true;
  try {
    const result = landmarker.detectForVideo(videoEl, ts);
    handleResult(result, now);
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[gesture] detect failed:', err);
  } finally {
    busy = false;
  }
}

function scheduleNext() {
  if (!running || disposed) return;
  const v = videoEl;
  if (v && typeof v.requestVideoFrameCallback === 'function') {
    vfcId = v.requestVideoFrameCallback(() => {
      vfcId = 0;
      detectOnce().finally(scheduleNext);
    });
  } else if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      detectOnce().finally(scheduleNext);
    });
  }
}

function cancelLoop() {
  const v = videoEl;
  if (vfcId && v && typeof v.cancelVideoFrameCallback === 'function') {
    try {
      v.cancelVideoFrameCallback(vfcId);
    } catch {
      /* ignore */
    }
  }
  vfcId = 0;
  if (rafId && typeof cancelAnimationFrame === 'function') {
    try {
      cancelAnimationFrame(rafId);
    } catch {
      /* ignore */
    }
  }
  rafId = 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shared stop logic. `announce` controls whether a 'stopped' status is emitted
 * (suppressed on the error path so the user sees one message, not two).
 */
function teardown(announce) {
  running = false;
  busy = false;
  cancelLoop();

  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    stream = null;
  }
  if (videoEl) {
    try {
      videoEl.pause();
    } catch {
      /* ignore */
    }
    try {
      videoEl.srcObject = null;
    } catch {
      /* ignore */
    }
  }

  resetTracking();
  payload.gesture = 'none';
  payload.hand = 0;
  payload.moved = false;
  payload.pinch = 0;
  payload.pinchEdge = null;
  payload.gestureEdge = null;
  payload.handCount = 0;
  payload.twoHandSpan = 0;

  if (announce && status !== 'error') emitStatus('stopped', stoppedMessage());
}

export const GestureEngine = {
  get enabled() {
    return running;
  },

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  },

  get status() {
    return status;
  },

  get mirror() {
    return mirror;
  },

  get pointer() {
    return hasCursor ? payload : null;
  },

  /**
   * Load the model and prepare the video element. Never throws.
   * @param {{video?: HTMLVideoElement, onFrame?: Function, onStatus?: Function}} [opts]
   */
  async init(opts = {}) {
    const { video, onFrame: onFrameCb, onStatus: onStatusCb } = opts || {};
    if (onStatusCb) statusCb = onStatusCb;
    if (onFrameCb) frameCb = onFrameCb;

    if (disposed) {
      emitStatus('error', '手势模块已销毁');
      return false;
    }

    if (landmarker) {
      if (video) ensureVideoElement(video);
      emitStatus('ready', '手势就绪：移动光标 · 单手捏合点击 · 双手开合调树大小');
      return true;
    }

    if (!this.supported || !hasDOM()) {
      emitStatus('error', '当前浏览器不支持摄像头手势，已回退到鼠标/触摸');
      return false;
    }

    emitStatus('loading', '正在加载手势模型…');

    try {
      ensureVideoElement(video);
      await loadMediaPipe();
      emitStatus('ready', '手势就绪：移动光标 · 单手捏合点击 · 双手开合调树大小');
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[gesture] model load failed:', err);
      landmarker = null;
      emitStatus('error', '手势模型加载失败，已回退到鼠标/触摸');
      return false;
    }
  },

  /** Start camera + detection loop. Idempotent. Never throws. */
  async start() {
    if (running) return true;
    if (disposed) return false;

    if (!hasDOM()) {
      emitStatus('error', '当前环境不支持摄像头手势');
      return false;
    }

    try {
      if (!landmarker) {
        const ok = await this.init({});
        if (!ok) return false;
      }
      if (!videoEl) ensureVideoElement(null);

      if (!stream) {
        stream = await openCamera();
      }
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      try {
        await videoEl.play();
      } catch {
        // Some browsers reject play() without a gesture; the loop below still
        // works once frames arrive.
      }

      resetTracking();
      running = true;
      busy = false;
      lastProcessTs = 0;
      lastDetectTs = 0;
      emitStatus('ready', '手势就绪：移动光标 · 单手捏合点击 · 双手开合调树大小');
      scheduleNext();
      return true;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[gesture] camera start failed:', err);
      // Release the camera but stay silent about 'stopped' so the user gets
      // exactly one message: the reason we are falling back.
      teardown(false);
      emitStatus('error', describeCameraError(err));
      return false;
    }
  },

  /** Stop camera + loop, release every track. Idempotent. Never throws. */
  stop() {
    teardown(true);
    return true;
  },

  /** Set (or clear with no arg) the per-frame callback. */
  onFrame(cb) {
    frameCb = typeof cb === 'function' ? cb : null;
    return this;
  },

  /** Set (or clear) the stabilized-gesture callback. */
  onGesture(cb) {
    gestureCb = typeof cb === 'function' ? cb : null;
    return this;
  },

  setShowOverlay(value) {
    showOverlay = !!value;
    return showOverlay;
  },

  get showOverlay() {
    return showOverlay;
  },

  /** Mirror horizontally (selfie). Default true. */
  setMirror(value) {
    mirror = !!value;
    return mirror;
  },

  /** Full teardown. Safe to call repeatedly. */
  dispose() {
    try {
      this.stop();
    } catch {
      /* ignore */
    }
    disposed = true;
    running = false;
    cancelLoop();
    releaseVideoElement();

    if (landmarker && typeof landmarker.close === 'function') {
      try {
        landmarker.close();
      } catch {
        /* ignore */
      }
    }
    landmarker = null;
    visionNs = null;
    loadingPromise = null;
    frameCb = null;
    gestureCb = null;
    statusCb = null;
    hasCursor = false;
    status = 'idle';
    return true;
  },
};

export default GestureEngine;
