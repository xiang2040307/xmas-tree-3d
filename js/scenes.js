/* =====================================================================
   scenes.js — 天幕、星空、冰面、雪、远景氛围
   ===================================================================== */
import * as THREE from 'three';
import {
  createSkyMaterial, createStarfieldMaterial, createGroundMaterial, createSnowMaterial,
} from './shaders.js';

/* ---------- 伪随机 ---------- */
let seed = 77123;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
};
const rr = (a, b) => a + rnd() * (b - a);

/* ------------------------------------------------------------------ */
export function buildSky() {
  const mat = createSkyMaterial();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(180, 40, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return {
    mesh,
    update(t) { mat.uniforms.uTime.value = t; },
  };
}

/* ------------------------------------------------------------------ */
export function buildStarfield(count = 2400) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // 球壳分布，避免地平线下方
    const u = rnd() * Math.PI * 2;
    const v = Math.pow(rnd(), 0.65);
    const y = v * 0.96 + 0.04;
    const r = 90 + rnd() * 60;
    const s = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(u) * s * r;
    pos[i * 3 + 1] = y * r;
    pos[i * 3 + 2] = Math.sin(u) * s * r;
    size[i] = rr(0.6, 2.2);
    phase[i] = rnd() * 200;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = createStarfieldMaterial();
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -90;

  return {
    mesh: pts,
    update(t) { mat.uniforms.uTime.value = t; },
    setPixelRatio(pr) { mat.uniforms.uPixelRatio.value = pr; },
  };
}

/* ------------------------------------------------------------------ */
export function buildGround(radius = 15) {
  const mat = createGroundMaterial({ radius });
  const geo = new THREE.PlaneGeometry(radius * 2.6, radius * 2.6, 1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t) { mat.uniforms.uTime.value = t; },
  };
}

/* ------------------------------------------------------------------ */
export function buildSnow({ count = 5200, radius = 16, height = 24 } = {}) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const sway = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3] = rr(-radius, radius);
    pos[i * 3 + 1] = rr(0, height);
    pos[i * 3 + 2] = rr(-radius, radius);
    size[i] = rr(0.8, 3.4);
    phase[i] = rnd() * 100;
    speed[i] = rr(0.35, 1.4);
    sway[i] = rr(0.05, 0.55);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), radius * 2);

  const mat = createSnowMaterial({ opacity: 0.9, height, radius, wind: 0.5 });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 20;

  let targetOpacity = 0.9;

  return {
    mesh: pts,
    update(t, camera) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uCamPos.value.copy(camera.position);
      mat.uniforms.uWind.value = 0.5 + Math.sin(t * 0.21) * 0.45;
      // 平滑淡入淡出
      const cur = mat.uniforms.uOpacity.value;
      mat.uniforms.uOpacity.value = cur + (targetOpacity - cur) * 0.06;
    },
    setEnabled(on) { targetOpacity = on ? 0.9 : 0.0; },
    get enabled() { return targetOpacity > 0.1; },
    setPixelRatio(pr) { mat.uniforms.uPixelRatio.value = pr; },
    setViewFactor(v) { mat.uniforms.uViewFactor.value = v; },
  };
}

/* ------------------------------------------------------------------ */
/* 远景：雪丘轮廓（低成本剪影）                                        */
/* ------------------------------------------------------------------ */
export function buildHorizon() {
  const group = new THREE.Group();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x0b1526,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const hills = [
    { r: 62, y: -1.2, h: 9, seg: 90, phase: 0.0 },
    { r: 44, y: -2.2, h: 6, seg: 80, phase: 2.1 },
    { r: 30, y: -3.0, h: 3.6, seg: 70, phase: 4.3 },
  ];

  for (const hl of hills) {
    const pts = [];
    for (let i = 0; i <= hl.seg; i++) {
      const a = (i / hl.seg) * Math.PI * 2;
      const k = Math.sin(a * 3 + hl.phase) * 0.5 + Math.sin(a * 7 + hl.phase * 2) * 0.3 + Math.sin(a * 11) * 0.2;
      pts.push(new THREE.Vector2(hl.r + k * 3, hl.y + Math.abs(k) * hl.h));
    }
    const shape = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < hl.seg; i++) {
      const a = (i / hl.seg) * Math.PI * 2;
      const b = ((i + 1) / hl.seg) * Math.PI * 2;
      const p0 = pts[i], p1 = pts[i + 1];
      const x0 = Math.cos(a) * p0.x, z0 = Math.sin(a) * p0.x;
      const x1 = Math.cos(b) * p1.x, z1 = Math.sin(b) * p1.x;
      verts.push(x0, -4, z0, x1, -4, z1, x1, p1.y, z1);
      verts.push(x0, -4, z0, x1, p1.y, z1, x0, p0.y, z0);
    }
    shape.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.Mesh(shape, mat);
    m.renderOrder = -50;
    m.frustumCulled = false;
    group.add(m);
  }

  return { group };
}

/* ------------------------------------------------------------------ */
/* 极光带（天空中的柔光帘幕）                                          */
/* ------------------------------------------------------------------ */
const AURORA_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const AURORA_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // 竖直渐变 + 横向波纹
    float band = sin(uv.x * 6.0 + uTime * 0.25) * 0.5 + 0.5;
    float wave = sin(uv.x * 13.0 - uTime * 0.45 + sin(uv.x * 4.0) * 1.4) * 0.5 + 0.5;
    float v = smoothstep(0.0, 0.35, uv.y) * smoothstep(1.0, 0.55, uv.y);
    float a = v * (0.35 + 0.45 * wave) * (0.5 + 0.5 * band) * uOpacity;
    // 左右/上下软边：否则 PlaneGeometry 的矩形硬边会在天空里露馅
    a *= smoothstep(0.0, 0.22, uv.x) * smoothstep(1.0, 0.78, uv.x);
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.10, 0.55, 0.42), vec3(0.20, 0.32, 0.85), uv.y);
    col = mix(col, vec3(0.55, 0.25, 0.75), band * 0.35);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export function buildAurora() {
  const group = new THREE.Group();
  const layers = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.55 - i * 0.13 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const w = 120 - i * 22;
    const h = 34 - i * 6;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1), mat);
    m.position.set(rr(-8, 8), 26 + i * 5, -52 - i * 14);
    m.rotation.z = (i - 1) * 0.09;
    m.renderOrder = -80;
    m.frustumCulled = false;
    layers.push({ m, mat });
    group.add(m);
  }
  return {
    group,
    update(t) { layers.forEach((l, i) => { l.mat.uniforms.uTime.value = t + i * 3; }); },
  };
}
