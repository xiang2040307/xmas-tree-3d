/* =====================================================================
   shaders.js — GLSL 源码与材质工厂
   所有程序化材质集中在这里，避免散落在各处难以调参。
   ===================================================================== */
import * as THREE from 'three';

const HEAD = /* glsl */`
  #define TAU 6.28318530718
  #define HDR_MAX 14.0
  float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash21(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise2(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
               mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i = 0; i < 5; i++){ v += a * noise2(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  /* 把输出压回有限区间：几千个 additive 点在同一像素上相加时，
     半精度浮点缓冲会溢出成 Inf，bloom 的高斯模糊再把它抹成一大块黑。
     这里统一做 NaN/Inf 清洗 + HDR 上限。 */
  vec3 hdrSafe(vec3 c){
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    return clamp(c, vec3(0.0), vec3(HDR_MAX));
  }
  float aSafe(float a){
    if (isnan(a) || isinf(a)) a = 0.0;
    return clamp(a, 0.0, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* 1. 树体微粒                                                         */
/* ------------------------------------------------------------------ */
export const TREE_VERT = /* glsl */`
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aFlare;
  attribute float aY;
  attribute vec3  aExplode;   // 开场爆炸的散开目标

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uViewFactor;
  uniform float uSizeScale;
  uniform float uTwinkle;
  uniform float uBreath;
  uniform float uForm;        // 0=完全爆炸, 1=聚拢成树

  varying vec3  vColor;
  varying float vAlpha;
  varying float vFlare;
  varying float vGlow;

  void main() {
    // 开场：粒子从爆炸态（aExplode）聚拢到树形态（position）
    // easeOutCubic，让前段快、末段缓，聚拢更有"吸力"感
    float f = clamp(uForm, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - f, 3.0);
    vec3 pos = mix(aExplode, position, e);

    // 爆炸态时粒子缓慢自转 + 呼吸扩散，聚拢后归位
    float chaos = 1.0 - e;
    float spin = uTime * 0.12 * chaos;
    float cs = cos(spin), sn = sin(spin);
    pos.xz = mat2(cs, -sn, sn, cs) * pos.xz;
    pos += chaos * 0.15 * vec3(
      sin(uTime * 0.7 + aPhase),
      cos(uTime * 0.6 + aPhase * 1.3),
      sin(uTime * 0.5 + aPhase * 0.7)
    );

    // 轻微呼吸式浮动，营造“活着的树”
    float b = sin(uTime * 0.55 + aY * 0.9 + aPhase) * 0.035 * uBreath;
    pos.x += b;
    pos.z += cos(uTime * 0.47 + aY * 1.1 + aPhase) * 0.03 * uBreath;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float tw = 0.45 + 0.55 * sin(uTime * aSpeed + aPhase);
    tw = mix(1.0, tw, uTwinkle);

    // 顶部更亮、底部更含蓄
    float hFade = smoothstep(-0.02, 0.35, aY) * 0.55 + 0.45;

    float depth = max(1.0, -mv.z);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * uViewFactor * (0.72 + 0.55 * tw) / depth;
    gl_PointSize = clamp(gl_PointSize, 0.7, 64.0);

    vColor  = aColor;
    vAlpha  = hFade * (0.55 + 0.45 * tw);
    vFlare  = aFlare;
    vGlow   = tw;
  }
`;

export const TREE_FRAG = /* glsl */`
  ${HEAD}
  uniform float uIntensity;
  uniform float uOpacity;
  uniform vec3  uHotspot;
  uniform float uHotPower;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vFlare;
  varying float vGlow;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    uv.y = -uv.y;
    float d = length(uv) * 2.0;

    // 柔和核心
    float core = smoothstep(1.0, 0.0, d);
    float soft = pow(core, 2.6);
    float halo = pow(core, 0.75) * 0.34;

    // 十字星芒（少数粒子）
    vec2 av = abs(uv);
    float rayH = smoothstep(0.5, 0.0, av.y) * pow(max(0.0, 1.0 - av.x * 13.0), 3.0);
    float rayV = smoothstep(0.5, 0.0, av.x) * pow(max(0.0, 1.0 - av.y * 13.0), 3.0);
    float flare = (rayH + rayV) * 1.45 * vFlare;

    float alpha = (soft * 1.05 + halo + flare) * vAlpha * uOpacity;
    if (alpha < 0.004) discard;

    // 热点增强（鼠标/手势悬停时局部提亮）
    vec3 tint = vColor * (0.52 + 1.05 * vGlow);
    tint += vec3(1.0, 0.92, 0.75) * uHotPower * (0.4 + flare);

    gl_FragColor = vec4(hdrSafe(tint * uIntensity), aSafe(alpha));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 2. 彩灯串（跑动追逐）                                               */
