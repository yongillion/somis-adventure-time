// ============================================================================
// shaders.js — GLSL ES 3.00 sources
// ============================================================================

const COMMON_FRAG = `
vec3 applySat(vec3 c, float s){ float l = dot(c, vec3(0.299,0.587,0.114)); return mix(vec3(l), c, s); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
`;

const FOG_FUNC = `
uniform vec3 uFogColor;
uniform vec4 uFog; // near, far, heightStart, heightEnd
vec3 applyFog(vec3 col, vec3 world, vec3 camPos){
  float dist = length(camPos - world);
  float f = smoothstep(uFog.x, uFog.y, dist);
  float hf = clamp((uFog.z - world.y) / max(uFog.z - uFog.w, 0.001), 0.0, 1.0);
  hf = hf * hf * (3.0 - 2.0 * hf);
  f = max(f, hf);
  return mix(col, uFogColor, f);
}
`;

export const SHADERS = {
  // ------------------------------------------------------------------------
  toon: {
    vertex: `
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
#ifdef USE_VCOLOR
layout(location=2) in vec3 color;
#endif
#ifdef USE_UV
layout(location=3) in vec2 uv;
#endif
#ifdef USE_INSTANCING
layout(location=4) in mat4 iMatrix;
layout(location=8) in vec4 iColor;
#endif
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;
uniform float uWind;
uniform vec2 uMapRepeat;
out vec3 vNormal;
out vec3 vWorld;
out vec4 vColor;
out vec2 vUv;
void main(){
  vec4 lp = vec4(position, 1.0);
#ifdef USE_INSTANCING
  mat4 m = uModel * iMatrix;
  vec4 wp = m * lp;
  vNormal = normalize(mat3(m) * normal);
#else
  vec4 wp = uModel * lp;
  vNormal = normalize(uNormalMat * normal);
#endif
#ifdef USE_WIND
  float hgt = max(position.y, 0.0);
  float ph = uTime * 1.9 + wp.x * 0.35 + wp.z * 0.27;
  wp.x += sin(ph) * uWind * hgt;
  wp.z += cos(ph * 0.83) * uWind * hgt * 0.6;
#endif
  vWorld = wp.xyz;
  vec4 c = vec4(1.0);
#ifdef USE_VCOLOR
  c.rgb = color;
#endif
#ifdef USE_INSTANCING
  c *= iColor;
#endif
  vColor = c;
#ifdef USE_UV
  vUv = uv * uMapRepeat;
#else
  vUv = vec2(0.0);
#endif
  gl_Position = uProj * uView * wp;
}`,
    fragment: `
in vec3 vNormal;
in vec3 vWorld;
in vec4 vColor;
in vec2 vUv;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uOpacity;
uniform float uRim;
uniform float uSpec;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uShadeTint;
uniform vec3 uRimColor;
uniform float uBaseSat;
uniform vec4 uSatSpots[8];
uniform sampler2D uMap;
uniform float uTime;
uniform float uFlash;
out vec4 fragColor;
${COMMON_FRAG}
${FOG_FUNC}
void main(){
  vec3 base = uColor * vColor.rgb;
  float alpha = uOpacity * vColor.a;
#ifdef USE_MAP
  vec4 tx = texture(uMap, vUv);
  base *= tx.rgb;
  alpha *= tx.a;
#endif
#ifdef ALPHA_TEST
  if (alpha < 0.5) discard;
#endif
  vec3 col;
#ifdef UNLIT
  col = base;
#else
  vec3 N = normalize(vNormal);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 V = normalize(uCamPos - vWorld);
  float ndl = dot(N, uSunDir);
  float lightAmt = smoothstep(-0.06, 0.4, ndl);
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 shadowCol = base * hemi * uShadeTint;
  vec3 litCol = base * (hemi * 0.36 + uSunColor * 0.74);
  col = mix(shadowCol, litCol, lightAmt);
  float fres = 1.0 - max(dot(N, V), 0.0);
  col += uRim * pow(fres, 2.6) * uRimColor * (0.5 + 0.5 * lightAmt);
#ifdef USE_SPEC
  vec3 H = normalize(uSunDir + V);
  float sp = pow(max(dot(N, H), 0.0), 40.0);
  col += uSpec * smoothstep(0.3, 0.65, sp) * uSunColor;
#endif
#endif
  col += uEmissive;
  col = mix(col, vec3(1.0), uFlash);
#ifdef USE_SATFIELD
  float s = uBaseSat;
  for (int i = 0; i < 8; i++) {
    vec4 spot = uSatSpots[i];
    if (spot.w > 0.0) {
      float d = distance(vWorld, spot.xyz);
      s = max(s, 1.0 - smoothstep(spot.w * 0.65, spot.w, d));
    }
  }
  col = applySat(col, s);
#endif
#ifdef USE_FOG
  col = applyFog(col, vWorld, uCamPos);
#endif
  fragColor = vec4(col, alpha);
}`,
  },

  // ------------------------------------------------------------------------
  sky: {
    vertex: `
layout(location=0) in vec3 position;
out vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragment: `
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform float uSkyExp;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform float uSunSize;
uniform float uStars;
uniform float uTime;
uniform float uAurora;
uniform vec3 uAurora1;
uniform vec3 uAurora2;
uniform float uSkySat;
uniform float uSwirl;
out vec4 fragColor;
${COMMON_FRAG}
void main(){
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCamPos);
  float h = dir.y;
  vec3 col;
  if (h >= 0.0) col = mix(uHorizon, uZenith, pow(h, uSkyExp));
  else col = mix(uHorizon, uBottom, pow(min(-h * 2.5, 1.0), 0.6));
  // soft dreamy swirls (GRIS-like watercolor bands)
  if (uSwirl > 0.0) {
    float az = atan(dir.x, dir.z);
    float band = fbm(vec2(az * 2.0 + uTime * 0.01, h * 6.0 - uTime * 0.02));
    col = mix(col, col * 1.12 + vec3(0.03, 0.02, 0.05), smoothstep(0.45, 0.8, band) * uSwirl * smoothstep(-0.1, 0.3, h));
  }
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunGlow * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.5 + smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, sd) * 0.9);
  if (uStars > 0.0 && h > -0.1) {
    vec3 sp = dir * 120.0;
    vec3 ip = floor(sp);
    float r = hash13(ip);
    if (r > 0.955) {
      vec3 fp = fract(sp) - 0.5;
      vec3 off = vec3(hash13(ip + 1.7), hash13(ip + 3.1), hash13(ip + 5.3)) - 0.5;
      float d = length(fp - off * 0.55);
      float tw = 0.55 + 0.45 * sin(uTime * (1.2 + r * 5.0) + r * 60.0);
      float big = step(0.993, r);
      vec3 sc = mix(vec3(1.0, 0.95, 0.85), vec3(0.85, 0.9, 1.0), hash13(ip + 9.1));
      col += sc * smoothstep(0.1 + big * 0.08, 0.0, d) * tw * uStars * smoothstep(-0.1, 0.2, h) * (1.0 + big);
    }
  }
  if (uAurora > 0.0 && h > 0.0) {
    float x = atan(dir.x, dir.z);
    float w1 = sin(x * 5.0 + uTime * 0.25 + sin(x * 3.0 - uTime * 0.17) * 1.6);
    float w2 = sin(x * 8.0 - uTime * 0.31 + 1.7);
    float curtain = smoothstep(0.2, 1.0, w1 * 0.7 + w2 * 0.3);
    float vert = smoothstep(0.08, 0.3, h) * smoothstep(0.85, 0.35, h);
    float streak = 0.6 + 0.4 * sin(x * 60.0 + uTime * 0.6);
    col += mix(uAurora1, uAurora2, smoothstep(0.15, 0.6, h)) * curtain * vert * streak * uAurora * 0.75;
  }
  col = applySat(col, uSkySat);
  fragColor = vec4(col, 1.0);
}`,
  },

  // ------------------------------------------------------------------------
  // instanced billboard particles / sprites / decals
  particle: {
    vertex: `
