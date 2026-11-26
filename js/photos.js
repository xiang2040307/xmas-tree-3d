/* =====================================================================
   photos.js — 拍立得相框挂饰
   - 默认照片为程序化生成的冬日场景（无需外部图片）
   - 支持用户拖拽/上传图片替换
   - 相框随机挂在树冠外壳上，轻微摆动，可点击放大
   ===================================================================== */
import * as THREE from 'three';
import { createGlowMaterial } from './shaders.js';

let seed = 1337;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
};
const rr = (a, b) => a + rnd() * (b - a);

/* ------------------------------------------------------------------ */
/* 程序化冬日照片                                                      */
/* ------------------------------------------------------------------ */
const SCENES = ['snowfield', 'forest', 'cabin', 'aurora', 'city', 'bokeh', 'tree', 'moon'];

function drawWinterScene(ctx, w, h, kind, idx) {
  const g = ctx;
  g.clearRect(0, 0, w, h);

  const palettes = [
    { sky: ['#0d2242', '#294c78', '#7b9fc9'], snow: ['#c9dcf2', '#eef6ff'], accent: '#ffd28a' },
    { sky: ['#12172e', '#3a2450', '#8a4f76'], snow: ['#c3cde8', '#f2ecf8'], accent: '#ffb0c8' },
    { sky: ['#06222e', '#12505a', '#2f9aa6'], snow: ['#bfe6ea', '#eafcff'], accent: '#ffe08a' },
    { sky: ['#1a1030', '#442a6b', '#9a6fc4'], snow: ['#cfc8ea', '#f4eeff'], accent: '#b6f0ff' },
  ];
  const pal = palettes[idx % palettes.length];

  /* --- 天空 --- */
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(0.55, pal.sky[1]);
  sky.addColorStop(1, pal.sky[2]);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  /* --- 星星 --- */
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w, y = rnd() * h * 0.55;
    const r = rnd() * 1.5 + 0.3;
    const a = rnd() * 0.85 + 0.15;
    g.beginPath();
    g.fillStyle = `rgba(255,250,235,${a})`;
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /* --- 月亮 / 光源 --- */
  if (kind === 'moon' || kind === 'aurora') {
    const mx = w * rr(0.62, 0.8), my = h * rr(0.16, 0.28), mr = w * 0.075;
    const halo = g.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 6);
    halo.addColorStop(0, 'rgba(255,250,225,0.55)');
    halo.addColorStop(0.4, 'rgba(200,225,255,0.14)');
    halo.addColorStop(1, 'rgba(180,210,255,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    g.beginPath(); g.fillStyle = '#fffdf2'; g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  }

  /* --- 极光 --- */
  if (kind === 'aurora') {
    for (let b = 0; b < 4; b++) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      const grad = g.createLinearGradient(0, h * 0.1, 0, h * 0.62);
      grad.addColorStop(0, 'rgba(80,255,200,0)');
      grad.addColorStop(0.45, `rgba(${60 + b * 30},${220 - b * 20},${190 + b * 12},0.20)`);
      grad.addColorStop(1, 'rgba(90,120,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(-w * 0.1, h * 0.6);
      for (let x = -w * 0.1; x <= w * 1.1; x += 12) {
        const y = h * 0.26 + Math.sin(x * 0.012 + b * 1.7) * h * 0.09 + Math.sin(x * 0.031) * h * 0.03;
        g.lineTo(x, y);
      }
      g.lineTo(w * 1.1, h * 0.66);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  /* --- 远山 --- */
  g.fillStyle = 'rgba(10,20,40,0.55)';
  g.beginPath();
  g.moveTo(0, h * 0.72);
  for (let x = 0; x <= w; x += 20) {
    g.lineTo(x, h * 0.62 + Math.sin(x * 0.009 + idx) * h * 0.05 + Math.sin(x * 0.023) * h * 0.02);
  }
  g.lineTo(w, h * 0.9); g.lineTo(0, h * 0.9); g.closePath(); g.fill();

  /* --- 雪地 --- */
  const snowG = g.createLinearGradient(0, h * 0.66, 0, h);
  snowG.addColorStop(0, pal.snow[1]);
  snowG.addColorStop(1, pal.snow[0]);
  g.fillStyle = snowG;
  g.beginPath();
  g.moveTo(0, h * 0.74);
  for (let x = 0; x <= w; x += 16) {
    g.lineTo(x, h * 0.70 + Math.sin(x * 0.015 + idx * 2) * h * 0.035);
  }
  g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();

  /* --- 场景元素 --- */
  if (kind === 'forest' || kind === 'tree') {
    const n = kind === 'tree' ? 1 : 7;
    for (let i = 0; i < n; i++) {
      const tx = kind === 'tree' ? w * 0.5 : w * rr(0.06, 0.94);
      const baseY = h * rr(0.70, 0.78);
      const th = kind === 'tree' ? h * 0.52 : h * rr(0.14, 0.30);
      const tw = th * 0.42;
      g.fillStyle = kind === 'tree' ? 'rgba(8,40,32,0.95)' : 'rgba(12,32,30,0.8)';
      for (let k = 0; k < 3; k++) {
        const yy = baseY - th * (k * 0.30);
        const ww = tw * (1 - k * 0.24);
        g.beginPath();
        g.moveTo(tx, yy - th * 0.52);
        g.lineTo(tx - ww, yy);
        g.lineTo(tx + ww, yy);
        g.closePath(); g.fill();
      }
      // 树上的灯
      if (kind === 'tree') {
        for (let k = 0; k < 40; k++) {
          const a = rnd() * Math.PI * 2;
          const t = rnd();
          const rad = tw * (1 - t * 0.85) * 0.9;
          const x = tx + Math.cos(a) * rad;
          const y = baseY - t * th * 0.92;
          g.beginPath();
          g.fillStyle = `rgba(255,${190 + rnd() * 60 | 0},${110 + rnd() * 100 | 0},${0.5 + rnd() * 0.5})`;
          g.arc(x, y, rr(0.8, 2.2), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  if (kind === 'cabin') {
    const cx = w * 0.56, cy = h * 0.72;
    const cw = w * 0.22, ch = h * 0.13;
    g.fillStyle = '#3b2a25';
    g.fillRect(cx - cw / 2, cy - ch, cw, ch);
    g.fillStyle = '#241a18';
    g.beginPath();
    g.moveTo(cx - cw * 0.62, cy - ch);
    g.lineTo(cx, cy - ch * 2.05);
    g.lineTo(cx + cw * 0.62, cy - ch);
    g.closePath(); g.fill();
    // 窗
    const wg = g.createRadialGradient(cx, cy - ch * 0.55, 1, cx, cy - ch * 0.55, cw * 0.42);
    wg.addColorStop(0, 'rgba(255,225,160,0.95)');
    wg.addColorStop(1, 'rgba(255,190,90,0.05)');
    g.fillStyle = wg;
    g.beginPath();
    g.arc(cx, cy - ch * 0.55, cw * 0.26, 0, Math.PI * 2);
    g.fill();
    // 烟囱与炊烟
    g.fillStyle = 'rgba(200,215,235,0.16)';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(cx + cw * 0.3 + i * 6, cy - ch * 2.1 - i * h * 0.035, 5 + i * 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  if (kind === 'city') {
    for (let i = 0; i < 12; i++) {
      const bw = w * rr(0.04, 0.09);
      const bh = h * rr(0.10, 0.30);
      const bx = rnd() * (w - bw);
      const by = h * 0.74 - bh;
      g.fillStyle = 'rgba(9,16,30,0.9)';
      g.fillRect(bx, by, bw, bh);
      for (let wy = by + 4; wy < h * 0.72; wy += 7) {
        for (let wx = bx + 3; wx < bx + bw - 3; wx += 6) {
          if (rnd() < 0.42) {
            g.fillStyle = `rgba(255,${200 + rnd() * 45 | 0},${140 + rnd() * 60 | 0},${0.35 + rnd() * 0.5})`;
            g.fillRect(wx, wy, 3, 3.5);
          }
        }
      }
    }
  }

  if (kind === 'snowfield' || kind === 'bokeh') {
    // 前景树影剪影
    g.fillStyle = 'rgba(4,18,14,0.85)';
    const tx = w * 0.16, by = h * 0.82, th = h * 0.38, tw = th * 0.4;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(tx, by - th * (0.55 + k * 0.28));
      g.lineTo(tx - tw * (1 - k * 0.22), by - th * k * 0.28);
      g.lineTo(tx + tw * (1 - k * 0.22), by - th * k * 0.28);
      g.closePath(); g.fill();
    }
  }

  if (kind === 'bokeh') {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h * 0.8;
      const r = rr(6, 26);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const hue = 30 + rnd() * 45;
      gr.addColorStop(0, `hsla(${hue}, 90%, 78%, ${rr(0.10, 0.30)})`);
      gr.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`);
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  /* --- 飘雪 --- */
  for (let i = 0; i < 130; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = Math.pow(rnd(), 2.2) * 3.4 + 0.5;
    g.beginPath();
    g.fillStyle = `rgba(255,255,255,${0.18 + rnd() * 0.65})`;
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /* --- 暗角 --- */
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
}

/* 相框：白边拍立得 + 底部手写感说明 */
function makePolaroidTexture(kind, caption, idx) {
  const W = 512, H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');

  // 卡纸阴影底（透明外框用于柔和边缘）
  const pad = 8;
  const inner = { x: pad + 16, y: pad + 16, w: W - (pad + 16) * 2, h: H - (pad + 16) * 2 - 92 };

  // 卡纸
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 22;
  g.shadowOffsetY = 8;
  g.fillStyle = '#f7f3e8';
  roundRect(g, pad, pad, W - pad * 2, H - pad * 2, 10);
  g.fill();
  g.restore();

  // 内页照片
  g.save();
  g.beginPath();
  roundRect(g, inner.x, inner.y, inner.w, inner.h, 4);
  g.clip();

  const sub = document.createElement('canvas');
  sub.width = inner.w; sub.height = inner.h;
  const sg = sub.getContext('2d');
  drawWinterScene(sg, inner.w, inner.h, kind, idx);
  g.drawImage(sub, inner.x, inner.y);

  // 玻璃反光
  const gloss = g.createLinearGradient(inner.x, inner.y, inner.x + inner.w, inner.y + inner.h);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)');
  gloss.addColorStop(0.35, 'rgba(255,255,255,0.03)');
  gloss.addColorStop(1, 'rgba(255,255,255,0.0)');
  g.fillStyle = gloss;
  g.fillRect(inner.x, inner.y, inner.w, inner.h);
  g.restore();

  // 内页边框
  g.strokeStyle = 'rgba(120,110,95,0.28)';
  g.lineWidth = 2;
  g.beginPath();
  roundRect(g, inner.x, inner.y, inner.w, inner.h, 4);
  g.stroke();

  // 底部手写体说明
  g.fillStyle = 'rgba(60,52,42,0.82)';
  g.font = `italic ${Math.round(W * 0.052)}px "Songti SC", "Palatino Linotype", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(caption, W / 2, inner.y + inner.h + 48, inner.w - 24);

  // 细小的金色描边
  g.strokeStyle = 'rgba(196,158,86,0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  roundRect(g, pad + 7, pad + 7, W - (pad + 7) * 2, H - (pad + 7) * 2, 8);
  g.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* 用户上传图片 -> 拍立得 */
function makeUploadedTexture(image, caption) {
  const W = 512, H = 640;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const pad = 8;
  const inner = { x: pad + 16, y: pad + 16, w: W - (pad + 16) * 2, h: H - (pad + 16) * 2 - 92 };

  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 22;
  g.shadowOffsetY = 8;
  g.fillStyle = '#f7f3e8';
  g.beginPath();
  roundRect(g, pad, pad, W - pad * 2, H - pad * 2, 10);
  g.fill();
  g.restore();

  g.save();
  g.beginPath();
  roundRect(g, inner.x, inner.y, inner.w, inner.h, 4);
  g.clip();
  g.fillStyle = '#10161f';
  g.fillRect(inner.x, inner.y, inner.w, inner.h);

  // cover 裁剪
  const iw = image.width, ih = image.height;
  const scale = Math.max(inner.w / iw, inner.h / ih);
  const dw = iw * scale, dh = ih * scale;
  g.drawImage(image, inner.x + (inner.w - dw) / 2, inner.y + (inner.h - dh) / 2, dw, dh);
  g.restore();

  g.fillStyle = 'rgba(60,52,42,0.82)';
  g.font = `italic ${Math.round(W * 0.052)}px "Songti SC", "Palatino Linotype", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(caption, W / 2, inner.y + inner.h + 48, inner.w - 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* 相框挂饰系统                                                        */
/* ------------------------------------------------------------------ */
const CAPTIONS = [
  '圣诞快乐', 'Merry Xmas', '雪落无声', '愿你所愿', '平安喜乐',
  'Wish & Light', '星河入梦', '冬夜微光', '一路生花', '好景常在',
];

export function buildPhotos({ treeHeight = 7.4, treeRadius = 2.55, count = 7, images = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'photos';

  const items = [];
  const hitList = [];

  const aspect = 640 / 512;
  const baseH = 0.78;
  const baseW = baseH / aspect;

  const makeItem = (tex, caption, i) => {
    // 不要挂到树根附近：底部照片会飘在地面上显得"掉下来了"
    const t = 0.22 + (i / Math.max(1, count)) * 0.60 + rr(-0.025, 0.025);
    const ang = (i / count) * Math.PI * 2 * 1.35 + rr(-0.25, 0.25);
    const rad = treeRadius * Math.pow(1 - t, 0.82) * rr(1.06, 1.18);

    const holder = new THREE.Group();
    holder.position.set(Math.cos(ang) * rad, t * treeHeight, Math.sin(ang) * rad);

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: true,
      side: THREE.DoubleSide, toneMapped: false,
    });
    mat.color.setScalar(0.96);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(baseW, baseH), mat);
    mesh.renderOrder = 10;
    holder.add(mesh);

    // 背后柔光
    const glowMat = createGlowMaterial(0xffd693, 0.34);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(baseW * 3.4, baseH * 3.0), glowMat);
    glow.position.z = -0.02;
    glow.renderOrder = 9;
    holder.add(glow);

    // 挂绳
    const stringGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, baseH * 0.5, 0),
      new THREE.Vector3(0, baseH * 0.5 + 0.28, 0.01),
    ]);
    const stringMat = new THREE.LineBasicMaterial({
      color: 0xd8b171, transparent: true, opacity: 0.5, depthWrite: false,
    });
    holder.add(new THREE.Line(stringGeo, stringMat));

    // 光点
    const sparkMat = createGlowMaterial(0xfff2cf, 1.15);
    const spark = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), sparkMat);
    spark.position.set(0, baseH * 0.5 + 0.29, 0.02);
    spark.renderOrder = 11;
    holder.add(spark);

    group.add(holder);

    const item = {
      holder, mesh, mat, glow, glowMat, spark, sparkMat,
      caption, index: i,
      phase: rr(0, Math.PI * 2), speed: rr(0.35, 0.8),
      baseY: holder.position.y,
      baseAngle: Math.atan2(holder.position.z, holder.position.x),
      baseRadius: rad,
      hover: 0,
      spin: 0,
      t,
      ...(tex.userData || {}),
    };
    items.push(item);
    hitList.push(mesh);
    mesh.userData.photoIndex = i;
    return item;
  };

  // 用户照片（来自 photos/ 文件夹）优先；没有则用程序化冬日场景
  for (let i = 0; i < count; i++) {
    const cap = CAPTIONS[i % CAPTIONS.length];
    if (images[i]) {
      const tex = makeUploadedTexture(images[i], cap);
      const it = makeItem(tex, cap, i);
      it.kind = 'user';
      it.src = images[i].src || '';
    } else {
      const kind = SCENES[i % SCENES.length];
      const tex = makePolaroidTexture(kind, cap, i);
      const it = makeItem(tex, cap, i);
      it.kind = kind;
    }
  }

  /* 朝向相机 + 摆动 */
  const tmpV = new THREE.Vector3();
  function update(t, camera, treeGroup) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      // 沿树缓慢公转 + 上下浮动
      const ang = it.baseAngle + t * 0.055 + Math.sin(t * it.speed + it.phase) * 0.06;
      const rad = it.baseRadius + Math.sin(t * it.speed * 0.7 + it.phase) * 0.05;
      const y = it.baseY + Math.sin(t * it.speed * 0.9 + it.phase) * 0.055;

      it.holder.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad);

      // 始终朝向相机（略带上仰的摆角）
      it.holder.quaternion.copy(camera.quaternion);
      it.holder.rotateZ(Math.sin(t * it.speed * 0.8 + it.phase) * 0.055);
      it.holder.rotateX(Math.sin(t * it.speed * 0.6 + it.phase * 1.7) * 0.045);

      // 悬停放大
      const target = it.hover > 0.5 ? 1.16 : 1.0;
      const s = it.mesh.scale.x + (target - it.mesh.scale.x) * 0.14;
      it.mesh.scale.setScalar(s);
      it.glow.scale.setScalar(s);
      it.spark.scale.setScalar(1 + it.hover * 0.5);

      it.glowMat.uniforms.uIntensity.value = 0.26 + 0.20 * it.hover + 0.06 * Math.sin(t * 1.6 + it.phase);
      it.sparkMat.uniforms.uIntensity.value = 0.75 + 0.55 * it.hover + 0.25 * Math.sin(t * 2.4 + it.phase);
      it.mat.color.setScalar(0.90 + 0.16 * it.hover);
    }
  }

  /* 替换某张照片（用户上传） */
  function replaceTexture(index, image, caption) {
    const it = items[index];
    if (!it) return;
    const tex = makeUploadedTexture(image, caption || '我的照片');
    if (it.mat.map) it.mat.map.dispose();
    it.mat.map = tex;
    it.mat.needsUpdate = true;
    it.caption = caption || '我的照片';
  }

  /* 新增一张（超出预置数量时复用第一张的位置循环） */
  function addPhoto(image, caption) {
    const idx = items.length % count;
    replaceTexture(idx, image, caption);
    return idx;
  }

  function setHover(idx, on) {
    if (items[idx]) items[idx].hover = on ? 1 : 0;
  }

  return {
    group, items, hitList,
    update, replaceTexture, addPhoto, setHover,
    get captions() { return items.map((i) => i.caption); },
    count: items.length,
  };
}