/* ------------------------------------------------------------------ */
export const BULB_VERT = /* glsl */`
  attribute float aT;      // 沿灯串的位置 0..1
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;
  attribute vec3  aExplode;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uViewFactor;
  uniform float uSpeed;
  uniform float uForm;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vPulse;

  void main() {
    float f = clamp(uForm, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - f, 3.0);
    vec3 pos = mix(aExplode, position, e);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // 追逐光点：沿 aT 传播的亮波
    float wave = fract(aT * 2.0 - uTime * uSpeed);
    float chase = smoothstep(0.72, 1.0, wave) * 0.9;

    float tw = 0.55 + 0.45 * sin(uTime * 3.1 + aPhase);
    vPulse = chase + tw * 0.45;

    float depth = max(1.0, -mv.z);
    gl_PointSize = aSize * (1.0 + chase * 1.1) * uPixelRatio * uViewFactor / depth;
    gl_PointSize = clamp(gl_PointSize, 1.0, 46.0);

    vColor = aColor;
    vAlpha = 0.55 + 0.45 * vPulse;
  }
`;

export const BULB_FRAG = /* glsl */`
  ${HEAD}
  uniform float uIntensity;
  uniform float uOpacity;
  varying vec3  vColor;
  varying float vAlpha;
  varying float vPulse;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float glow = pow(core, 3.2) + pow(core, 0.85) * 0.30;
    float alpha = glow * vAlpha * uOpacity;
    if (alpha < 0.004) discard;
    vec3 col = mix(vColor, vec3(1.0, 0.97, 0.88), pow(core, 5.0) * 0.85);
    gl_FragColor = vec4(hdrSafe(col * uIntensity * (0.7 + 1.4 * vPulse)), aSafe(alpha));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 3. 雪                                                               */
/* ------------------------------------------------------------------ */
export const SNOW_VERT = /* glsl */`
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSway;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uViewFactor;
  uniform float uHeight;
  uniform float uRadius;
  uniform float uWind;
  uniform vec3  uCamPos;
  uniform float uOpacity;

  varying float vAlpha;
  varying float vDist;
  varying float vSparkle;

  void main() {
    vec3 pos = position;

    // 下落 + 循环
    float fall = mod(pos.y - uTime * aSpeed, uHeight);
    pos.y = fall;

    // 横向飘摆
    pos.x += sin(uTime * 0.7 + aPhase) * aSway + uWind * fall * 0.06;
    pos.z += cos(uTime * 0.55 + aPhase * 1.7) * aSway;

    // 水平循环（围绕相机），保证永远有雪
    vec2 rel = pos.xz - uCamPos.xz;
    rel = mod(rel + uRadius, uRadius * 2.0) - uRadius;
    pos.xz = uCamPos.xz + rel;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(1.0, -mv.z);
    // 近处雪花淡出 + 尺寸收敛：避免大量 additive 雪片糊成一片白
    float nearFade = smoothstep(2.2, 7.0, depth);
    // 只让"中景"的雪可见，极近与极远都压掉
    float farFade = smoothstep(uRadius * 2.4, uRadius * 0.35, abs(rel.x));
    gl_PointSize = clamp(aSize * uPixelRatio * uViewFactor / depth, 0.6, 11.0);
    // 透视压缩：越近的雪越大 -> 额外压一次
    gl_PointSize *= mix(1.0, 0.55, smoothstep(3.0, 1.0, depth));

    float tw = 0.7 + 0.3 * sin(uTime * 2.3 + aPhase * 5.0);
    vSparkle = tw;
    vDist = depth;
    vAlpha = uOpacity * nearFade * farFade;
    vAlpha *= smoothstep(uRadius * 2.4, uRadius * 0.35, abs(rel.y));
  }
`;

export const SNOW_FRAG = /* glsl */`
  ${HEAD}
  varying float vAlpha;
  varying float vDist;
  varying float vSparkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.01, d);
    // 更小的实心核 + 柔边，取代原来超大发光球
    float a = pow(core, 2.4) * vAlpha * vSparkle;
    if (a < 0.004) discard;
    vec3 col = mix(vec3(0.72, 0.82, 1.0), vec3(0.94, 0.97, 1.0), core);
    gl_FragColor = vec4(hdrSafe(col * 0.72), aSafe(a * 0.62));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 4. 冰面 / 地面                                                      */
