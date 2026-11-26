/* =====================================================================
   tree.js — 圣诞树主体：微粒树冠、螺旋灯带、彩灯、挂饰、顶部之星
   ===================================================================== */
import * as THREE from 'three';
import {
  createTreeMaterial, createBulbMaterial, createStarMaterial,
  createOrnamentMaterial, createGlowMaterial,
} from './shaders.js';

export const TREE = {
  height: 7.4,
  baseRadius: 2.55,
  trunkHeight: 0.55,
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
const rng = (() => {
  let s = 20241224;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
})();
const rand = (a = 0, b = 1) => a + rng() * (b - a);
const pick = (arr) => arr[(rng() * arr.length) | 0];

/* 圆锥在高度 t（0=底, 1=顶）处的半径，带一点凹形轮廓 */
function coneRadius(t, base = TREE.baseRadius) {
  const k = Math.pow(1 - t, 0.82);
  return base * k;
}

/* ------------------------------------------------------------------ */
/* 主体构建                                                            */
/* ------------------------------------------------------------------ */
export function buildTree() {
  const group = new THREE.Group();
  group.name = 'tree';

  const H = TREE.height;
  const R = TREE.baseRadius;

  // 不透明度是"过曝"的第一道闸：62000 个 additive 粒子叠在一起极易洗白
  const TREE_OP = 0.55;
  const GAR_OP = 0.5;
  const BULB_OP = 0.72;
  const treeMat = createTreeMaterial({ sizeScale: 1.0, twinkle: 1.0, opacity: TREE_OP, intensity: 1.45 });
  const garlandMat = createTreeMaterial({ sizeScale: 1.35, twinkle: 0.65, intensity: 1.15, opacity: GAR_OP });
  const bulbMat = createBulbMaterial({ speed: 0.5, opacity: BULB_OP });

  /* ---------- 1. 树冠微粒 ---------- */
  const N_MAIN = 62000;
  const mainPos = new Float32Array(N_MAIN * 3);
  const mainExplode = new Float32Array(N_MAIN * 3); // 开场爆炸起点
  const mainSize = new Float32Array(N_MAIN);
  const mainColor = new Float32Array(N_MAIN * 3);
  const mainPhase = new Float32Array(N_MAIN);
  const mainSpeed = new Float32Array(N_MAIN);
  const mainFlare = new Float32Array(N_MAIN);
  const mainY = new Float32Array(N_MAIN);

  const cDeep = new THREE.Color(0x07362a);
  const cMidReal = new THREE.Color(0x17825d);
  const cLight = new THREE.Color(0x33d69a);
  const cGold = new THREE.Color(0xffd592);
  const cWarm = new THREE.Color(0xffb45c);

  const ARMS = 17;      // 螺旋枝股数
  const TURNS = 3.6;    // 总圈数

  for (let i = 0; i < N_MAIN; i++) {
    const useArm = rng() < 0.72;
    let t, ang, rad;

    if (useArm) {
      // 沿螺旋枝股分布 -> 形成"旋转枝条"的视觉
      const armIdx = (rng() * ARMS) | 0;
      t = Math.pow(rng(), 0.86);                       // 底部略密
      const baseAng = (armIdx / ARMS) * Math.PI * 2;
      ang = baseAng + t * TURNS * Math.PI * 2 + rand(-0.10, 0.10);
      const rMax = coneRadius(t, R);
      // 枝条自身有径向厚度，越靠外越稀薄
      const rr = Math.pow(rng(), 0.55);
      rad = rMax * (0.55 + 0.45 * rr);
      // 枝条末梢稍微向上翘
      t += (1 - rr) * 0.028;
    } else {
      // 体积填充：让树有厚度而不是空壳
      t = Math.pow(rng(), 0.9);
      ang = rng() * Math.PI * 2;
      const rMax = coneRadius(t, R);
      rad = rMax * Math.pow(rng(), 0.42) * 0.96;
    }

    const y = t * H;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;

    // 轻微抖动
    const jx = rand(-0.035, 0.035) * (1 - t * 0.4);
    const jz = rand(-0.035, 0.035) * (1 - t * 0.4);

    const k3 = i * 3;
    mainPos[k3] = x + jx;
    mainPos[k3 + 1] = y;
    mainPos[k3 + 2] = z + jz;

    // 爆炸起点：以树为中心向四面八方炸开，带球状外壳 + 随机纵深
    const ea = rng() * Math.PI * 2;
    const ep = Math.acos(rand(-1, 1));
    const er = rand(0.42, 1.0) * (6.5 + t * 4.5);
    mainExplode[k3]     = Math.sin(ep) * Math.cos(ea) * er;
    mainExplode[k3 + 1] = H * 0.5 + Math.cos(ep) * er * 0.75 + rand(-1.5, 1.5);
    mainExplode[k3 + 2] = Math.sin(ep) * Math.sin(ea) * er;

    // 颜色：内部深绿，外层翠绿；顶部与零星点缀金色
    const edge = rad / Math.max(0.001, coneRadius(t, R)); // 0 内 -> 1 外
    const c = new THREE.Color();
    c.copy(cDeep).lerp(cMidReal, Math.min(1, edge * 1.15 + t * 0.25));
    if (edge > 0.82 && rng() < 0.55) c.lerp(cLight, rand(0.15, 0.55));
    if (t > 0.72 && rng() < 0.10) c.lerp(cGold, rand(0.3, 0.8));
    if (rng() < 0.013) c.lerp(cWarm, rand(0.5, 1.0));  // 零星暖光

    mainColor[k3] = c.r; mainColor[k3 + 1] = c.g; mainColor[k3 + 2] = c.b;

    const isSpark = rng() < 0.055;
    mainSize[i] = isSpark ? rand(0.030, 0.058) : rand(0.010, 0.026);
    mainFlare[i] = isSpark ? rand(0.35, 1.0) : (rng() < 0.06 ? rand(0.1, 0.4) : 0);
    mainPhase[i] = rng() * Math.PI * 2;
    mainSpeed[i] = rand(0.7, 2.4);
    mainY[i] = t;
  }

  const mainGeo = new THREE.BufferGeometry();
  mainGeo.setAttribute('position', new THREE.BufferAttribute(mainPos, 3));
  mainGeo.setAttribute('aExplode', new THREE.BufferAttribute(mainExplode, 3));
  mainGeo.setAttribute('aSize', new THREE.BufferAttribute(mainSize, 1));
  mainGeo.setAttribute('aColor', new THREE.BufferAttribute(mainColor, 3));
  mainGeo.setAttribute('aPhase', new THREE.BufferAttribute(mainPhase, 1));
  mainGeo.setAttribute('aSpeed', new THREE.BufferAttribute(mainSpeed, 1));
  mainGeo.setAttribute('aFlare', new THREE.BufferAttribute(mainFlare, 1));
  mainGeo.setAttribute('aY', new THREE.BufferAttribute(mainY, 1));
  mainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H);

  const mainPoints = new THREE.Points(mainGeo, treeMat);
  mainPoints.frustumCulled = false;
  mainPoints.renderOrder = 2;
  group.add(mainPoints);

  /* ---------- 2. 金色螺旋灯带（亮线感） ---------- */
  const SPIRALS = 3;
  const PER_SPIRAL = 5200;
  const gp = new Float32Array(SPIRALS * PER_SPIRAL * 3);
  const gExplode = new Float32Array(SPIRALS * PER_SPIRAL * 3);
  const gs = new Float32Array(SPIRALS * PER_SPIRAL);
  const gc = new Float32Array(SPIRALS * PER_SPIRAL * 3);
  const gph = new Float32Array(SPIRALS * PER_SPIRAL);
  const gsp = new Float32Array(SPIRALS * PER_SPIRAL);
  const gfl = new Float32Array(SPIRALS * PER_SPIRAL);
  const gY = new Float32Array(SPIRALS * PER_SPIRAL);
  let gi = 0;

  const goldA = new THREE.Color(0xffe6ac);
  const goldB = new THREE.Color(0xffc85e);

  for (let s = 0; s < SPIRALS; s++) {
    const turns = 4.6 + s * 0.55;
    const phase = (s / SPIRALS) * Math.PI * 2 * 0.9;
    for (let j = 0; j < PER_SPIRAL; j++) {
      const t = j / (PER_SPIRAL - 1);
      const ang = phase + t * turns * Math.PI * 2;
      const rMax = coneRadius(t, R);
      // 灯带贴着树冠外壳，略微内收一点
      const rad = rMax * (1.012 + Math.sin(t * 42 + s) * 0.006);
      const y = t * H + Math.sin(t * 60 + s * 2) * 0.006;

      const k3 = gi * 3;
      gp[k3] = Math.cos(ang) * rad;
      gp[k3 + 1] = y;
      gp[k3 + 2] = Math.sin(ang) * rad;

      const ea = rng() * Math.PI * 2;
      const ep = Math.acos(rand(-1, 1));
      const er = rand(0.45, 1.0) * (7 + t * 4);
      gExplode[k3]     = Math.sin(ep) * Math.cos(ea) * er;
      gExplode[k3 + 1] = H * 0.5 + Math.cos(ep) * er * 0.8;
      gExplode[k3 + 2] = Math.sin(ep) * Math.sin(ea) * er;

      const c = goldA.clone().lerp(goldB, Math.pow(t, 0.5) * 0.7 + (j % 3) * 0.1);
      gc[k3] = c.r; gc[k3 + 1] = c.g; gc[k3 + 2] = c.b;

      gs[gi] = rand(0.011, 0.019);
      gph[gi] = rng() * Math.PI * 2;
      gsp[gi] = rand(1.2, 3.0);
      gfl[gi] = rng() < 0.16 ? rand(0.3, 0.8) : 0;
      gY[gi] = t;
      gi++;
    }
  }

  const garGeo = new THREE.BufferGeometry();
  garGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  garGeo.setAttribute('aExplode', new THREE.BufferAttribute(gExplode, 3));
  garGeo.setAttribute('aSize', new THREE.BufferAttribute(gs, 1));
  garGeo.setAttribute('aColor', new THREE.BufferAttribute(gc, 3));
  garGeo.setAttribute('aPhase', new THREE.BufferAttribute(gph, 1));
  garGeo.setAttribute('aSpeed', new THREE.BufferAttribute(gsp, 1));
  garGeo.setAttribute('aFlare', new THREE.BufferAttribute(gfl, 1));
  garGeo.setAttribute('aY', new THREE.BufferAttribute(gY, 1));
  garGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H);

  const garPoints = new THREE.Points(garGeo, garlandMat);
  garPoints.frustumCulled = false;
  garPoints.renderOrder = 3;
  group.add(garPoints);

  /* ---------- 3. 彩灯（追逐跑马灯） ---------- */
  const BULB_COUNT = 900;
  const bp = new Float32Array(BULB_COUNT * 3);
  const bt = new Float32Array(BULB_COUNT);
  const bsz = new Float32Array(BULB_COUNT);
  const bc = new Float32Array(BULB_COUNT * 3);
  const bph = new Float32Array(BULB_COUNT);

  const PALETTE = [0xffd24a, 0xff5f5f, 0x5ad1ff, 0x8effa0, 0xff9de0, 0xffffff, 0xffb45c];
  const bulbPositions = [];
  let bi = 0;
  for (let s = 0; s < SPIRALS && bi < BULB_COUNT; s++) {
    const turns = 4.6 + s * 0.55;
    const phase = (s / SPIRALS) * Math.PI * 2 * 0.9;
    const per = Math.floor(BULB_COUNT / SPIRALS);
    for (let j = 0; j < per; j++) {
      const t = (j + 0.5) / per;
      const ang = phase + t * turns * Math.PI * 2;
      const rad = coneRadius(t, R) * 1.03;
      const k3 = bi * 3;
      bp[k3] = Math.cos(ang) * rad;
      bp[k3 + 1] = t * H;
      bp[k3 + 2] = Math.sin(ang) * rad;
      bt[bi] = t;
      bsz[bi] = rand(0.055, 0.10);
      const c = new THREE.Color(PALETTE[bi % PALETTE.length]);
      bc[k3] = c.r; bc[k3 + 1] = c.g; bc[k3 + 2] = c.b;
      bph[bi] = rng() * Math.PI * 2;
      bulbPositions.push(new THREE.Vector3(bp[k3], bp[k3 + 1], bp[k3 + 2]));
      bi++;
    }
  }

  const bulbGeo = new THREE.BufferGeometry();
  bulbGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  bulbGeo.setAttribute('aT', new THREE.BufferAttribute(bt, 1));
  bulbGeo.setAttribute('aSize', new THREE.BufferAttribute(bsz, 1));
  bulbGeo.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
  bulbGeo.setAttribute('aPhase', new THREE.BufferAttribute(bph, 1));
  bulbGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), H);

  const bulbPoints = new THREE.Points(bulbGeo, bulbMat);
  bulbPoints.frustumCulled = false;
  bulbPoints.renderOrder = 4;
  group.add(bulbPoints);

  /* ---------- 4. 挂饰球（实例化） ---------- */
  const ORN_COUNT = 88;
  const ornGeo = new THREE.SphereGeometry(1, 14, 10);
  const ornMat = createOrnamentMaterial(0);
  const ornMesh = new THREE.InstancedMesh(ornGeo, ornMat, ORN_COUNT);
  ornMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ornMesh.frustumCulled = false;
  ornMesh.renderOrder = 5;

  const ornColors = new Float32Array(ORN_COUNT * 3);
  const ornPhase = new Float32Array(ORN_COUNT);
  const ornData = [];
  const ORN_PALETTE = [0xd8342b, 0xe9b23c, 0x2f7fd1, 0xcfd8e8, 0x2f9e6b, 0xb4459c, 0xf2e6cf];

  for (let i = 0; i < ORN_COUNT; i++) {
    const t = Math.pow(rand(0.02, 0.985), 0.78);
    const ang = rand(0, Math.PI * 2);
    const rad = coneRadius(t, R) * rand(0.94, 1.04);
    const size = rand(0.055, 0.115) * (1 - t * 0.28);
    const c = new THREE.Color(pick(ORN_PALETTE));
    ornData.push({
      base: new THREE.Vector3(Math.cos(ang) * rad, t * H, Math.sin(ang) * rad),
      size, t, phase: rand(0, Math.PI * 2), speed: rand(0.5, 1.2),
      color: c.clone(), hover: 0,
    });
    ornColors[i * 3] = c.r; ornColors[i * 3 + 1] = c.g; ornColors[i * 3 + 2] = c.b;
    ornPhase[i] = ornData[i].phase;
  }

  // 每个实例的颜色用 instanceColor
  ornMesh.instanceColor = new THREE.InstancedBufferAttribute(ornColors, 3);

  // 把 aColor / aPhase 也作为实例属性注入 shader
  ornGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(ornColors, 3));
  ornGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ornPhase, 1));

  const dummy = new THREE.Object3D();
  for (let i = 0; i < ORN_COUNT; i++) {
    const d = ornData[i];
    dummy.position.copy(d.base);
    dummy.scale.setScalar(d.size);
    dummy.updateMatrix();
    ornMesh.setMatrixAt(i, dummy.matrix);
  }
  ornMesh.instanceMatrix.needsUpdate = true;
  group.add(ornMesh);

  /* ---------- 5. 树干 ---------- */
  // 粒子树是"光之雕塑"，实体圆柱只会变成底部一团黑饼 —— 这里不放几何体，
  // 只在地面处补一圈极淡的暖光裙裾，让树"长在"地上的感觉还在。
  const skirtMat = createGlowMaterial(0xffc98a, 0.30);
  skirtMat.depthWrite = false;
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.9, R * 2.9), skirtMat);
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = 0.02;
  skirt.renderOrder = 1;
  group.add(skirt);

  /* ---------- 6. 顶部之星 ---------- */
  const starMat = createStarMaterial(0xffe6ac);
  const star = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), starMat);
  star.position.y = H + 0.60;
  star.renderOrder = 8;
  group.add(star);

  const starGlowMat = createGlowMaterial(0xffd070, 0.22);
  const starGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), starGlowMat);
  starGlow.position.copy(star.position);
  starGlow.renderOrder = 7;
  group.add(starGlow);

  /* 星芒十字 sprite（更强的体积感） */
  const crossMat = createGlowMaterial(0xfff0c8, 0.15);
  const crossH = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.04), crossMat);
  const crossV = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 5.2), crossMat.clone());
  crossH.position.copy(star.position);
  crossV.position.copy(star.position);
  crossH.renderOrder = 6; crossV.renderOrder = 6;
  group.add(crossH, crossV);

  /* ---------- 7. 地面光池 ---------- */
  const poolMat = createGlowMaterial(0xffb960, 0.5);
  poolMat.depthWrite = false;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(R * 5.5, R * 5.5), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.012;
  pool.renderOrder = 1;
  group.add(pool);

  /* ---------- 8. 点光源 ---------- */
  const warmLight = new THREE.PointLight(0xffb35c, 26, 22, 1.9);
  warmLight.position.set(0, H * 0.42, 0);
  group.add(warmLight);

  const topLight = new THREE.PointLight(0xfff0c0, 34, 16, 2.0);
  topLight.position.set(0, H + 0.6, 0);
  group.add(topLight);

  const rimLight = new THREE.PointLight(0x5aa0ff, 16, 26, 2.0);
  rimLight.position.set(-6, 4.5, -5);
  group.add(rimLight);

  const rimLight2 = new THREE.PointLight(0xff6a8a, 10, 24, 2.0);
  rimLight2.position.set(6.5, 3.2, 4.5);
  group.add(rimLight2);

  /* ---------- 更新 ---------- */
  const tmpColor = new THREE.Color();
  let time = 0;

  function update(dt, t) {
    time = t;

    treeMat.uniforms.uTime.value = t;
    garlandMat.uniforms.uTime.value = t;
    bulbMat.uniforms.uTime.value = t;
    starMat.uniforms.uTime.value = t;
    starGlowMat.uniforms.uIntensity.value = 0.30 + 0.10 * Math.sin(t * 1.3);
    crossMat.uniforms.uIntensity.value = 0.17 + 0.07 * Math.sin(t * 1.1 + 1);
    ornMat.uniforms.uTime.value = t;
    poolMat.uniforms.uIntensity.value = 0.42 + 0.08 * Math.sin(t * 0.9);

    warmLight.intensity = 24 + 4.5 * Math.sin(t * 1.7) + 2 * Math.sin(t * 4.3);
    topLight.intensity = 30 + 7 * Math.sin(t * 2.1 + 0.7);
    rimLight.intensity = 14 + 3 * Math.sin(t * 0.8 + 2);
    rimLight2.intensity = 9 + 2.5 * Math.sin(t * 1.1 + 4);

    // 挂饰轻微浮动 + 悬停高亮
    for (let i = 0; i < ORN_COUNT; i++) {
      const d = ornData[i];
      const bob = Math.sin(t * d.speed + d.phase) * 0.012;
      dummy.position.set(d.base.x, d.base.y + bob, d.base.z);
      const s = d.size * (1 + d.hover * 0.45);
      dummy.scale.setScalar(s);
      dummy.rotation.set(t * 0.4 + d.phase, t * 0.6 + d.phase, 0);
      dummy.updateMatrix();
      ornMesh.setMatrixAt(i, dummy.matrix);
    }
    ornMesh.instanceMatrix.needsUpdate = true;

    // 星星缓慢自转（billboard 由 main 处理朝向）
    star.rotation.z = t * 0.18;
    starGlow.rotation.z = -t * 0.06;
  }

  /* 朝向相机（星星 & 十字光） */
  function faceCamera(camera) {
    star.quaternion.copy(camera.quaternion);
    starGlow.quaternion.copy(camera.quaternion);
    crossH.quaternion.copy(camera.quaternion);
    crossV.quaternion.copy(camera.quaternion);
  }

  /* 悬停高亮接口 */
  function setOrnamentHover(index, value) {
    if (index >= 0 && index < ORN_COUNT) {
      ornData[index].hover += (value - ornData[index].hover) * 0.25;
      if (value > 0.5) ornMat.uniforms.uHighlight.value += 0.06;
    }
  }

  /* 让装饰球生成"可点击"的代理网格（供 raycaster 用） */
  const hitSphere = new THREE.SphereGeometry(1, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.InstancedMesh(hitSphere, hitMat, ORN_COUNT);
  hitMesh.frustumCulled = false;
  hitMesh.userData.kind = 'ornament';
  group.add(hitMesh);

  // 每帧同步 hitMesh 变换（用放大后的尺寸便于点击）
  function syncHits() {
    for (let i = 0; i < ORN_COUNT; i++) {
      const d = ornData[i];
      dummy.position.copy(d.base);
      dummy.scale.setScalar(Math.max(0.14, d.size * 2.6));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      hitMesh.setMatrixAt(i, dummy.matrix);
    }
    hitMesh.instanceMatrix.needsUpdate = true;
  }
  syncHits();

  return {
    group,
    mesh: mainPoints,
    ornaments: ornMesh,
    ornData,
    ORN_COUNT,
    hitMesh,
    /** 亮灯进度 0..1 —— 用于开场粒子聚拢动画 */
    setReveal(p) {
      // 粒子从爆炸态聚拢：前半段主要完成聚拢，后半段再亮灯
      const form = Math.min(1, p / 0.72);
      treeMat.uniforms.uForm.value = form;
      garlandMat.uniforms.uForm.value = form;
      bulbMat.uniforms.uForm.value = form;
      treeMat.uniforms.uOpacity.value = 0.15 + 0.85 * p;
      garlandMat.uniforms.uOpacity.value = Math.max(0, p * 1.3 - 0.25) * GAR_OP;
      bulbMat.uniforms.uOpacity.value = Math.max(0, p * 1.5 - 0.45) * BULB_OP;
      starMat.uniforms.uIntensity.value = Math.max(0, p * 1.8 - 0.8);
      // 其他部件延后登场，等粒子基本归位
      ornMesh.visible = p > 0.72;
      skirt.visible = p > 0.5;
      pool.visible = p > 0.55;
      crossH.visible = crossV.visible = p > 0.7;
      starGlow.visible = p > 0.65;
      star.visible = p > 0.6;
    },
    setBulbSpeed(v) { bulbMat.uniforms.uSpeed.value = v; },
    setSizeScale(v) { treeMat.uniforms.uSizeScale.value = v; garlandMat.uniforms.uSizeScale.value = v * 1.35; },
    update,
    faceCamera,
    setOrnamentHover,
    syncHits,
    setPixelRatio(pr) {
      treeMat.uniforms.uPixelRatio.value = pr;
      garlandMat.uniforms.uPixelRatio.value = pr;
      bulbMat.uniforms.uPixelRatio.value = pr;
    },
    setViewFactor(v) {
      treeMat.uniforms.uViewFactor.value = v;
      garlandMat.uniforms.uViewFactor.value = v;
      bulbMat.uniforms.uViewFactor.value = v;
    },
    setHotspot(worldPos, power) {
      treeMat.uniforms.uHotspot.value.copy(worldPos);
      treeMat.uniforms.uHotPower.value += (power - treeMat.uniforms.uHotPower.value) * 0.16;
    },
    get ornamentsData() { return ornData; },
    star,
    starGlow,
  };
}
