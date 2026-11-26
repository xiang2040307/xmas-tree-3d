/* =====================================================================
   main.js · 组装、相机、交互、后处理、UI
   ===================================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildTree, TREE } from './tree.js';
import { buildPhotos } from './photos.js';
import { buildSky, buildStarfield, buildGround, buildSnow, buildHorizon, buildAurora } from './scenes.js';
import { buildFireworks } from './fireworks.js';
import { createWishSystem } from './wishes.js';
import { AudioEngine } from './audio.js';

/* ------------------------------------------------------------------ */
/* DOM                                                                */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const loaderEl = $('loader');
const loaderBar = $('loader-bar-fill');
const loaderTip = $('loader-tip');
const toastEl = $('toast');
const panelEl = $('panel');
const lightboxEl = $('lightbox');
const lbImg = $('lb-img');
const lbCap = $('lb-cap');
const wishModal = $('wish-modal');
const wishInput = $('wish-input');
const fileInput = $('file-input');
const camVideo = $('cam');
const palmCursor = $('palm-cursor');
const gestureStateEl = $('gesture-state');
const musicTrackEl = $('music-track');
const fpsEl = $('fps');
const hintEl = $('hint');

const setProgress = (p, tip) => {
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  if (tip) loaderTip.textContent = tip;
};

/* 调试开关：?nobloom=1 关闭辉光，?debug=1 输出场景信息 */
const QS = new URLSearchParams(location.search);
const DEBUG_NOBLOOM = QS.get('nobloom') === '1';
const DEBUG_MODE = QS.get('debug') === '1';
/* ?pipetest=1: 只走 composer，不渲染场景，用纯色验证管线 */
const PIPE_TEST = QS.get('pipetest') === '1';
const BLOOM_OFF = QS.get('bloom') === '0';

/* ------------------------------------------------------------------ */
/* Toast / 小工具 */
/* ------------------------------------------------------------------ */
let toastTimer = 0;
function toast(msg, ms = 2400) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ------------------------------------------------------------------ */
/* 渲染器 */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  stencil: false,
  preserveDrawingBuffer: false,
});
renderer.setClearColor(0x03060d, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050a14, 0.0125);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
const CAM = {
  target: new THREE.Vector3(0, TREE.height * 0.46, 0),
  dist: 13.8,
  distMin: 5.2,
  distMax: 26,
  azimuth: -0.42,
  polar: 1.30,
  polarMin: 0.42,
  polarMax: 1.60,
  // 目标值（阻尼跟随）
  tAzimuth: -0.42,
  tPolar: 1.30,
  tDist: 13.8,
  autoRotate: true,
  autoSpeed: 0.055,
  userActive: 0,
};

/* 程序化的"呼吸"视角微动 */
let camBreath = 0;

/* ------------------------------------------------------------------ */
/* 后处理 */
/* ------------------------------------------------------------------ */
let composer, bloomPass, renderPass;
const BLOOM = {
  strength: Number(QS.get('bs') ?? 0.42),
  radius: Number(QS.get('br') ?? 0.55),
  threshold: Number(QS.get('bt') ?? 0.82),
};

function setupComposer() {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(DPR);
  composer.setSize(size.x, size.y);

  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  if (!BLOOM_OFF) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    composer.addPass(bloomPass);
  }

  composer.addPass(new OutputPass());
}

/* ------------------------------------------------------------------ */
/* 场景装配                                                           */
/* ------------------------------------------------------------------ */
let tree, photos, wishes, sky, starfield, ground, snow, horizon, aurora, fireworks;
let folderImages = [];

/** 读取 photos/ 目录里的图片，作为相框照片（没有则用内置冬日场景） */
async function loadFolderPhotos() {
  try {
    const res = await fetch('/api/photos', { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return [];
    const loaded = await Promise.all(list.map((p) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = p.url;
    })));
    const imgs = loaded.filter(Boolean);
    if (imgs.length) console.log(`[photos] 已载入 photos/ 目录的 ${imgs.length} 张照片`);
    return imgs;
  } catch (e) {
    console.debug('[photos] 无 photos/ 目录或读取失败，使用内置照片', e);
    return [];
  }
}