/* ------------------------------------------------------------------ */
export const GROUND_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const GROUND_FRAG = /* glsl */`
  ${HEAD}
  uniform float uTime;
  uniform vec3  uCenter;
  uniform float uRadius;
  uniform vec3  uGold;

  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    float r = length(vWorld.xz - uCenter.xz);
    float radial = smoothstep(uRadius, uRadius * 0.12, r);

    // 冰面纹理：低频霜纹 + 细碎裂纹
    vec2 p = vWorld.xz * 0.55;
    float frost = fbm(p * 1.4 + uTime * 0.012);
    float veins = fbm(p * 5.0 - uTime * 0.02);
    float cracks = smoothstep(0.52, 0.60, abs(veins - 0.5) * 2.0) * 0.35;

    // 树根处的金色暖光
    float glow = exp(-r * 0.62) * 0.95;
    float pool = exp(-pow(r * 0.9, 2.0)) * 0.55;

    // 缓慢流动的极光反射
    float aur = sin(vWorld.x * 0.4 + uTime * 0.35) * cos(vWorld.z * 0.33 - uTime * 0.27);
    aur = pow(max(0.0, aur), 3.0) * 0.16;

    vec3 base = vec3(0.035, 0.055, 0.095);
    vec3 ice  = mix(base, vec3(0.30, 0.44, 0.62), frost * 0.42 + 0.10);
    ice += vec3(0.55, 0.72, 0.95) * cracks * radial;
    ice += uGold * (glow * 0.80 + pool * 0.42);
    ice += vec3(0.35, 0.60, 0.85) * aur * radial;

    float alpha = radial * (0.52 + frost * 0.30);
    // 边缘彻底融入黑暗
    alpha *= smoothstep(1.0, 0.72, r / uRadius);
    if (alpha < 0.003) discard;

    gl_FragColor = vec4(hdrSafe(ice), aSafe(alpha));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 5. 天幕                                                             */
/* ------------------------------------------------------------------ */
export const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // 永远在远平面
  }
`;

export const SKY_FRAG = /* glsl */`
  ${HEAD}
  uniform float uTime;
  uniform vec3  uTop;
  uniform vec3  uBottom;
  uniform vec3  uHorizon;

  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 col = mix(uBottom, uTop, pow(h, 1.25));
    // 地平线暖辉
    float horizonBand = pow(1.0 - abs(d.y), 8.0);
    col = mix(col, uHorizon, horizonBand * 0.55);

    // 星云
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
    float neb = fbm(sp * vec2(1.6, 2.4) + 11.0);
    float neb2 = fbm(sp * vec2(4.1, 3.3) - 4.0 + uTime * 0.004);
    col += vec3(0.16, 0.30, 0.55) * pow(neb, 2.6) * 0.85;
    col += vec3(0.34, 0.16, 0.42) * pow(neb2, 3.2) * 0.55;

    gl_FragColor = vec4(hdrSafe(col), 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 6. 背景星点                                                         */
/* ------------------------------------------------------------------ */
export const STARFIELD_VERT = /* glsl */`
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vA;
  varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.35 + 0.65 * pow(abs(sin(uTime * 0.9 + aPhase)), 3.0);
    vA = tw;
    vC = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.75), fract(aPhase * 7.0));
    gl_PointSize = clamp(aSize * uPixelRatio * 1.6, 0.8, 8.0);
  }
`;

export const STARFIELD_FRAG = /* glsl */`
  ${HEAD}
  varying float vA;
  varying vec3 vC;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float a = pow(core, 2.2) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(hdrSafe(vC * (0.8 + core)), aSafe(a));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 7. 顶部之星                                                         */
/* ------------------------------------------------------------------ */
export const STAR_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const STAR_FRAG = /* glsl */`
  ${HEAD}
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3  uColor;

  varying vec2 vUv;

  float starShape(vec2 p, float points, float inner) {
    float ang = atan(p.y, p.x);
    float r = length(p);
    float seg = TAU / points;
    float a = mod(ang + seg * 0.5, seg) / seg;
    a = abs(a - 0.5) * 2.0;
    float edge = mix(1.0, inner, a);
    return r / edge;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float rot = uTime * 0.22;

    // 五角星实体
    float d = starShape(p, 5.0, 0.44);
    float body = smoothstep(1.02, 0.90, d);
    float bodyGlow = smoothstep(1.5, 0.35, d) * 0.55;

    // 外圈光晕
    float halo = exp(-length(p) * 3.2) * 0.55;
    float halo2 = exp(-length(p) * 1.35) * 0.20;

    // 光芒（四向 + 旋转的细芒）
    float rays = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = rot + float(i) * TAU * 0.25;
      vec2 dir = vec2(cos(a), sin(a));
      float along = dot(p, dir);
      float perp = abs(dot(p, vec2(-dir.y, dir.x)));
      float len = 0.98;
      float w = pow(max(0.0, 1.0 - perp * 9.0), 3.0) * smoothstep(len, 0.0, abs(along));
      rays += w;
    }
    rays *= 0.55;

    float pulse = 0.88 + 0.12 * sin(uTime * 1.7);
    float a = (body * 1.0 + bodyGlow + halo + halo2 + rays) * uIntensity * pulse;
    // 圆形软边遮罩：去掉方形平面在四角残留的直角硬边
    a *= smoothstep(1.0, 0.35, length(p));
    vec3 col = mix(uColor, vec3(1.0, 0.99, 0.94), body * 0.75 + halo * 0.4);
    gl_FragColor = vec4(hdrSafe(col * (1.0 + body * 1.6)), clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 8. 挂饰（菲涅尔球）                                                 */
/* ------------------------------------------------------------------ */
export const ORNAMENT_VERT = /* glsl */`
  attribute vec3  aColor;
  attribute float aPhase;

  uniform float uTime;

  varying vec3  vColor;
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vPulse;

  void main() {
    vec4 wp = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * wp;
    gl_Position = projectionMatrix * mv;

    mat3 nm = mat3(instanceMatrix);
    vNormalW = normalize(normalMatrix * (nm * normal));
    vViewDir = normalize(-mv.xyz);

    vColor = aColor;
    vPulse = 0.6 + 0.4 * sin(uTime * 1.6 + aPhase);
  }
