// HEXBEAT — three.js renderer. Immediate-mode: every frame we rebuild two instanced sprite batches from sim state.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BIOMES, ELEM, RUNES } from './data.js';

const TAU = Math.PI * 2;
const hash = (x, z, s = 0) => { const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
const PPU = 12; // art pixels per world unit

const SPRITE_VS = `
attribute vec3 iPos; attribute vec4 iSR; attribute vec4 iUV; attribute vec4 iCol;
uniform vec3 uCenter; uniform float uGain;
varying vec2 vUv; varying vec4 vCol; varying float vD;
void main(){
  vUv = iUV.xy + uv * iUV.zw; vCol = iCol;
  // iSR.w: 0 billboard, 1 flat on the ground; +2 marks a priority effect that is never dimmed
  float pri = step(1.5, iSR.w), flat_ = iSR.w - 2.0 * pri;
  vCol.a *= mix(uGain, 1.0, pri);
  vec2 p = position.xy; vec3 wp;
  if (flat_ > 0.5) { vec2 q = vec2(p.x, p.y - 0.5) * iSR.xy; float c = cos(iSR.z), s = sin(iSR.z); q = vec2(q.x*c - q.y*s, q.x*s + q.y*c); wp = iPos + vec3(q.x, 0.0, q.y); }
  else { vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); wp = iPos + right * p.x * iSR.x + up * p.y * iSR.y; }
  vD = length(iPos.xz - uCenter.xz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const SPRITE_FS = `
uniform sampler2D map; uniform vec3 uFog; uniform float uAdd;
varying vec2 vUv; varying vec4 vCol; varying float vD;
void main(){
  vec4 t = texture2D(map, vUv);
  float fog = smoothstep(13.0, 21.5, vD);
  if (uAdd > 0.5) { gl_FragColor = vec4(t.rgb * vCol.rgb * t.a * min(vCol.a, 1.4) * 0.62 * (1.0 - fog), 1.0); return; }
  if (t.a < 0.5) discard;
  vec3 col = mix(t.rgb * vCol.rgb, vec3(1.0), vCol.a);
  col *= mix(0.86, 0.5, smoothstep(4.0, 13.0, vD));
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
}`;

class Batch {
  constructor(cap, tex, additive, frames, atlasSize) {
    this.cap = cap; this.n = 0; this.frames = frames; this.as = atlasSize;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPos = mk('iPos', 3); this.aSR = mk('iSR', 4); this.aUV = mk('iUV', 4); this.aCol = mk('iCol', 4);
    this.uniforms = { map: { value: tex }, uFog: { value: new THREE.Color() }, uCenter: { value: new THREE.Vector3() }, uAdd: { value: additive ? 1 : 0 }, uGain: { value: 1 } };
    this.additive = additive; this.pri = false; this.load = 0;
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, side: THREE.DoubleSide, transparent: additive, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 2 : 1;
    this.geo = g;
  }
  begin() { this.n = 0; this.load = 0; this.pri = false; }
  // billboard anchored at feet (x,y,z); w<0 flips. flat=1 lays the quad on the ground, centred, rotated by rot.
  add(frame, x, y, z, w, h, col, a = 0, rot = 0, flat = 0) {
    const f = this.frames[frame]; if (!f || this.n >= this.cap) return;
    if (this.additive) {
      if (this.pri) flat += 2;
      else {
        // big effects are drawn fainter, and we total up how much light is on screen (see World.frame)
        const area = Math.abs(w * h); if (area > 6) a *= Math.sqrt(6 / area);
        this.load += Math.min(area, 60) * Math.min(a, 1.4);
      }
    }
    const i = this.n++, S = this.as;
    this.aPos.array.set([x, y, z], i * 3);
    this.aSR.array.set([w, h, rot, flat], i * 4);
    this.aUV.array.set([f.x / S, 1 - (f.y + f.h) / S, f.w / S, f.h / S], i * 4);
    this.aCol.array.set([((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255, a], i * 4);
  }
  // sprite at natural pixel size * scale
  spr(frame, x, y, z, scale, col = 0xffffff, flash = 0, flip = 1, sy = 1) { const f = this.frames[frame]; if (f) this.add(frame, x, y, z, f.w / PPU * scale * flip, f.h / PPU * scale * sy, col, flash); }
  end() { this.geo.instanceCount = this.n; this.aPos.needsUpdate = this.aSR.needsUpdate = this.aUV.needsUpdate = this.aCol.needsUpdate = true; }
}

const FLOOR_FS = `
uniform vec3 uA, uB, uAcc, uFog, uCenter; uniform float uBeat, uRing, uTime, uArena; uniform vec3 uArenaPos;
varying vec3 vW;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 w = vW.xz, tile = floor(w), f = fract(w);
  float h = h21(tile), d = length(tile + 0.5 - uCenter.xz);
  vec3 col = mix(uA, uB, h * 0.7 + 0.15 * mod(tile.x + tile.y, 2.0)) * 1.2;
  vec2 big = fract(w / 4.0);
  float edge = max(step(f.x, 0.08), step(f.y, 0.08));
  col *= 1.0 - 0.3 * edge;
  col *= 1.0 - 0.25 * max(step(big.x, 0.02), step(big.y, 0.02));
  float h2 = h21(tile + 17.0);
  vec2 c = abs(f - 0.54);
  if (h2 > 0.93) { float m = step(max(c.x, c.y), 0.3) * (1.0 - step(max(c.x, c.y), 0.16)); col += uAcc * m * (0.25 + 0.85 * uBeat * step(0.965, h2 + 0.035 * sin(uTime + h * 40.0))); }
  if (h2 < 0.05) col *= 0.72;
  float ring = smoothstep(0.9, 0.0, abs(d - uRing * 16.0));
  col += uAcc * ring * 0.4 * (1.0 - uRing);
  if (uArena > 0.5) { float ad = length(w - uArenaPos.xz) - uArenaPos.y; col += vec3(1.0, 0.2, 0.3) * smoothstep(0.5, 0.0, abs(ad)) * (0.8 + 0.4 * uBeat); if (ad > 0.0) col *= 0.35; }
  col *= mix(1.7, 0.75, smoothstep(1.0, 11.0, d));
  col = mix(col, uFog, smoothstep(13.0, 21.5, length(w - uCenter.xz)));
  gl_FragColor = vec4(col, 1.0);
}`;
const PILLAR_VS = `varying vec3 vW; varying vec3 vN;
void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PILLAR_FS = `uniform vec3 uB, uAcc, uFog, uCenter; uniform float uBeat; varying vec3 vW; varying vec3 vN;
void main(){
  float d = length(vW.xz - uCenter.xz);
  vec3 col = uB * (vN.y > 0.5 ? 2.3 : (abs(vN.x) > 0.5 ? 1.0 : 1.5));
  float band = step(0.82, fract(vW.y * 1.2 + 0.1));
  if (vN.y < 0.5) col += uAcc * band * (0.35 + 0.9 * uBeat);
  col *= mix(1.3, 0.7, smoothstep(3.0, 12.0, d));
  gl_FragColor = vec4(mix(col, uFog, smoothstep(13.0, 21.5, d)), 1.0);
}`;
const FINAL = {
  uniforms: { tDiffuse: { value: null }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) }, uDrop: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec4 uFlash; uniform float uDrop; uniform vec2 uRes; varying vec2 vUv;
  void main(){
    vec2 o = (vUv - 0.5); float r = dot(o, o);
    vec2 ca = o * r * (0.012 + 0.03 * uDrop);
    vec3 c = vec3(texture2D(tDiffuse, vUv - ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + ca).b);
    // Overlapping effects add up past white. Compress highlights by scaling all channels together, so a pile
    // of orange stays orange instead of bleaching the screen.
    float mx = max(c.r, max(c.g, c.b));
    if (mx > 0.7) c *= (0.7 + (mx - 0.7) / (1.0 + (mx - 0.7) * 3.4)) / mx;
    c *= 1.0 - 0.55 * smoothstep(0.12, 0.6, r);
    c = mix(c, c * vec3(1.15, 0.9, 1.25), uDrop * 0.5);
    c = mix(c, uFlash.rgb, uFlash.a * (0.35 + 0.65 * smoothstep(0.0, 0.5, r)));
    gl_FragColor = vec4(c, 1.0);
  }`,
};

export class World {
  constructor(canvas, atlas, opts) {
    this.opts = opts; this.frames = atlas.frames;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    r.outputColorSpace = THREE.LinearSRGBColorSpace; r.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(38, 1, 1, 140);
    const tex = this.tex = new THREE.CanvasTexture(atlas.canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace;
    this.main = new Batch(1600, tex, false, atlas.frames, atlas.size);
    this.add = new Batch(2600, tex, true, atlas.frames, atlas.size);
    this.fu = { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uAcc: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uCenter: { value: new THREE.Vector3() }, uBeat: { value: 0 }, uRing: { value: 1 }, uTime: { value: 0 }, uArena: { value: 0 }, uArenaPos: { value: new THREE.Vector3() } };
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: this.fu, vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`, fragmentShader: FLOOR_FS }));
    this.floor.frustumCulled = false;
    this.pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({ uniforms: this.fu, vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS }), 64);
    this.pillars.frustumCulled = false; this.pillars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.floor, this.pillars, this.main.mesh, this.add.mesh);
    // Bloom needs float render targets; very old GPUs lack them, so fall back to a plain render.
    const gl = r.getContext();
    this.direct = !(r.capabilities.isWebGL2 !== false && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.95);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FINAL); this.composer.addPass(this.final);
    this.parts = []; this.rings = []; this.beams = []; this.nums = [];
    this.shakeA = 0; this.flashA = 0; this.flashC = new THREE.Color(1, 1, 1); this.hitstopT = 0; this.ringT = 1; this.t = 0;
    this.center = new THREE.Vector3(); this.camPos = new THREE.Vector3(0, 0, 0); this.m4 = new THREE.Matrix4();
    this.biome(BIOMES[0]);
    this.resize();
    // the sim talks to us through this object
    this.fx = {
      burst: (x, z, color, n, o = {}) => this.burst(x, z, color, n, o),
      ring: (x, z, r, color, dur) => this.rings.push({ x, z, r, color, t: 0, dur }),
      beam: (x1, z1, x2, z2, color, w, dur, y = 0.5) => this.beams.push({ x1, z1, x2, z2, color, w, t: 0, dur, y }),
      cone: (x, z, a, half, R, color) => { for (let k = 0; k < 26; k++) { const aa = a + (Math.random() * 2 - 1) * half, sp = R * (2.2 + Math.random() * 1.6); this.parts.push({ x, y: 0.4, z, vx: Math.cos(aa) * sp, vy: 0, vz: Math.sin(aa) * sp, life: 0.4, max: 0.4, color, size: 0.22, drag: 3 }); } },
      num: (x, z, v, color, big) => { if (this.nums.length < (big ? 26 : 14) * (0.5 + 0.5 * (this.gain || 1))) this.nums.push({ x: x + (Math.random() - 0.5) * 0.5, z, v: Math.max(1, Math.round(v)), color, big, t: 0 }); },
      shake: a => { if (this.opts.shake) this.shakeA = Math.min(1.2, Math.max(this.shakeA, a)); },
      flash: (c, a) => { this.flashC.set(c); this.flashA = Math.max(this.flashA, a); },
      hitstop: t => { this.hitstopT = t; },
      pulse: () => { this.ringT = 0; },
      biome: b => this.biome(b),
      haptic: ms => { if (this.opts.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* unsupported */ } } },
    };
  }
  biome(b) {
    this.b = b; const u = this.fu;
    u.uA.value.set(b.a); u.uB.value.set(b.b); u.uAcc.value.set(b.acc); u.uFog.value.set(b.fog);
    this.main.uniforms.uFog.value.set(b.fog); this.add.uniforms.uFog.value.set(b.fog);
    this.scene.background = new THREE.Color(b.fog);
    const tc = new THREE.Color(b.tint).multiplyScalar(0.62); this.propTint = tc.getHex();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight, k = Math.min(1, 330 / Math.min(w, h));
    const iw = Math.max(2, Math.round(w * k)), ih = Math.max(2, Math.round(h * k));
    this.renderer.setSize(iw, ih, false); this.composer.setSize(iw, ih);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    const t = Math.tan(this.cam.fov * Math.PI / 360);
    this.dist = Math.max(5.5 / (t * this.cam.aspect), 7.4 / t);
  }
  burst(x, z, color, n, o) {
    if (this.parts.length > 420) return;
    if ((this.gain || 1) < 0.75) n = Math.ceil(n * (this.gain || 1) * 0.8);
    if (this.parts.length > 500) n = Math.ceil(n / 3); else if (this.parts.length > 250) n = Math.ceil(n / 2);
    const sp = o.spd || 3;
    for (let k = 0; k < n; k++) { const a = Math.random() * TAU, v = sp * (0.3 + Math.random() * 0.7); this.parts.push({ x, y: 0.4, z, vx: Math.cos(a) * v, vy: (o.up || 0) + Math.random() * 3, vz: Math.sin(a) * v, life: 0.3 + Math.random() * 0.3, max: 0.6, color, size: 0.1 + Math.random() * 0.12, drag: 2.5, grav: 7 }); }
  }
  reset() { this.parts.length = this.rings.length = this.beams.length = this.nums.length = 0; this.shakeA = 0; this.flashA = 0; this.hitstopT = 0; }

  frame(dt, cx, cz, beat, drop) {
    this.t += dt;
    const u = this.fu, sh = this.shakeA;
    this.shakeA = Math.max(0, sh - dt * 2.4); this.flashA = Math.max(0, this.flashA - dt * 2.2); this.ringT = Math.min(1, this.ringT + dt * 1.4);
    this.center.set(cx, 0, cz);
    this.camPos.lerp(this.center, 1 - Math.exp(-dt * 9));
    const sx = (Math.random() - 0.5) * sh * 0.7, sz = (Math.random() - 0.5) * sh * 0.7, d = this.dist;
    this.cam.position.set(this.camPos.x + sx, d * 0.8, this.camPos.z + d * 0.6 + sz);
    this.cam.lookAt(this.camPos.x + sx, 0, this.camPos.z + sz - 0.6);
    this.floor.position.set(Math.round(cx), 0, Math.round(cz));
    u.uCenter.value.copy(this.center); u.uBeat.value = beat; u.uRing.value = this.ringT; u.uTime.value = this.t;
    this.main.uniforms.uCenter.value.copy(this.center); this.add.uniforms.uCenter.value.copy(this.center);
    this.final.uniforms.uFlash.value.set(this.flashC.r, this.flashC.g, this.flashC.b, this.flashA);
    this.final.uniforms.uDrop.value += ((drop ? 1 : 0) - this.final.uniforms.uDrop.value) * Math.min(1, dt * 6);
    this.bloom.enabled = !!this.opts.bloom && !this.autoLow;
    // adaptive quality: if frames stay slow, drop the bloom pass
    if (dt > 0) { this.slow = (this.slow || 0) * 0.98 + (dt > 0.03 ? 0.02 : 0); if (this.slow > 0.7 && this.t > 6) this.autoLow = true; }
    this.bloom.strength = 0.55 + beat * 0.12 + (drop ? 0.2 : 0);
    // auto-exposure for effects: the more light the wheel throws, the dimmer each effect gets
    const want = Math.max(0.42, Math.min(1, 120 / Math.max(1, this.add.load)));
    this.gain = this.gain === undefined ? 1 : this.gain + (want - this.gain) * Math.min(1, dt * (want < this.gain ? 14 : 3));
    this.add.uniforms.uGain.value = this.gain;
    this.bloom.strength *= 0.45 + 0.55 * this.gain;
    this.main.begin(); this.add.begin();
    this.drawProps(cx, cz, beat);
  }
  drawProps(cx, cz, beat) {
    const b = this.b, M = this.main, A = this.add, seed = b.root + 1, C = 4;
    const gx = Math.round(cx / C), gz = Math.round(cz / C); let np = 0;
    for (let i = -6; i <= 6; i++) for (let j = -7; j <= 6; j++) {
      const x0 = gx + i, z0 = gz + j, h = hash(x0, z0, seed); if (h > 0.3) continue;
      const x = x0 * C + (hash(x0, z0, seed + 1) - 0.5) * 2.4, z = z0 * C + (hash(x0, z0, seed + 2) - 0.5) * 2.4;
      if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;
      if (h < 0.05 && np < 64) { const pd = Math.hypot(x - cx, z - cz), ht = (1.5 + hash(x0, z0, seed + 3) * 3) * Math.min(1, Math.max(0.1, (pd - 1.6) / 2.6)), wd = 0.8 + hash(x0, z0, seed + 4) * 0.7; this.m4.makeScale(wd, ht, wd).setPosition(Math.round(x) + 0.5, 0, Math.round(z) + 0.5); this.pillars.setMatrixAt(np++, this.m4); continue; }
      const name = b.props[h < 0.19 ? 0 : 1], sc = 1.1 + hash(x0, z0, seed + 5) * 0.5;
      M.add('shadow', x, 0.02, z + 0.05, 1.1 * sc, 0.5 * sc, 0xffffff, 0, 0, 1);
      M.spr(name, x, 0, z, sc, this.propTint);
      if (name === 'candle' || name === 'brazier' || name === 'crystal' || name === 'speaker') A.add('glow', x, name === 'candle' ? 0.2 : 0.3, z, 1.6 * sc, 1.6 * sc, b.acc, 0.35 + 0.25 * beat + 0.1 * Math.sin(this.t * 9 + x));
    }
    this.pillars.count = np; this.pillars.instanceMatrix.needsUpdate = true;
    // drifting motes
    for (let k = 0; k < 36; k++) { const hx = hash(k, 1), hz = hash(k, 2), ph = (this.t * (0.1 + hx * 0.15) + hz) % 1; A.add('soft', cx + (hx - 0.5) * 22 + Math.sin(this.t + k) * 0.5, ph * 4, cz + (hz - 0.5) * 26, 0.14, 0.14, b.acc, Math.sin(ph * Math.PI) * 0.8); }
  }
  drawFx(dt) {
    const A = this.add, M = this.main;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt; if (p.life <= 0) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      const f = Math.exp(-(p.drag || 0) * dt); p.vx *= f; p.vz *= f; p.vy -= (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; }
      const s = p.size * Math.min(1, p.life / p.max * 2);
      A.add('px', p.x, p.y, p.z, s, s, p.color, 1.0);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; if (r.t >= r.dur) { this.rings.splice(i, 1); continue; }
      const q = r.t / r.dur, rad = r.r * (0.3 + 0.7 * Math.sqrt(q)) * 2;
      A.add('ringthin', r.x, 0.12, r.z, rad, rad, r.color, 1.5 * (1 - q), 0, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.t += dt; if (b.t >= b.dur) { this.beams.splice(i, 1); continue; }
      const dx = b.x2 - b.x1, dz = b.z2 - b.z1, len = Math.hypot(dx, dz), a = Math.atan2(dz, dx), q = 1 - b.t / b.dur;
      const bw = Math.min(1.1, b.w * 2) * q;
      A.add('px', (b.x1 + b.x2) / 2, b.y, (b.z1 + b.z2) / 2, len, bw, b.color, 1.2, a, 1);
      A.add('px', (b.x1 + b.x2) / 2, b.y + 0.01, (b.z1 + b.z2) / 2, len, Math.min(0.14, bw * 0.3), 0xffffff, 0.9, a, 1);
    }
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i]; n.t += dt; if (n.t > 0.5) { this.nums.splice(i, 1); continue; }
      const s = String(n.v), sc = (n.big ? 0.6 : 0.36) * (n.t < 0.08 ? 1.5 : n.t > 0.38 ? (0.5 - n.t) / 0.12 : 1), w = sc * 0.72;
      const y = 1.3 + n.t * 2.2;
      for (let k = 0; k < s.length; k++) M.add('d' + s[k], n.x + (k - (s.length - 1) / 2) * w * 0.82, y, n.z + 0.3, w, sc, n.color);
    }
  }
  finish() {
    this.main.end(); this.add.end();
    if (this.direct) this.renderer.render(this.scene, this.cam); else this.composer.render();
  }

  // ---------- gameplay frame ----------
  render(run, dt) {
    const p = run.p, t = this.t, M = this.main, A = this.add, F = this.frames;
    const drop = run.dropT > 0, st = run.stage;
    if (p.hp > 0 && p.hp < run.s.maxHp * 0.3 && this.flashA < 0.16) { this.flashC.set(0xff1030); this.flashA = 0.1 + 0.08 * Math.sin(t * 7); }
    this.frame(dt, p.x, p.z, run.beat, drop);
    const u = this.fu;
    A.pri = true;
    if (st.arena) { u.uArena.value = 1; u.uArenaPos.value.set(st.arena.x, st.arena.r + 0.5, st.arena.z); for (let k = 0; k < 40; k++) { const a = k / 40 * TAU + t * 0.2; A.add('glow', st.arena.x + Math.cos(a) * (st.arena.r + 0.5), 0.1 + 0.4 * Math.abs(Math.sin(t * 5 + k)), st.arena.z + Math.sin(a) * (st.arena.r + 0.5), 0.9, 1.3, 0xff3050, 0.6); } } else u.uArena.value = 0;

    // zones under everything
    for (const z of run.zones) {
      const q = z.t / z.dur; A.pri = z.type === 'hazard';
      if (z.type === 'nova') { A.add('ring', z.x, 0.15, z.z, z.r * 2, z.r * 2, z.color, 1.8 * (1 - q * 0.6), 0, 1); A.add('disc', z.x, 0.1, z.z, z.r * 2, z.r * 2, z.color, 0.05, 0, 1); }
      else if (z.type === 'rift') { const s = z.r * 2 * Math.min(1, z.t * 4) * (q > 0.9 ? (1 - q) * 10 : 1); A.add('ring', z.x, 0.12, z.z, s, s, z.color, 1.2, t * 3, 1); A.add('ring', z.x, 0.14, z.z, s * 0.6, s * 0.6, z.color, 1.2, -t * 5, 1); A.add('glow', z.x, 0.16, z.z, s * 0.3, s * 0.3, 0xffffff, 0.5, 0, 1); if (Math.random() < 0.5) { const a = Math.random() * TAU; this.parts.push({ x: z.x + Math.cos(a) * z.r, y: 0.3, z: z.z + Math.sin(a) * z.r, vx: -Math.cos(a) * 5, vy: 0, vz: -Math.sin(a) * 5, life: 0.4, max: 0.4, color: z.color, size: 0.2 }); } }
      else if (z.type === 'cloud') { const al = Math.min(1, z.t * 4) * Math.min(1, (z.dur - z.t) * 2); for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + t * 0.6, rr = z.r * 0.5; A.add('glow', z.x + Math.cos(a) * rr, 0.2 + 0.1 * Math.sin(t * 3 + k), z.z + Math.sin(a) * rr, z.r * 0.9, z.r * 0.9, z.color, 0.22 * al, 0, 1); } A.add('ringthin', z.x, 0.1, z.z, z.r * 2, z.r * 2, z.color, 0.6 * al, 0, 1); }
      else if (z.type === 'meteor') { A.add('tele', z.x, 0.1, z.z, z.r * 2, z.r * 2, 0xff7a3d, 0.9, 0, 1); const y = (1 - q) * 14; A.add('glow', z.x + y * 0.3, y, z.z, 2.2, 2.2, 0xff9a4d, 1.6); A.add('orb', z.x + y * 0.3, y + 0.6, z.z, 0.9, 0.9, 0xffffff, 1.5); }
      else if (z.type === 'hazard') { A.add('tele', z.x, 0.1, z.z, z.r * 2, z.r * 2, 0xff3050, 1.2, 0, 1); A.add('disc', z.x, 0.11, z.z, z.r * 2 * q, z.r * 2 * q, 0xff3050, 0.35, 0, 1); }
    }
    A.pri = true;
    // spotlight objective + compass pip
    const sp = run.spot;
    if (sp) {
      const col = { xp: 0x73eff6, gold: 0xffcd75, heal: 0xff5c7a, drop: 0xff5ccd }[sp.kind], fade = Math.min(1, sp.life / 3);
      A.add('ringthin', sp.x, 0.1, sp.z, sp.r * 2, sp.r * 2, col, 1.3 * fade, t * 0.6, 1);
      A.add('disc', sp.x, 0.09, sp.z, sp.r * 2 * sp.q, sp.r * 2 * sp.q, col, 0.45, 0, 1);
      A.add('disc', sp.x, 0.08, sp.z, sp.r * 2, sp.r * 2, col, 0.1 + 0.06 * run.beat, 0, 1);
      for (let k = 0; k < 5; k++) A.add('glow', sp.x, k * 1.5, sp.z, 1.6 - k * 0.2, 2.6, col, (0.5 - k * 0.08) * fade);
      const dx = sp.x - p.x, dz = sp.z - p.z, d = Math.hypot(dx, dz);
      if (d > 4) { const a = Math.atan2(dz, dx); for (let k = 0; k < 3; k++) A.add('px', p.x + dx / d * (1.6 + k * 0.32), 0.15, p.z + dz / d * (1.6 + k * 0.32), 0.22 - k * 0.05, 0.3 - k * 0.07, col, 1.2 - k * 0.3, a, 1); }
    }
    for (const g of run.pickups) if (g.type === 'chest') { const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz); if (d > 4) A.add('px', p.x + dx / d * 1.6, 0.15, p.z + dz / d * 1.6, 0.22, 0.22, 0xffcd75, 1.2, t * 3, 1); }
    // pickups
    for (const g of run.pickups) {
      const bob = 0.15 + 0.12 * Math.sin(t * 5 + g.x * 3);
      if (g.type === 'xp') { M.spr('gem', g.x, bob, g.z, g.v >= 8 ? 1.25 : 0.85, g.v >= 8 ? 0xff9cf0 : g.v >= 3 ? 0xa7f070 : 0xffffff); }
      else if (g.type === 'gold') M.spr('coin', g.x, bob, g.z, 0.9);
      else if (g.type === 'heart') { M.spr('heart', g.x, bob, g.z, 1); A.add('glow', g.x, 0, g.z, 1.4, 1.4, 0xff3050, 0.5); }
      else if (g.type === 'magnet') { M.spr('i_magnet', g.x, bob, g.z, 1, 0x73eff6); A.add('glow', g.x, 0, g.z, 1.4, 1.4, 0x73eff6, 0.5); }
      else if (g.type === 'chest') { M.spr('chest', g.x, 0, g.z, 1.3); A.add('glow', g.x, -0.3, g.z, 2.6, 2.6, 0xffcd75, 0.55 + 0.25 * Math.sin(t * 6)); A.add('ringthin', g.x, 0.1, g.z, 2.2, 2.2, 0xffcd75, 0.8, t, 1); }
    }
    A.pri = false;
    // mines, decoy, hounds
    for (const m of run.mines) { const armed = m.t > 0.35, bl = armed ? 0.5 + 0.5 * Math.sin(t * 8 + m.x) : 0.2; M.spr('r_mine', m.x, 0.02, m.z, 0.75, armed ? 0xff7a3d : 0x8a5a40); A.add('glow', m.x, -0.2, m.z, 1, 1, 0xff7a3d, 0.5 * bl); }
    const dc = run.decoy;
    if (dc) { const bl = dc.t < 0.8 && Math.floor(t * 16) % 2; M.add('shadow', dc.x, 0.02, dc.z + 0.05, 0.9, 0.42, 0xffffff, 0, 0, 1); M.spr('hero_' + run.char.id, dc.x, 0.05 + 0.08 * Math.sin(t * 6), dc.z, 1, bl ? 0xffffff : 0x9a7dff, bl ? 0.8 : 0.25); A.add('ringthin', dc.x, 0.1, dc.z, dc.r * 2, dc.r * 2, 0xb48cff, 0.5, t, 1); A.add('glow', dc.x, 0, dc.z, 2.2, 2.2, 0xb48cff, 0.6); }
    for (const h of run.pets) { const sc = (h.big ? 1.15 : 0.9) * Math.min(1, h.t * 3); M.add('shadow', h.x, 0.02, h.z + 0.05, 0.8 * sc, 0.36 * sc, 0xffffff, 0, 0, 1); M.spr('hound', h.x, Math.abs(Math.sin(h.a * 12)) * 0.12, h.z, sc, 0xffffff, 0, h.fx || 1); A.add('glow', h.x, 0, h.z, 1.5, 1.5, 0xe04dff, 0.55); }
    // turrets
    for (const q of run.turrets) { M.add('shadow', q.x, 0.02, q.z, 0.8, 0.4, 0xffffff, 0, 0, 1); M.spr('totem', q.x, 0, q.z, 1.2); A.add('glow', q.x, 0.6, q.z, 1.2, 1.2, q.color, 0.7 + 0.3 * run.beat); }
    // enemies
    for (const e of run.enemies) {
      if (e.dead) continue;
      const f = F[e.spr]; if (!f) continue;
      const sc = e.boss ? 2.3 : e.scale, fly = (e.k.fly && !e.boss ? e.k.fly + 0.15 * Math.sin(e.t * 6) : 0) + (e.y || 0);
      let col = e.color;
      if (e.stun > 0 && !e.boss) col = 0x9fdcff; else if (e.chillT > 0) col = 0x8fc8ff; else if (e.burnT > 0) col = 0xffa060; else if (e.psnT > 0) col = 0x9cff7a; else if (e.shockT > 0) col = 0xfff08a;
      const wob = e.stun > 0 ? 1 : 1 + 0.07 * Math.sin(e.t * 9), flip = e.x > p.x ? -1 : 1;
      const sw = Math.max(0.5, f.w / PPU * sc * (1 - Math.min(0.6, fly * 0.12)));
      M.add('shadow', e.x, 0.02, e.z + 0.05, sw, sw * 0.45, 0xffffff, 0, 0, 1);
      M.spr(e.spr, e.x, fly, e.z, sc, col, e.flash > 0 ? 0.55 : 0, flip, wob);
      if (e.elite || e.boss) A.add('glow', e.x, 0.1, e.z, 2.4 * sc, 2.4 * sc, e.boss ? e.color : 0xffd24d, 0.3 + 0.15 * run.beat, 0, 1);
      if (e.hexT > 0) M.spr('i_skull', e.x, fly + f.h / PPU * sc + 0.15, e.z, 0.6, 0xe04dff);
      if (e.burnT > 0 && Math.random() < 0.08) this.parts.push({ x: e.x, y: 0.6, z: e.z, vx: 0, vy: 2, vz: 0, life: 0.3, max: 0.3, color: 0xff7a3d, size: 0.2 });
      if (e.line) { const L = e.line; A.pri = true; A.add('px', e.x + Math.cos(L.a) * L.len / 2, 0.1, e.z + Math.sin(L.a) * L.len / 2, L.len, 1.6, 0xff3050, 0.25 + 0.3 * Math.abs(Math.sin(t * 20)), L.a, 1); A.pri = false; }
    }
    // player
    {
      const hero = 'hero_' + run.char.id, blink = p.inv > 0 && p.hurt <= 0 && Math.floor(t * 20) % 2 === 0;
      M.add('shadow', p.x, 0.02, p.z + 0.05, 0.9, 0.42, 0xffffff, 0, 0, 1);
      if (!blink && run.state !== 'dead') M.spr(hero, p.x, p.moving ? Math.abs(Math.sin(t * 14)) * 0.12 : 0, p.z, 1, 0xffffff, p.hurt > 0 ? 0.9 : 0, p.fx, 1 + 0.04 * Math.sin(t * (p.moving ? 14 : 3)));
      A.add('glow', p.x, 0.1, p.z, 3.2, 3.2, drop ? 0xff5ccd : this.b.acc, 0.16 + 0.14 * run.beat + (drop ? 0.25 : 0), 0, 1);
      if (drop) A.add('ringthin', p.x, 0.12, p.z, 2.4 + run.beat, 2.4 + run.beat, 0xff5ccd, 1.2, t * 4, 1);
      A.add('ringthin', p.x, 0.11, p.z, 1.15 + 0.15 * run.beat, 1.15 + 0.15 * run.beat, 0xffffff, 0.55, 0, 1);
      A.pri = true;
      for (let k = 0; k < run.shield; k++) { const a = t * 2.5 + k / Math.max(1, run.shield) * TAU; M.spr('i_shield', p.x + Math.cos(a) * 0.85, 0.55, p.z + Math.sin(a) * 0.5, 0.55, 0xd8e4f0); }
      if (run.shield > 0) A.add('ringthin', p.x, 0.13, p.z, 1.9, 1.9, 0xd8e4f0, 0.9, -t * 2, 1);
      A.pri = false;
      const jg = run.jugger; if (jg && jg.t > 0) { A.add('ring', p.x, 0.14, p.z, jg.r * 2, jg.r * 2, 0xffcd75, 1.1, t * 9, 1); A.add('glow', p.x, 0.1, p.z, jg.r * 2, jg.r * 2, 0xffcd75, 0.35, 0, 1); }
      if (run.wake && run.wake.t > 0) A.add('ringthin', p.x, 0.12, p.z, 1.5, 1.5, run.wake.fire ? 0xff9a5d : 0x73eff6, 0.9, t * 5, 1);
      if (run.stillT > 0.6 && run.s.still) A.add('ringthin', p.x, 0.12, p.z, 2.1 - 0.2 * run.beat, 2.1 - 0.2 * run.beat, 0xffcd75, 0.8, 0, 1);
    }
    // orbiting blades
    const ob = run.orbs;
    if (ob && ob.t > 0) for (let k = 0; k < ob.n; k++) { const a = ob.ang + k / ob.n * TAU, x = p.x + Math.cos(a) * ob.r, z = p.z + Math.sin(a) * ob.r, s = Math.min(1, ob.t * 3); M.spr('blade', x, 0.3, z, 1.5 * s); A.add('glow', x, 0.1, z, 1.3, 1.3, ob.color, 0.7 * s); }
    // player shots
    for (const s of run.shots) {
      const r = s.r * 2;
      if (s.long) { const a = Math.atan2(s.vz, s.vx); A.add('px', s.x, 0.5, s.z, 2.2, Math.min(0.3, r * 0.5), s.color, 1.2, a, 1); A.add('px', s.x, 0.51, s.z, 1.8, Math.min(0.1, r * 0.18), 0xffffff, 1, a, 1); }
      else if (s.type === 'chakram') { A.add('ring', s.x, 0.5, s.z, r * 2.2, r * 2.2, s.color, 1.6, t * 20, 1); A.add('glow', s.x, 0.2, s.z, r * 2, r * 2, s.color, 0.8); }
      else { A.add('glow', s.x, 0.5 - r * 1.3, s.z, r * 2.6, r * 2.6, s.color, 1.2); A.add('orb', s.x, 0.5 - r * 0.5, s.z, r, r, 0xffffff, 1.3); }
      if ((s.type === 'fireball' || s.type === 'wisp') && Math.random() < 0.5) this.parts.push({ x: s.x, y: 0.5, z: s.z, vx: 0, vy: 0.5, vz: 0, life: 0.25, max: 0.25, color: s.color, size: 0.22 });
    }
    // enemy bullets: loud and readable, never dimmed
    A.pri = true;
    for (const b of run.bullets) { A.add('glow', b.x, 0.05, b.z, 1.1, 1.1, 0xff2a6a, 1.2); A.add('orb', b.x, 0.33, b.z, 0.42, 0.42, 0xffe0f0, 1.6); A.add('disc', b.x, 0.05, b.z, 0.5, 0.5, 0xff2a6a, 0.5, 0, 1); }
    A.pri = false;
    this.drawFx(dt);
    this.finish();
  }

  // ---------- menu backdrop ----------
  renderMenu(dt, charId, runes) {
    const t = this.t, beat = Math.pow(1 - (t * 1.6) % 1, 3);
    if ((t * 1.6) % 4 < dt * 1.6) this.ringT = 0;
    const cx = Math.sin(t * 0.1) * 6, cz = t * 0.7;
    this.frame(dt, cx, cz + 1.6, beat, false);
    this.fu.uArena.value = 0;
    const M = this.main, A = this.add;
    M.add('shadow', cx, 0.02, cz + 0.05, 1.8, 0.8, 0xffffff, 0, 0, 1);
    M.spr('hero_' + charId, cx, Math.abs(Math.sin(t * 8)) * 0.15, cz, 2, 0xffffff, 0, 1, 1 + 0.04 * Math.sin(t * 8));
    A.add('glow', cx, 0.1, cz, 6, 6, this.b.acc, 0.3 + 0.2 * beat, 0, 1);
    const n = runes.length;
    for (let k = 0; k < n; k++) { const a = t * 0.8 + k / n * TAU, x = cx + Math.cos(a) * 2.7, z = cz + Math.sin(a) * 1.6; M.spr('rune_' + runes[k], x, 0.9 + 0.2 * Math.sin(t * 2 + k), z, 0.8); A.add('glow', x, 0.6, z, 1.6, 1.6, ELEM[RUNES[runes[k]].elem].c, 0.5); }
    this.drawFx(dt);
    this.finish();
  }
}
