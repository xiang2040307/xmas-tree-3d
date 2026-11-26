/* =====================================================================
   wishes.js — 愿望光球：写好祝福变成发光挂饰，绕着圣诞树升空
   ===================================================================== */
import * as THREE from 'three';

/* ---------- 圆角矩形 ---------- */
function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------- 文字贴图 ---------- */
function makeWishTexture(text) {
  const PAD = 28;
  const FS = 64;
  const maxW = 900;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `500 ${FS}px "Songti SC", "Palatino Linotype", Georgia, serif`;

  // 自动换行
  const chars = Array.from(text);
  const lines = [];
  let cur = '';
  for (const ch of chars) {
    const test = cur + ch;
    if (measure.measureText(test).width > maxW && cur) {
      lines.push(cur); cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  const lineH = FS * 1.42;
  const textW = Math.max(...lines.map((l) => measure.measureText(l).width), 80);
  const textH = lineH * lines.length;

  const W = Math.ceil(textW + PAD * 2);
  const H = Math.ceil(textH + PAD * 2);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // 底板：暗夜玻璃 + 金色描边
  g.save();
  g.fillStyle = 'rgba(10, 18, 32, 0.62)';
  g.beginPath();
  roundRect(g, 2, 2, W - 4, H - 4, 26);
  g.fill();
  g.restore();

  g.strokeStyle = 'rgba(245, 212, 137, 0.72)';
  g.lineWidth = 2;
  g.beginPath();
  roundRect(g, 2, 2, W - 4, H - 4, 26);
  g.stroke();

  // 内层微光
  g.strokeStyle = 'rgba(255, 246, 214, 0.18)';
  g.lineWidth = 1;
  g.beginPath();
  roundRect(g, 8, 8, W - 16, H - 16, 21);
  g.stroke();

  // 文字
  g.font = `500 ${FS}px "Songti SC", "Palatino Linotype", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255, 220, 150, 0.95)';
  g.shadowBlur = 26;
  g.fillStyle = '#fff4d8';
  lines.forEach((l, i) => {
    g.fillText(l, W / 2, PAD + lineH * (i + 0.5));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, W, H };
}

/* ---------- 光球光晕贴图（径向渐变） ---------- */
function makeGlowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,246,220,0.95)');
  grd.addColorStop(0.28, 'rgba(255,215,140,0.42)');
  grd.addColorStop(0.62, 'rgba(255,190,110,0.10)');
  grd.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const GLOW_TEX = (() => {
  if (typeof document === 'undefined') return null;
  return makeGlowTexture();
})();

/* ------------------------------------------------------------------ */
export function createWishSystem({ treeHeight = 7.4, treeRadius = 2.55 } = {}) {
  const group = new THREE.Group();
  group.name = 'wishes';

  const wishes = [];
  const MAX = 20;

  const PALETTE = [0xffd489, 0xffb0c8, 0xa8e0ff, 0xd8b6ff, 0xb8ffd8];

  function spawn(text, camera) {
    const { tex, W, H } = makeWishTexture(text || '圣诞快乐');
    const aspect = W / H;
    const panelH = 0.30;
    const panelW = panelH * aspect;

    const holder = new THREE.Group();
    holder.renderOrder = 30;

    // 面板
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), mat);
    panel.renderOrder = 31;
    holder.add(panel);

    // 光球
    const color = PALETTE[wishes.length % PALETTE.length];
    const spriteMat = new THREE.SpriteMaterial({
      map: GLOW_TEX, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    });
    const orb = new THREE.Sprite(spriteMat);
    orb.scale.setScalar(0.55);
    orb.position.y = panelH * 0.72;
    orb.renderOrder = 30;
    holder.add(orb);

    // 起点：树脚附近随机位置
    const startAng = Math.random() * Math.PI * 2;
    const startY = 0.6 + Math.random() * 1.2;
    holder.position.set(
      Math.cos(startAng) * treeRadius * 1.5,
      startY,
      Math.sin(startAng) * treeRadius * 1.5
    );

    group.add(holder);

    const w = {
      holder, panel, mat, orb, spriteMat, tex,
      text,
      born: performance.now() / 1000,
      life: 13 + Math.random() * 4,
      ang: startAng,
      angVel: 0.25 + Math.random() * 0.25,
      radius: treeRadius * (1.35 + Math.random() * 0.35),
      riseSpeed: 0.62 + Math.random() * 0.30,
      swayPhase: Math.random() * Math.PI * 2,
      fadeIn: 0,
      panelH, panelW,
    };
    wishes.push(w);

    // 限制数量
    while (wishes.length > MAX) {
      const old = wishes.shift();
      disposeWish(old);
    }
    return w;
  }

  function disposeWish(w) {
    group.remove(w.holder);
    w.panel.geometry.dispose();
    w.mat.dispose();
    w.tex.dispose();
    w.spriteMat.dispose();
  }

  function update(t, camera) {
    const now = t;
    for (let i = wishes.length - 1; i >= 0; i--) {
      const w = wishes[i];
      const age = now - w.born;

      w.fadeIn = Math.min(1, w.fadeIn + 0.02);

      // 螺旋上升
      w.ang += w.angVel * 0.016;
      const y = 0.6 + age * w.riseSpeed;
      const r = w.radius + Math.sin(now * 0.7 + w.swayPhase) * 0.28;
      w.holder.position.set(Math.cos(w.ang) * r, y, Math.sin(w.ang) * r);

      // 面向相机
      w.holder.quaternion.copy(camera.quaternion);
      w.holder.rotateZ(Math.sin(now * 1.1 + w.swayPhase) * 0.05);

      // 淡入淡出
      let alpha = w.fadeIn;
      const remain = w.life - age;
      if (remain < 0) { alpha = 0; }
      else if (remain < 2.6) alpha = remain / 2.6;
      alpha = Math.max(0, Math.min(1, alpha));

      w.mat.opacity = alpha;
      w.spriteMat.opacity = alpha * (0.85 + 0.15 * Math.sin(now * 3.0 + w.swayPhase));
      const pulse = 0.5 + 0.16 * Math.sin(now * 2.6 + w.swayPhase);
      w.orb.scale.setScalar(pulse * (1 + w.panelW * 0.25));
      w.panel.scale.setScalar(1 + 0.02 * Math.sin(now * 2.0 + w.swayPhase));

      if (age > w.life + 0.4) {
        wishes.splice(i, 1);
        disposeWish(w);
      }
    }
  }

  function clear() {
    for (const w of wishes) disposeWish(w);
    wishes.length = 0;
  }

  return { group, spawn, update, clear, get count() { return wishes.length; } };
}