function buildWorld() {
  sky = buildSky();
  scene.add(sky.mesh);

  aurora = buildAurora();
  scene.add(aurora.group);

  starfield = buildStarfield(2600);
  scene.add(starfield.mesh);

  horizon = buildHorizon();
  scene.add(horizon.group);

  ground = buildGround(15);
  scene.add(ground.mesh);

  tree = buildTree();
  scene.add(tree.group);

  photos = buildPhotos({ treeHeight: TREE.height, treeRadius: TREE.baseRadius, count: 7, images: folderImages });
  tree.group.add(photos.group);

  wishes = createWishSystem({ treeHeight: TREE.height, treeRadius: TREE.baseRadius });
  scene.add(wishes.group);

  snow = buildSnow({ count: 5200, radius: 16, height: 24 });
  scene.add(snow.mesh);

  fireworks = buildFireworks();
  scene.add(fireworks.points);

  applySizing();
}

/* 视口相关尺寸（点大小与像素比） */
function applySizing() {
  if (!tree) return;
  const h = renderer.getSize(new THREE.Vector2()).y;
  const vf = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const pr = renderer.getPixelRatio();
  tree.setViewFactor(vf);
  tree.setPixelRatio(pr);
  starfield.setPixelRatio(pr);
  snow.setPixelRatio(pr);
  snow.setViewFactor(vf);
  fireworks.setPixelRatio(pr);
  fireworks.setViewFactor(vf);
}

/* ------------------------------------------------------------------ */
/* 相机控制（自写轨道控制）                                            */
/* ------------------------------------------------------------------ */
function applyCamera() {
  const p = CAM.polar;
  const a = CAM.azimuth;
  const d = CAM.dist;
  camera.position.set(
    CAM.target.x + Math.sin(p) * Math.sin(a) * d,
    CAM.target.y + Math.cos(p) * d,
    CAM.target.z + Math.sin(p) * Math.cos(a) * d
  );
  camera.lookAt(CAM.target);
}

function updateCamera(dt) {
  // 空闲自动旋转
  CAM.userActive = Math.max(0, CAM.userActive - dt);
  if (CAM.autoRotate && CAM.userActive <= 0.001 && !dragging) {
    CAM.tAzimuth += CAM.autoSpeed * dt;
    CAM.azimuth += CAM.autoSpeed * dt * 0.55;
  }

  CAM.azimuth = damp(CAM.azimuth, CAM.tAzimuth, 7, dt);
  CAM.polar = damp(CAM.polar, CAM.tPolar, 7, dt);
  CAM.dist = damp(CAM.dist, CAM.tDist, 6, dt);

  // 呼吸镜位
  camBreath += dt;
  const bx = Math.sin(camBreath * 0.34) * 0.09;
  const by = Math.sin(camBreath * 0.27 + 1.1) * 0.07;
  CAM.target.x = bx;
  CAM.target.y = TREE.height * 0.46 + by;

  applyCamera();
}

/* ------------------------------------------------------------------ */
/* 交互：拖拽 / 滚轮 / 捏合 */
/* ------------------------------------------------------------------ */
let dragging = false;
let lastX = 0, lastY = 0;
let moved = 0;
const pointers = new Map();
let pinchStartDist = 0;
let pinchStartCamDist = 0;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hoverKind = null;
let hoverPhoto = -1;

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    dragging = true;
    moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('dragging');
    CAM.userActive = 2.2;
    hintEl.classList.add('gone');
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartCamDist = CAM.tDist;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev) { prev.x = e.clientX; prev.y = e.clientY; }

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStartDist > 0) {
      const k = pinchStartDist / d;
      CAM.tDist = clamp(pinchStartCamDist * k, CAM.distMin, CAM.distMax);
    }
    return;
  }

  if (dragging && pointers.size === 1) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    CAM.tAzimuth -= dx * 0.0055;
    CAM.tPolar = clamp(CAM.tPolar - dy * 0.0042, CAM.polarMin, CAM.polarMax);
    CAM.userActive = 2.2;
    return;
  }

  // 悬停检测
  updateRaycast(e.clientX, e.clientY);
});

