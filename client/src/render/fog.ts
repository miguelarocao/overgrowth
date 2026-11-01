// Fog of war, faked for readability: unexplored ground is dimmed (a "shroud")
// with soft drifting cloud shadows, and a thin layer of broken clouds hovers high
// above it. The city stays readable underneath; only who-owns-what is unknown.
// Both layers read a per-tile fog texture (linearly filtered, so edges are soft)
// and drift with fractal noise. The clouds can be switched off in settings.
import * as THREE from 'three';

const CLOUD_Y = 2.8;
const BASE = new THREE.Color('#2A3540');

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uFog;
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uCloud;   // 0 = ground shroud, 1 = cloud layer
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 5; k++) { v += a * noise(p); p = p * 2.02 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 tile = vec2(vUv.x, 1.0 - vUv.y) * uSize;       // board coords, 1 unit per tile
    vec2 drift = vec2(uTime * 0.05, uTime * 0.02);
    // Same cloud field for both layers; the shroud reads it offset, like a shadow cast by the sun.
    float clouds = fbm(tile * 0.32 + drift + uCloud * vec2(-1.2, -0.8));
    float wob = fbm(tile * 1.4 - drift * 1.5);
    vec4 f = texture2D(uFog, (tile + (vec2(clouds, wob) - 0.5) * 0.5) / uSize);
    float d = f.a;
    if (uCloud < 0.5) {
      // Shroud: dim the ground, a little darker under cloud shadows. Stops at the vision edge.
      float body = smoothstep(0.5, 0.92, d);
      float shade = 0.5 + 0.2 * smoothstep(0.45, 0.75, clouds);
      gl_FragColor = vec4(f.rgb, body * shade);
    } else {
      // Clouds: broken puffs (with gaps to see through), only over unexplored areas.
      float body = smoothstep(0.65, 1.0, d);
      float puff = smoothstep(0.55, 0.8, clouds);
      float alpha = body * puff * 0.7;
      vec3 lit = mix(vec3(0.62, 0.64, 0.66), vec3(0.97, 0.97, 0.95), smoothstep(0.5, 0.85, clouds + wob * 0.2));
      gl_FragColor = vec4(lit, alpha);
    }
  }
`;

export class Fog {
  readonly group = new THREE.Group();
  private cloudMesh: THREE.Mesh;
  private data: Uint8Array;
  private tex: THREE.DataTexture;
  private level: Float32Array;
  private target: Float32Array;
  private moving = new Set<number>();
  private mats: THREE.ShaderMaterial[] = [];
  private tint: THREE.Color[];

  constructor(W: number, H: number) {
    const n = W * H;
    this.data = new Uint8Array(n * 4);
    this.tex = new THREE.DataTexture(this.data, W, H, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.level = new Float32Array(n);
    this.target = new Float32Array(n);
    this.tint = Array.from({ length: n }, () => BASE.clone());
    const make = (cloud: number, y: number, size: number) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uFog: { value: this.tex },
          uSize: { value: new THREE.Vector2(W, H) },
          uTime: { value: 0 },
          uCloud: { value: cloud }
        }
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * W, size * H).rotateX(-Math.PI / 2), mat);
      mesh.position.y = y;
      mesh.renderOrder = 10 + cloud;
      mesh.frustumCulled = false;
      this.mats.push(mat);
      this.group.add(mesh);
      return mesh;
    };
    make(0, 0.125, 1);
    this.cloudMesh = make(1, CLOUD_Y, 1);
  }

  setClouds(on: boolean) {
    this.cloudMesh.visible = on;
  }

  /** Cover (or uncover) a tile. `tint` colours it towards whoever owned it when last seen. */
  set(i: number, hidden: boolean, tint: THREE.Color | null, instant: boolean) {
    this.target[i] = hidden ? 1 : 0;
    this.tint[i] = tint ? BASE.clone().lerp(tint, 0.35) : BASE.clone();
    if (instant) {
      this.level[i] = this.target[i];
      this.write(i);
    } else this.moving.add(i);
  }

  private write(i: number) {
    const c = this.tint[i];
    const o = i * 4; // texture row = board row; the shader flips v to match
    this.data[o] = Math.round(c.r * 255);
    this.data[o + 1] = Math.round(c.g * 255);
    this.data[o + 2] = Math.round(c.b * 255);
    this.data[o + 3] = Math.round(this.level[i] * 255);
    this.tex.needsUpdate = true;
  }

  frame(dt: number, now: number) {
    for (const m of this.mats) m.uniforms.uTime.value = now / 1000;
    if (this.moving.size) {
      const step = dt / 0.5;
      for (const i of this.moving) {
        const d = this.target[i] - this.level[i];
        if (Math.abs(d) <= step) {
          this.level[i] = this.target[i];
          this.moving.delete(i);
        } else this.level[i] += Math.sign(d) * step;
        this.write(i);
      }
    }
    this.group.visible = this.level.some((v) => v > 0);
  }

  dispose() {
    this.tex.dispose();
    for (const m of this.mats) m.dispose();
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
  }
}
