/* =====================================================================
   fireworks.js — 背景烟花：上升火箭 + 爆炸光粒
   完全程序化，无贴图。CPU 维护少量粒子，GLSL 负责发光渲染。
   所有片元输出经 hdrSafe 限幅，避免 HDR 半浮点缓冲溢出（历史黑块问题）。
   ===================================================================== */
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aAlpha;
  uniform float uPixelRatio;
  uniform float uViewFactor;
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(1.0, -mv.z);
    gl_PointSize = aSize * uPixelRatio * uViewFactor / depth;
    gl_PointSize = clamp(gl_PointSize, 1.0, 110.0);
  }
`;

const FRAG = /* glsl */`
  #define HDR_MAX 14.0
  vec3 hdrSafe(vec3 c){
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    return clamp(c, vec3(0.0), vec3(HDR_MAX));
  }
  float aSafe(float a){ if (isnan(a) || isinf(a)) a = 0.0; return clamp(a, 0.0, 1.0); }
  varying vec3  vColor;
  varying float vAlpha;
  uniform float uIntensity;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    uv.y = -uv.y;
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float soft = pow(core, 2.2);
    float glow = pow(core, 0.65) * 0.32;
    vec2 av = abs(uv);
    float ray = (pow(max(0.0, 1.0 - av.x * 18.0), 3.0) +
                 pow(max(0.0, 1.0 - av.y * 18.0), 3.0)) * 0.28;
    float a = (soft + glow + ray) * vAlpha * uIntensity;
    if (a < 0.004) discard;
    vec3 col = vColor * (soft * 1.7 + glow * 0.9 + ray);
    gl_FragColor = vec4(hdrSafe(col), aSafe(a));
    #include <colorspace_fragment>
  }