window.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    canvas.classList.remove('dragging');
    if (dragging && moved < 8) {
      handleClick(e.clientX, e.clientY);
    }
    dragging = false;
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  CAM.tDist = clamp(CAM.tDist + e.deltaY * 0.006, CAM.distMin, CAM.distMax);
  CAM.userActive = 1.4;
}, { passive: false });

/* 触摸：防止页面滚动 */
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

/* ------------------------------------------------------------------ */
/* 射线拾取                                                           */
/* ------------------------------------------------------------------ */
const inspectList = []; // 供 handleClick / hover 复用

function updateRaycast(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  // 照片优先
  const photoHits = raycaster.intersectObjects(photos.hitList, false);
  if (photoHits.length) {
    const idx = photoHits[0].object.userData.photoIndex;
    if (hoverPhoto !== idx) {
      photos.setHover(hoverPhoto, false);
      photos.setHover(idx, true);
      hoverPhoto = idx;
      hoverKind = 'photo';
      canvas.classList.add('pointing');
    }
    return;
  }
  if (hoverPhoto >= 0) {
    photos.setHover(hoverPhoto, false);
    hoverPhoto = -1;
  }

  // 挂饰
  const ornHits = raycaster.intersectObject(tree.hitMesh, false);
  if (ornHits.length) {
    hoverKind = 'ornament';
    canvas.classList.add('pointing');
  } else {
    hoverKind = null;
    canvas.classList.remove('pointing');
  }
}

function handleClick(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const photoHits = raycaster.intersectObjects(photos.hitList, false);
  if (photoHits.length) {
    openPhoto(photoHits[0].object.userData.photoIndex);
    return true;
  }

  const ornHits = raycaster.intersectObject(tree.hitMesh, false);
  if (ornHits.length && ornHits[0].instanceId !== undefined) {
    flashOrnament(ornHits[0].instanceId, ornHits[0].point);
    return true;
  }
  return false;
}