`;

export const ORNAMENT_FRAG = /* glsl */`
  ${HEAD}
  uniform float uTime;
  uniform float uHighlight;
  varying vec3  vColor;
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vPulse;

  void main() {
    float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), 2.6);
    vec3 col = vColor * (0.24 + vPulse * 0.30);
    col += vec3(1.0, 0.86, 0.62) * fres * 1.45;
    // 高光点
    float spec = pow(max(0.0, dot(normalize(vNormalW), normalize(vec3(-0.45, 0.75, 0.5)))), 42.0);
    col += vec3(1.0) * spec * 1.6;
    col *= 1.0 + uHighlight * 1.5;
    gl_FragColor = vec4(hdrSafe(col), 1.0);
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 9. 光晕 Sprite（照片/挂饰的辉光）                                   */
/* ------------------------------------------------------------------ */
export const GLOW_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
export const GLOW_FRAG = /* glsl */`
  ${HEAD}
  uniform vec3  uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    // 收紧衰减：避免大尺寸叠加平面把整棵树洗白
    float glow = exp(-d * d * 7.5) * 0.82 + exp(-d * 3.4) * 0.13;
    float a = glow * uIntensity;
    // 方形软边：PlaneGeometry 的边界在 alpha 上必须归零，否则 bloom 会把
    // 这块方形平面的直角边界放大成屏幕上的亮矩形。
    a *= smoothstep(1.0, 0.55, max(abs(p.x), abs(p.y)));
    if (a < 0.004) discard;
    gl_FragColor = vec4(hdrSafe(uColor * (0.62 + glow * 0.55)), aSafe(a));
    #include <colorspace_fragment>
  }
`;

/* ------------------------------------------------------------------ */
/* 工厂函数                                                            */
/* ---------------------------------------------------------------- */
const FALLBACK_TREE_FRAG = TREE_FRAG;

export function createTreeMaterial({
  intensity = 1.0, opacity = 1.0, twinkle = 1.0, sizeScale = 1.0
} = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: TREE_VERT,
    fragmentShader: FALLBACK_TREE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uViewFactor: { value: 600 },
      uSizeScale: { value: sizeScale },
      uTwinkle: { value: twinkle },
      uBreath: { value: 1 },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uHotspot: { value: new THREE.Vector3(0, -100, 0) },
      uHotPower: { value: 0 },
      uForm: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

export function createBulbMaterial({ intensity = 1.0, opacity = 1.0, speed = 0.55 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: BULB_VERT,
    fragmentShader: BULB_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uViewFactor: { value: 600 },
      uSpeed: { value: speed },
      uIntensity: { value: intensity },
      uOpacity: { value: opacity },
      uForm: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createSnowMaterial({ opacity = 0.85, height = 22, radius = 16, wind = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uViewFactor: { value: 600 },
      uHeight: { value: height },
      uRadius: { value: radius },
      uWind: { value: wind },
      uCamPos: { value: new THREE.Vector3() },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createGroundMaterial({ radius = 15, gold = new THREE.Color(0xffc86b) } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3(0, 0, 0) },
      uRadius: { value: radius },
      uGold: { value: gold },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uTop: { value: new THREE.Color(0x060b18) },
      uBottom: { value: new THREE.Color(0x01030a) },
      uHorizon: { value: new THREE.Color(0x1b2f52) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

export function createStarfieldMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STARFIELD_VERT,
    fragmentShader: STARFIELD_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createStarMaterial(color = 0xffe9b0) {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: new THREE.Color(color) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createOrnamentMaterial(highlight = 0) {
  return new THREE.ShaderMaterial({
    vertexShader: ORNAMENT_VERT,
    fragmentShader: ORNAMENT_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uHighlight: { value: highlight },
    },
  });
}

export function createGlowMaterial(color = 0xffd98a, intensity = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