layout(location=0) in vec3 position; // corner -0.5..0.5 in xy
layout(location=4) in vec4 iPosSize;
layout(location=5) in vec4 iCol;
layout(location=6) in vec4 iExtra; // rot, tile, stretch, unused
uniform mat4 uView;
uniform mat4 uProj;
uniform float uAtlasN;
out vec2 vUv;
out vec4 vColor;
out vec3 vWorld;
void main(){
  float c = cos(iExtra.x), s = sin(iExtra.x);
  vec2 cr = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
#ifdef FLAT
  vec3 wp = iPosSize.xyz + vec3(cr.x, 0.0, cr.y) * iPosSize.w;
#else
  vec3 right = vec3(uView[0][0], uView[1][0], uView[2][0]);
  vec3 up = vec3(uView[0][1], uView[1][1], uView[2][1]);
  vec3 wp = iPosSize.xyz + (right * cr.x + up * cr.y * (1.0 + iExtra.z)) * iPosSize.w;
#endif
  float tile = iExtra.y;
  vec2 t = vec2(mod(tile, uAtlasN), floor(tile / uAtlasN));
  vUv = (t + vec2(position.x + 0.5, 0.5 - position.y)) / uAtlasN;
  vColor = iCol;
  vWorld = wp;
  gl_Position = uProj * uView * vec4(wp, 1.0);
}`,
    fragment: `