`;

/* 圣诞主题配色：金/红/绿权重高，点缀蓝紫，偶尔白 */
const PALETTE = [
  [1.00, 0.78, 0.32], // gold
  [1.00, 0.32, 0.28], // red
  [0.36, 1.00, 0.48], // green
  [1.00, 0.78, 0.32], // gold (again, 提权)
  [1.00, 0.32, 0.28], // red  (again)
  [0.36, 1.00, 0.48], // green(again)
  [0.40, 0.62, 1.00], // blue
  [0.82, 0.42, 1.00], // purple
  [1.00, 0.95, 0.82], // white
];

const rr = (a, b) => a + Math.random() * (b - a);
const pick = () => PALETTE[(Math.random() * PALETTE.length) | 0];

const MAX_PARTICLES = 1600;
const MAX_ROCKETS = 7;

export function buildFireworks() {
  /* 粒子对象池 */
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  const siz = new Float32Array(MAX_PARTICLES);
  const alp = new Float32Array(MAX_PARTICLES);

  const pool = new Array(MAX_PARTICLES);
  const free = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool[i] = { alive: false, id: i, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, drag: 0.98, gravity: 0 };
    free.push(i);
  }
  const particles = [];

  function spawn() {
    if (!free.length) return null;
    const p = pool[free.pop()];
    p.alive = true;
    particles.push(p);
    return p;
  }

  function kill(p) {
    p.alive = false;
    free.push(p.id);
    const i = particles.indexOf(p);
    if (i >= 0) particles.splice(i, 1);
  }

  const rockets = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPixelRatio: { value: 1 },
      uViewFactor: { value: 600 },
      uIntensity: { value: 1.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -30; // 在树/雪之前绘制，作为背景

  let enabled = true;
  let emitTimer = 0.6;

  function launchRocket() {
    if (rockets.length >= MAX_ROCKETS) return;
    const c = pick();
    rockets.push({
      x: rr(-30, 30),
      y: rr(0.5, 2.5),
      z: rr(-24, -48),
      vy: rr(10, 15),
      targetY: rr(16, 30),
      c,
      trail: 0,
      big: Math.random() < 0.28,
    });
  }

  function explode(r) {
    const count = r.big ? 150 : 96;
    const base = r.c;
    const ring = Math.random() < 0.45; // 部分做成环形
    for (let i = 0; i < count; i++) {
      const p = spawn();
      if (!p) break;
      p.x = r.x; p.y = r.y; p.z = r.z;
      let dx, dy, dz;
      if (ring) {
        const a = (i / count) * Math.PI * 2 + rr(-0.08, 0.08);
        const sp = rr(6.5, 8.5);
        dx = Math.cos(a) * sp;
        dy = rr(-0.8, 0.8);
        dz = Math.sin(a) * sp;
      } else {
        // 球面均匀
        const u = rr(-1, 1);
        const th = rr(0, Math.PI * 2);
        const s = Math.sqrt(1 - u * u);
        const sp = rr(2.5, 8.5);
        dx = Math.cos(th) * s * sp;
        dy = u * sp;
        dz = Math.sin(th) * s * sp;
      }
      p.vx = dx; p.vy = dy; p.vz = dz;
      p.maxLife = rr(1.3, 2.6);
      p.life = p.maxLife;
      p.size = rr(0.7, 1.35) * (r.big ? 1.25 : 1);
      // 颜色轻微抖动，避免死板
      const j = rr(0.85, 1.15);
      p.r = Math.min(1.4, base[0] * j);
      p.g = Math.min(1.4, base[1] * j);
      p.b = Math.min(1.4, base[2] * j);
      p.drag = 0.982;
      p.gravity = 3.4;
    }
    // 中心闪光
    const f = spawn();
    if (f) {
      f.x = r.x; f.y = r.y; f.z = r.z;
      f.vx = f.vy = f.vz = 0;
      f.maxLife = 0.32; f.life = 0.32;
      f.size = r.big ? 9 : 6.5;
      f.r = base[0] * 1.2; f.g = base[1] * 1.2; f.b = base[2] * 1.2;
      f.drag = 1; f.gravity = 0;
    }
  }

  function spawnTrail(r) {
    const p = spawn();
    if (!p) return;
    p.x = r.x + rr(-0.12, 0.12);
    p.y = r.y + rr(-0.2, 0.2);
    p.z = r.z + rr(-0.12, 0.12);
    p.vx = rr(-0.4, 0.4); p.vy = rr(-0.6, 0.2); p.vz = rr(-0.4, 0.4);
    p.maxLife = rr(0.28, 0.55); p.life = p.maxLife;
    p.size = rr(0.5, 0.95);
    p.r = r.c[0] * 0.9; p.g = r.c[1] * 0.9; p.b = r.c[2] * 0.9;
    p.drag = 0.95; p.gravity = 0.5;
  }

  function update(dt) {
    if (enabled) {
      emitTimer -= dt;
      if (emitTimer <= 0) {
        launchRocket();
        emitTimer = rr(0.55, 1.35);
      }
    }

    // 火箭
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.trail += dt;
      while (r.trail > 0.022) { r.trail -= 0.022; spawnTrail(r); }
      r.y += r.vy * dt;
      r.vy -= 3.0 * dt;
      if (r.y >= r.targetY || r.vy <= 0) {
        explode(r);
        rockets.splice(i, 1);
      }
    }

    // 粒子物理 + 写入 buffer
    let w = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { kill(p); continue; }
      const damp = Math.pow(p.drag, dt * 60);
      p.vx *= damp; p.vz *= damp;
      p.vy = p.vy * damp - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      const t = p.life / p.maxLife;
      const a = t < 0.25 ? t / 0.25 : 1; // 末段淡出
      const k = w * 3;
      pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
      col[k] = p.r; col[k + 1] = p.g; col[k + 2] = p.b;
      siz[w] = p.size;
      alp[w] = a;
      w++;
    }
    geo.setDrawRange(0, w);
    if (w > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }
  }

  function clear() {
    while (particles.length) kill(particles[particles.length - 1]);
    rockets.length = 0;
    geo.setDrawRange(0, 0);
  }

  return {
    points,
    get enabled() { return enabled; },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) clear();
      else emitTimer = 0.4;
    },
    update,
    setPixelRatio(pr) { mat.uniforms.uPixelRatio.value = pr; },
    setViewFactor(vf) { mat.uniforms.uViewFactor.value = vf; },
    /** 手动放一发（调试/交互用） */
    fire() { launchRocket(); },
    clear,
    get count() { return particles.length; },
  };
}