/* 点亮一个挂饰：扩散光波 + 音效 */
const bursts = [];
function flashOrnament(i, point) {
  AudioEngine.sfx('chime');
  const d = tree.ornData[i];
  if (!d) return;
  d.hover = 1;
  const mat = new THREE.SpriteMaterial({
    map: glowTex, color: d.color.clone().lerp(new THREE.Color(0xffffff), 0.5),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(d.base);
  sp.scale.setScalar(0.4);
  sp.renderOrder = 40;
  tree.group.add(sp);
  bursts.push({ sp, mat, t: 0, life: 0.95 });

  // 冲击波环
  const ringMat = new THREE.MeshBasicMaterial({
    color: d.color, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 40), ringMat);
  ring.position.copy(d.base);
  ring.lookAt(camera.position);
  ring.renderOrder = 41;
  tree.group.add(ring);
  bursts.push({ sp: ring, mat: ringMat, t: 0, life: 0.8, isRing: true });

  setTimeout(() => { d.hover = 0; }, 900);
}

function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.t += dt;
    const k = b.t / b.life;
    if (k >= 1) {
      tree.group.remove(b.sp);
      b.sp.geometry?.dispose?.();
      b.mat.dispose();
      bursts.splice(i, 1);
      continue;
    }
    if (b.isRing) {
      b.sp.scale.setScalar(1 + k * 16);
      b.mat.opacity = 0.8 * (1 - k) * (1 - k);
      b.sp.lookAt(camera.position);
    } else {
      b.sp.scale.setScalar(0.4 + k * 3.4);
      b.mat.opacity = Math.pow(1 - k, 1.6);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 光晕贴图（复用）                                                    */
/* ------------------------------------------------------------------ */
const glowTex = (() => {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,235,190,0.55)');
  grd.addColorStop(0.6, 'rgba(255,210,140,0.12)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

/* ------------------------------------------------------------------ */
/* 照片灯箱                                                           */
/* ------------------------------------------------------------------ */
let lightboxOpen = false;
function openPhoto(index) {
  const it = photos.items[index];
  if (!it) return;
  AudioEngine.sfx('photo');
  const src = it.mat.map?.image;
  if (src && src.toDataURL) {
    lbImg.src = src.toDataURL('image/jpeg', 0.92);
  }
  lbCap.textContent = it.caption || '';
  lightboxEl.classList.add('show');
  lightboxEl.setAttribute('aria-hidden', 'false');
  lightboxOpen = true;
}
function closePhoto() {
  lightboxEl.classList.remove('show');
  lightboxEl.setAttribute('aria-hidden', 'true');
  lightboxOpen = false;
}
$('lb-close').addEventListener('click', closePhoto);
lightboxEl.addEventListener('click', (e) => { if (e.target === lightboxEl) closePhoto(); });

/* ------------------------------------------------------------------ */
/* 音乐：默认开启，进入页面自动播放                                    */
/* ------------------------------------------------------------------ */
let musicOn = true; // 默认开：有 music/ 用用户的歌，否则播内置颂歌

function currentTrackLabel() {
  return AudioEngine.isUserMode ? `我的音乐 · ${AudioEngine.trackName}` : AudioEngine.trackName;
}

function applyMusicUI() {
  $('btn-music').dataset.on = String(musicOn);
  musicTrackEl.textContent = musicOn ? currentTrackLabel() : '—';
}

/** 浏览器禁止无手势自动播放；被拦时挂一次性解锁监听，首次交互后播放 */
let autoMusicArmed = false;
function armAutoMusicOnGesture() {
  if (autoMusicArmed) return;
  autoMusicArmed = true;
  const unlock = (e) => {
    // 用户点的就是音乐按钮时交给按钮自己的 toggle，避免开了又被关掉
    if (e && e.target && e.target.closest && e.target.closest('#btn-music')) return;
    cleanup();
    if (!musicOn) return; // 用户已主动关掉，别再自动开
    AudioEngine.init();
    if (AudioEngine.start()) {
      applyMusicUI();
      toast(`♪ ${currentTrackLabel()}`);
    }
  };
  const cleanup = () => {
    ['pointerdown', 'keydown', 'touchstart'].forEach((t) =>
      window.removeEventListener(t, unlock, true));
    autoMusicArmed = false;
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((t) =>
    window.addEventListener(t, unlock, true));
}

/** 尝试立即播放；失败则等待首次交互解锁。musicOn 代表「用户想听」的意愿状态 */
function startMusic() {
  AudioEngine.init();
  if (AudioEngine.start()) {
    applyMusicUI();
    return true;
  }
  armAutoMusicOnGesture();
  applyMusicUI();
  return false;
}

function toggleMusic(force) {
  AudioEngine.init();
  const want = force === undefined ? !musicOn : force;
  if (want) {
    musicOn = true;
    if (!AudioEngine.start()) armAutoMusicOnGesture();
  } else {
    AudioEngine.stop();
    musicOn = false;
  }
  applyMusicUI();
  if (musicOn) toast(`♪ ${currentTrackLabel()}`);
}

function nextTrack() {
  AudioEngine.init();
  const idx = AudioEngine.nextTrack();
  musicOn = true;
  applyMusicUI();
  toast(`♪ ${idx + 1}/${AudioEngine.trackCount} ${AudioEngine.trackName}`);
}

setInterval(() => {
  if (musicOn && AudioEngine.started) {
    musicTrackEl.textContent = currentTrackLabel();
  }
}, 1200);

/** 页面启动：先载入 music/ 歌单（没有则用内置），再默认开启自动播放 */
async function autoMusic() {
  try {
    const res = await fetch('/api/music');
    if (res.ok) {
      const tracks = await res.json();
      if (Array.isArray(tracks) && tracks.length) {
        AudioEngine.init();
        AudioEngine.loadUserTracks(tracks);
      }
    }
  } catch (e) {
    // 没有后端接口（例如 file:// 直开）时静默忽略，保留内置颂歌
    console.debug('[music] auto load skipped', e);
  }
  musicOn = true;
  startMusic();
}

/* ------------------------------------------------------------------ */
/* 圣诞树大小（鼠标 / 手势共用）                                       */
/* ------------------------------------------------------------------ */
let treeScale = 1;
let twoHandZoomStartSpan = 0;
let twoHandZoomStartScale = 1;
let twoHandZoomActive = false;
let photosOn = true;

/** 设置圣诞树整体缩放，q=0.55..1.85。silent=true 时不弹 toast（双手连续调节） */
function setTreeScale(v, silent = false) {
  const next = clamp(v, 0.55, 1.85);
  if (Math.abs(next - treeScale) < 0.002) return;
  treeScale = next;
  tree.group.scale.setScalar(treeScale);
  if (!silent) toast(`树大小 ${Math.round(treeScale * 100)}%`);
}

/* ------------------------------------------------------------------ */
/* 手势                                                               */
/* ------------------------------------------------------------------ */
let GestureEngine = null;
let gestureOn = false;
let gestureLoading = false;
let palmX = 0, palmY = 0, palmShown = false;

async function toggleGesture(force) {
  const want = force === undefined ? !gestureOn : force;

  if (!GestureEngine) {
    gestureLoading = true;
    gestureStateEl.textContent = '加载中…';
    try {
      const mod = await import('./gesture.js');
      GestureEngine = mod.GestureEngine;
    } catch (err) {
      console.warn('[gesture] import failed', err);
      gestureStateEl.textContent = '不可用';
      gestureLoading = false;
      toast('手势模块加载失败，已回退鼠标操作');
      return;
    }
    gestureLoading = false;
  }

  if (want) {
    if (!GestureEngine.supported) {
      toast('当前环境不支持摄像头手势，已回退到鼠标 / 触摸');
      gestureStateEl.textContent = '不支持';
      return;
    }
    gestureOn = true;
    $('btn-gesture').dataset.on = 'true';
    gestureStateEl.textContent = '启动中…';

    await GestureEngine.init({
      video: camVideo,
      onStatus: ({ phase, message }) => {
        gestureStateEl.textContent = message || phase;
        if (phase === 'ready') {
          toast('手势就绪：移动光标 · 单手捏合点击 · 双手开合调树大小');
          panelEl.classList.add('show');
          panelEl.setAttribute('aria-hidden', 'false');
          setTimeout(() => {
            panelEl.classList.remove('show');
            panelEl.setAttribute('aria-hidden', 'true');
          }, 6500);
        } else if (phase === 'error') {
          toast(message || '手势不可用');
          gestureOn = false;
          $('btn-gesture').dataset.on = 'false';
          closePalm();
        }
      },
    });

    GestureEngine.onFrame(handleGestureFrame);
    GestureEngine.onGesture(handleGesture);
    const ok = await GestureEngine.start();
    if (!ok) {
      gestureOn = false;
      $('btn-gesture').dataset.on = 'false';
      closePalm();
    }
  } else {
    gestureOn = false;
    $('btn-gesture').dataset.on = 'false';
    gestureStateEl.textContent = '未启用';
    closePalm();
    if (GestureEngine) await GestureEngine.stop();
  }
}

function closePalm() {
  palmShown = false;
  palmCursor.classList.remove('on');
  palmCursor.classList.remove('pinching');
}

function handleGestureFrame(p) {
  if (!gestureOn) return;
  // 双手缩放时 hand=0 但 handCount=2，也要继续处理
  const twoHands = p && p.handCount >= 2;
  if (!p || (p.hand === 0 && !twoHands)) {
    closePalm();
    return;
  }

  // 归一化到屏幕像素
  const rect = canvas.getBoundingClientRect();
  palmX = rect.left + p.px * rect.width;
  palmY = rect.top + p.py * rect.height;

  palmCursor.style.transform = `translate3d(${palmX}px, ${palmY}px, 0)`;
  if (!palmShown) { palmCursor.classList.add('on'); palmShown = true; }

  if (p.pinch > 0.75) palmCursor.classList.add('pinching');
  else palmCursor.classList.remove('pinching');

  // 光标处局部提亮树点
  const rect2 = canvas.getBoundingClientRect();
  ndc.x = ((palmX - rect2.left) / rect2.width) * 2 - 1;
  ndc.y = -((palmY - rect2.top) / rect2.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3()
  );
  if (hit) tree.setHotspot(hit, 0.5);

  // 双手开合 -> 缩放圣诞树大小（两掌距离变大=树变大，合拢=树变小）
  // 单手捏合只保留点击功能，不再缩放。
  if (p.handCount >= 2 && typeof p.twoHandSpan === 'number') {
    if (!twoHandZoomActive) {
      twoHandZoomActive = true;
      twoHandZoomStartSpan = p.twoHandSpan;
      twoHandZoomStartScale = treeScale;
    }
    // span 变化 0.35 对应整段缩放范围（0.55..1.85）
    const delta = (p.twoHandSpan - twoHandZoomStartSpan) * 3.7;
    setTreeScale(twoHandZoomStartScale + delta, true);
    palmCursor.classList.add('pinching');
  } else {
    if (twoHandZoomActive) {
      twoHandZoomActive = false;
      toast(`树大小 ${Math.round(treeScale * 100)}%`);
    }
    palmCursor.classList.remove('pinching');
  }

  // 单击（单手捏合按下边沿）：优先关灯箱 / 许愿窗，其次点击场景
  if (twoHands) return;
  if (p.pinchEdge === 'down') {
    if (lightboxOpen) closePhoto();
    else if (wishModal.classList.contains('show')) closeWish();
    else handleClick(palmX, palmY);
  }
}

function handleGesture({ name }) {
  if (!gestureOn) return;
  if (name === 'fist') {
    CAM.autoRotate = !CAM.autoRotate;
    toast(CAM.autoRotate ? '▶ 恢复旋转' : '❚❚ 暂停旋转');
    AudioEngine.sfx('pop');
  } else if (name === 'victory') {
    capture();
  } else if (name === 'point') {
    CAM.tDist = clamp(CAM.tDist - 0.9, CAM.distMin, CAM.distMax);
    AudioEngine.sfx('whoosh');
  } else if (name === 'three') {
    // 三指：显示/隐藏照片挂饰
    photosOn = !photosOn;
    photos.group.visible = photosOn;
    toast(photosOn ? '▣ 照片已显示' : '▣ 照片已隐藏');
    AudioEngine.sfx('pop');
  }
  // 张开手掌不再切歌（切歌用 ⏭ 按钮 / N 键）；开合树大小改用双手手势。
}

/* ------------------------------------------------------------------ */
/* 截图                                                               */
/* ------------------------------------------------------------------ */
function capture() {
  AudioEngine.sfx('photo');
  // 保证当前帧已绘制
  composer.render();
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.download = `ChristmasNight_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
  a.href = url;
  a.click();
  toast('已保存截图 ✦');
}

/* ------------------------------------------------------------------ */
/* 许愿                                                               */
/* ------------------------------------------------------------------ */
function openWish() {
  wishModal.classList.add('show');
  wishModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => wishInput.focus(), 260);
}
function closeWish() {
  wishModal.classList.remove('show');
  wishModal.setAttribute('aria-hidden', 'true');
  wishInput.value = '';
}
function submitWish() {
  const text = wishInput.value.trim();
  if (!text) {
    wishInput.focus();
    return;
  }
  wishes.spawn(text, camera);
  AudioEngine.sfx('star');
  closeWish();
  toast(`「${text}」已点亮 ✦`, 3000);
}

/* ------------------------------------------------------------------ */
/* 上传照片                                                           */
/* ------------------------------------------------------------------ */
fileInput.addEventListener('change', async () => {
  const files = [...(fileInput.files || [])];
  if (!files.length) return;
  let n = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const img = await loadImage(f);
      const cap = n === 0 ? '我的照片' : `我的照片 ${n + 1}`;
      photos.addPhoto(img, cap);
      n++;
    } catch (err) {
      console.warn('image load failed', err);
    }
  }
  fileInput.value = '';
  if (n > 0) {
    AudioEngine.sfx('photo');
    toast(`已挂上 ${n} 张照片 ▣`, 2600);
  } else {
    toast('没有可用的图片');
  }
});

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* UI 绑定                                                            */
/* ------------------------------------------------------------------ */
$('btn-music').addEventListener('click', () => toggleMusic());
$('btn-next').addEventListener('click', nextTrack);
$('btn-snow').addEventListener('click', () => {
  const on = !snow.enabled;
  snow.setEnabled(on);
  $('btn-snow').dataset.on = String(on);
  AudioEngine.sfx('snow');
  toast(on ? '❄ 飘雪已开启' : '飘雪已关闭');
});
$('btn-fireworks').addEventListener('click', () => {
  const on = !fireworks.enabled;
  fireworks.setEnabled(on);
  $('btn-fireworks').dataset.on = String(on);
  AudioEngine.sfx(on ? 'star' : 'pop');
  toast(on ? '✨ 烟花已开启' : '烟花已关闭');
});
$('btn-gesture').addEventListener('click', () => toggleGesture());
$('btn-wish').addEventListener('click', () => { AudioEngine.sfx('pop'); openWish(); });
$('btn-photos').addEventListener('click', () => fileInput.click());
$('btn-shot').addEventListener('click', capture);
$('btn-full').addEventListener('click', toggleFullscreen);

$('panel-close').addEventListener('click', () => {
  panelEl.classList.remove('show');
  panelEl.setAttribute('aria-hidden', 'true');
});
$('wish-cancel').addEventListener('click', closeWish);
$('wish-ok').addEventListener('click', submitWish);
wishModal.addEventListener('click', (e) => { if (e.target === wishModal) closeWish(); });
wishInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitWish();
  if (e.key === 'Escape') closeWish();
});

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

/* 快捷键 */
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'm') toggleMusic();
  else if (k === 'n') nextTrack();
  else if (k === 's') $('btn-snow').click();
  else if (k === 'b') $('btn-fireworks').click();
  else if (k === 'g') toggleGesture();
  else if (k === 'w') openWish();
  else if (k === 'p') fileInput.click();
  else if (k === 'c') capture();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'escape') {
    if (lightboxOpen) closePhoto();
    if (wishModal.classList.contains('show')) closeWish();
  }
});

/* ------------------------------------------------------------------ */
/* 尺寸                                                               */
/* ------------------------------------------------------------------ */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 0.85 ? 52 : 42;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (composer) {
    composer.setSize(w, h);
    bloomPass?.setSize(w, h);
  }
  applySizing();
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ */
/* 主循环 */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0, fpsTimer = 0;
let revealT = 0;
const REVEAL_DUR = 4.6; // 爆炸聚拢稍慢一点，才看得清过程

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  // 开场揭示：粒子从爆炸态聚拢成圣诞树
  if (revealT < 1) {
    revealT = Math.min(1, revealT + dt / REVEAL_DUR);
    const e = 1 - Math.pow(1 - revealT, 2.0);
    tree.setReveal(e);
    // 照片等树基本成形再挂上去
    if (photos) photos.group.visible = e > 0.85 && photosOn;
    if (revealT >= 1 && photos) photos.group.visible = photosOn;
  }

  updateCamera(dt);

  tree.update(dt, elapsed);
  tree.faceCamera(camera);
  tree.syncHits();
  photos.update(elapsed, camera, tree.group);
  wishes.update(elapsed, camera);
  sky.update(elapsed);
  aurora.update(elapsed);
  starfield.update(elapsed);
  ground.update(elapsed);
  snow.update(elapsed, camera);
  fireworks.update(dt);
  updateBursts(dt);

  // 同步实例化球体的 uTime
  if (DEBUG_NOBLOOM) renderer.render(scene, camera);
  else composer.render();

  // FPS
  frames++;
  fpsTimer += dt;
  if (fpsTimer > 0.6) {
    const fps = Math.round(frames / fpsTimer);
    if (fpsEl) fpsEl.textContent = `${fps} fps`;
    frames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(animate);
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */
async function boot() {
  setProgress(0.05, '正在铺设冰面…');
  await frame();
  setProgress(0.12, '正在播撒星尘…');

  setupComposer();
  resize();

  await frame();

  setProgress(0.2, '正在生长圣诞树…');
  await frame();

  setProgress(0.32, '正在读取照片…');
  folderImages = await loadFolderPhotos();
  await frame();

  try {
    buildWorld();
  } catch (err) {
    console.error('world build failed', err);
    loaderTip.textContent = '场景加载失败，请查看控制台';
    return;
  }

  setProgress(0.62, '正在挂上灯串…');
  await frame();

  setProgress(0.78, '正在摆放照片…');
  await frame();

  // 首帧预编译，避免开场卡顿
  renderer.compile(scene, camera);
  setProgress(0.9, '正在调试光与影…');
  await frame();

  window.addEventListener('resize', resize);
  resize();

  // 灯光渐亮
  tree.setReveal(0);
  animate();

  setProgress(1, '准备好了');
  await wait(420);

  loaderEl.classList.add('hidden');
  setTimeout(() => { loaderEl.style.display = 'none'; }, 1000);

  // 开场的小提示
  setTimeout(() => {
    toast('♪ 背景音乐已开启 · 拖动旋转 · 滚轮缩放', 3200);
  }, 1600);

  setTimeout(() => hintEl.classList.add('gone'), 9000);

  // 开场撒一把雪
  burstSnow();

  // 默认载入 music/ 歌单并开始播放（没有则播内置颂歌）
  autoMusic();

  if (DEBUG_MODE) {
    window.__debug = {
      scene, camera, renderer, composer, tree, snow, fireworks, CAM, THREE,
      photos, openPhoto, closePhoto, handleClick,
      setTreeScale, nextTrack, toggleGesture, handleGesture, handleGestureFrame,
      loadUserTracks: (files) => AudioEngine.loadUserTracks(files),
      restoreBuiltin: () => AudioEngine.restoreBuiltin(),
      get treeScale() { return treeScale; },
      get photosOn() { return photosOn; },
      get isUserMode() { return AudioEngine.isUserMode; },
      get musicOn() { return musicOn; },
      get musicStarted() { return AudioEngine.started; },
      get gestureOn() { return gestureOn; },
      setGestureOn: (v) => { gestureOn = !!v; },
    };
  }
}

function burstSnow() {
  // 让雪的初始透明度从 0 升起
  snow.setEnabled(true);
  $('btn-snow').dataset.on = 'true';
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 全局错误兜底 */
window.addEventListener('error', (e) => {
  console.error('[fatal]', e.error || e.message);
});

document.addEventListener('visibilitychange', () => {
  // 切到后台时暂停音乐，回来不自动恢复（尊重用户）
});

boot();