in vec2 vUv;
in vec4 vColor;
in vec3 vWorld;
uniform sampler2D uMap;
uniform vec3 uCamPos;
out vec4 fragColor;
${FOG_FUNC}
void main(){
  vec4 t = texture(uMap, vUv);
  vec4 c = t * vColor;
  if (c.a < 0.004) discard;
#ifdef USE_FOG
  c.rgb = applyFog(c.rgb, vWorld, uCamPos);
#endif
  fragColor = c;
}`,
  },

  // ------------------------------------------------------------------------
  water: {
    vertex: `
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;
uniform float uWaveAmp;
out vec3 vWorld;
out vec3 vNormal;
void main(){
  vec4 wp = uModel * vec4(position, 1.0);
  float w1 = sin(wp.x * 0.6 + uTime * 1.3) * cos(wp.z * 0.5 + uTime * 1.1);
  float w2 = sin(wp.x * 1.3 - wp.z * 0.9 + uTime * 2.1) * 0.5;
  wp.y += (w1 + w2) * uWaveAmp;
  float dx = cos(wp.x * 0.6 + uTime * 1.3) * 0.6 * cos(wp.z * 0.5 + uTime * 1.1) + cos(wp.x * 1.3 - wp.z * 0.9 + uTime * 2.1) * 0.65;
  float dz = -sin(wp.x * 0.6 + uTime * 1.3) * sin(wp.z * 0.5 + uTime * 1.1) * 0.5 - cos(wp.x * 1.3 - wp.z * 0.9 + uTime * 2.1) * 0.45;
  vNormal = normalize(vec3(-dx * uWaveAmp, 1.0, -dz * uWaveAmp));
  vWorld = wp.xyz;
  gl_Position = uProj * uView * wp;
}`,
    fragment: `
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform float uOpacity;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uTime;
uniform float uBaseSat;
uniform vec4 uSatSpots[8];
out vec4 fragColor;
${COMMON_FRAG}
${FOG_FUNC}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  vec2 uv = vWorld.xz * 0.35;
  float n1 = fbm(uv + vec2(uTime * 0.08, uTime * 0.05));
  float n2 = fbm(uv * 1.7 - vec2(uTime * 0.06, -uTime * 0.09));
  float caust = 1.0 - smoothstep(0.0, 0.045, abs(n1 - n2));
  vec3 col = mix(uColor, uDeep, 0.35 + 0.3 * n1);
  col = mix(col, uSkyColor * 1.05, fres * 0.55);
  col += vec3(1.0) * caust * 0.35;
  vec3 H = normalize(uSunDir + V);
  float sp = pow(max(dot(N, H), 0.0), 120.0);
  float glint = step(0.82, hash12(floor(vWorld.xz * 6.0) + floor(uTime * 3.0))) * sp * 6.0;
  col += uSunColor * (smoothstep(0.2, 0.5, sp) * 0.6 + glint * 0.4);
#ifdef USE_SATFIELD
  float s = uBaseSat;
  for (int i = 0; i < 8; i++) { vec4 spot = uSatSpots[i]; if (spot.w > 0.0) { float d = distance(vWorld, spot.xyz); s = max(s, 1.0 - smoothstep(spot.w * 0.65, spot.w, d)); } }
  col = applySat(col, s);
#endif
  col = applyFog(col, vWorld, uCamPos);
  fragColor = vec4(col, mix(uOpacity, 1.0, fres * 0.5));
}`,
  },

  // ------------------------------------------------------------------------
  cloudsea: {
    vertex: `
layout(location=0) in vec3 position;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vWorld;
void main(){
  vec4 wp = uModel * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = uProj * uView * wp;
}`,
    fragment: `
in vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uShadow;
uniform vec3 uCamPos;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uSkySat;
out vec4 fragColor;
${COMMON_FRAG}
uniform vec3 uFogColor;
uniform vec4 uFog;
void main(){
  vec2 uv = vWorld.xz * 0.025 + vec2(uTime * 0.004, uTime * 0.002);
  float n = fbm(uv);
  float n2 = fbm(uv * 2.7 + 5.0 + uTime * 0.003);
  float puff = smoothstep(0.3, 0.75, n * 0.7 + n2 * 0.3);
  vec3 col = mix(uShadow, uColor, puff);
  // highlight rims of puffs facing sun
  float e = 0.02;
  float nx = fbm(uv + vec2(e, 0.0)) - n;
  float nz = fbm(uv + vec2(0.0, e)) - n;
  vec3 N = normalize(vec3(-nx * 12.0, 1.0, -nz * 12.0));
  col += vec3(1.0) * pow(max(dot(N, uSunDir), 0.0), 3.0) * 0.12;
  float dist = length(uCamPos - vWorld);
  float f = smoothstep(uFog.x * 1.5, uFog.y * 1.8, dist);
  col = mix(col, uFogColor, f);
  col = applySat(col, uSkySat);
  fragColor = vec4(col, 1.0);
}`,
  },
};
