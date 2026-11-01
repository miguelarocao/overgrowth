// Renderer, cameras, controls, and the 2D overlay (stem badges, floaters and the
// top-down map layer), which is drawn on its own canvas so it is always crisp.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HueSaturationShader } from 'three/addons/shaders/HueSaturationShader.js';
import { teamColor } from '../../../shared/teams';
import type { Dir } from '../../../shared/types';
import type { Badge, World } from './world';

export interface ViewSettings {
  topDown: boolean;
  /** Mouse rotate sensitivity. */
  rotateSpeed: number;
  /** Drag and WASD pan speed multiplier. */
  panSpeed: number;
  zoomSpeed: number;
  /** Left-drag pans (right-drag rotates). False swaps them. */
  dragPans: boolean;
  /** Team colours, hatched buildings and outlines drawn over the top-down view. */
  mapLayer: boolean;
}

const SETTINGS_KEY = 'og-view2';
export const DEFAULT_VIEW: ViewSettings = { topDown: false, rotateSpeed: 0.35, panSpeed: 1, zoomSpeed: 1, dragPans: true, mapLayer: true };

export function loadSettings(): ViewSettings {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

function saveSettings(s: ViewSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

const CLOCKWISE: Dir[] = ['up', 'right', 'down', 'left'];

export interface Floater {
  pos: THREE.Vector3;
  text: string;
  color: string;
  t0: number;
  life: number;
  size: number;
}

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  readonly persp = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private controls: OrbitControls;
  private orthoControls: OrbitControls;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
  world: World | null = null;
  settings = loadSettings();
  readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  extraBadges: () => Badge[] = () => [];
  onFrame: (now: number) => void = () => {};
  private emptyScene = new THREE.Scene();
  private floaters: Floater[] = [];
  private shakeAmt = 0;
  private shakeUntil = 0;
  /** Keys currently held for panning (w, a, s, d). */
  readonly held = new Set<string>();
  private spin: { from: number; to: number; t0: number; done: number } | null = null;
  private lastFrame = 0;

  constructor(readonly canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.emptyScene.background = new THREE.Color('#59605D');

    this.overlay = overlay;
    this.ctx = overlay.getContext('2d')!;

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
    this.renderPass = new RenderPass(this.emptyScene, this.persp);
    this.composer.addPass(this.renderPass);
    const sat = new ShaderPass(HueSaturationShader);
    sat.uniforms.saturation.value = 0.18;
    this.composer.addPass(sat);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.persp, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, enablePan: true, screenSpacePanning: false, minPolarAngle: 0.15, maxPolarAngle: 1.15 });
    this.orthoControls = new OrbitControls(this.ortho, canvas);
    Object.assign(this.orthoControls, { enableRotate: false, enableDamping: true, dampingFactor: 0.12, screenSpacePanning: true, minZoom: 0.7, maxZoom: 5 });
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls.enabled = false;

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get camera(): THREE.Camera {
    return this.settings.topDown ? this.ortho : this.persp;
  }

  setWorld(world: World | null) {
    this.world?.dispose();
    this.world = world;
    this.renderPass.scene = world ? world.scene : this.emptyScene;
    if (world) this.resetCamera();
  }

  resetCamera() {
    const W = this.world?.W ?? 20;
    const vf = THREE.MathUtils.degToRad(this.persp.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.persp.aspect);
    const dist = (0.47 * W) / Math.sin(Math.min(vf, hf) / 2);
    const polar = 0.72;
    this.controls.target.set(0, 0.3, 0.6);
    this.persp.position.set(0, 0.3 + Math.cos(polar) * dist, 0.6 + Math.sin(polar) * dist);
    this.controls.minDistance = W * 0.35;
    this.controls.maxDistance = dist * 1.6;
    this.persp.far = dist * 4;
    this.persp.updateProjectionMatrix();
    this.controls.update();
    this.ortho.position.set(0, 60, 0.001);
    this.ortho.zoom = 1;
    this.orthoControls.target.set(0, 0, 0);
    this.orthoControls.update();
    this.fitOrtho();
  }

  /** Rotate the 3D camera a quarter turn around its target (animated). */
  quarterTurn(dir = 1) {
    if (this.settings.topDown) return;
    const az = this.controls.getAzimuthalAngle();
    const snapped = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
    this.spin = { from: 0, to: snapped + dir * (Math.PI / 2) - az, t0: performance.now(), done: 0 };
  }

  /** Move the camera so `p` is in the middle of the screen. */
  focus(p: THREE.Vector3, closer = false) {
    const c = this.controls;
    const offset = this.persp.position.clone().sub(c.target);
    if (closer) offset.multiplyScalar(0.72);
    c.target.set(p.x, 0.3, p.z);
    this.persp.position.copy(c.target).add(offset);
    c.update();
    if (this.settings.topDown) {
      this.orthoControls.target.set(p.x, 0, p.z);
      this.ortho.position.set(p.x, 60, p.z + 0.001);
      this.orthoControls.update();
    }
  }

  private fitOrtho() {
    // Leave room for the HUD panels along the edges.
    const W = (this.world?.W ?? 20) + 1;
    const aspect = innerWidth / innerHeight;
    const halfH = W / 2 / 0.76 / Math.min(1, aspect);
    Object.assign(this.ortho, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    this.ortho.updateProjectionMatrix();
  }

  update(patch: Partial<ViewSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.applySettings();
  }

  private applySettings() {
    const s = this.settings;
    Object.assign(this.controls, { rotateSpeed: s.rotateSpeed, panSpeed: s.panSpeed, zoomSpeed: s.zoomSpeed });
    Object.assign(this.orthoControls, { panSpeed: s.panSpeed, zoomSpeed: s.zoomSpeed });
    this.controls.mouseButtons = s.dragPans
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.enabled = !s.topDown;
    this.orthoControls.enabled = s.topDown;
    this.renderPass.camera = this.camera;
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    this.persp.fov = aspect < 1 ? 42 : 30;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.fitOrtho();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(innerWidth * dpr);
    this.overlay.height = Math.round(innerHeight * dpr);
    this.overlay.style.width = innerWidth + 'px';
    this.overlay.style.height = innerHeight + 'px';
    this.applySettings();
  }

  /** Floating text that rises and fades above a world position. */
  float(pos: THREE.Vector3, text: string, color = '#FFFFFF', size = 15, life = 1100) {
    if (this.floaters.length > 80) this.floaters.shift();
    this.floaters.push({ pos: pos.clone(), text, color, t0: performance.now(), life, size });
  }

  /** A short camera shake. Skipped for people who prefer reduced motion. */
  shake(amount: number, ms = 450) {
    if (this.reduced) return;
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeUntil = performance.now() + ms;
  }

  /** The first of `objects` (or a child of one) under a screen point. */
  pickObject(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    if (!objects.length) return null;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(objects, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !objects.includes(o)) o = o.parent;
    return o;
  }

  /** Tile under a screen point, or -1. */
  pick(clientX: number, clientY: number): number {
    if (!this.world) return -1;
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return -1;
    return this.world.tileAt(hit.x, hit.z);
  }

  /** Arrow keys follow the screen: snap the camera's heading to the nearest grid axis. */
  gridDir(screen: Dir): Dir {
    const az = this.settings.topDown ? 0 : this.controls.getAzimuthalAngle();
    const k = ((Math.round(az / (Math.PI / 2)) % 4) + 4) % 4;
    return CLOCKWISE[(CLOCKWISE.indexOf(screen) - k + 4) % 4];
  }

  private clampTarget(c: OrbitControls) {
    const W = (this.world?.W ?? 20) / 2;
    const t = c.target;
    const cx = THREE.MathUtils.clamp(t.x, -W, W), cz = THREE.MathUtils.clamp(t.z, -W, W);
    if (cx !== t.x || cz !== t.z) {
      const dx = cx - t.x, dz = cz - t.z;
      t.x = cx;
      t.z = cz;
      c.object.position.x += dx;
      c.object.position.z += dz;
    }
  }

  private blank = false;

  private frame(now: number) {
    if (!this.world) {
      // Nothing to draw (home, lobby): clear once and idle.
      if (!this.blank) {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.emptyScene, this.persp);
        this.drawBadges();
        this.blank = true;
      }
      return;
    }
    this.blank = false;
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    const c = this.settings.topDown ? this.orthoControls : this.controls;
    this.keyPan(c, dt);
    if (this.spin && !this.settings.topDown) {
      const p = Math.min(1, (now - this.spin.t0) / 320);
      const eased = 1 - Math.pow(1 - p, 3);
      const want = this.spin.to * eased;
      const off = this.persp.position.clone().sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), want - this.spin.done);
      this.persp.position.copy(this.controls.target).add(off);
      this.spin.done = want;
      if (p >= 1) this.spin = null;
    }
    c.update();
    this.clampTarget(c);
    this.world?.frame(now);
    this.onFrame(now);
    const cam = this.camera;
    let jolt: THREE.Vector3 | null = null;
    if (now < this.shakeUntil) {
      const k = this.shakeAmt * ((this.shakeUntil - now) / 450);
      jolt = new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      cam.position.add(jolt);
    } else this.shakeAmt = 0;
    this.composer.render();
    if (jolt) cam.position.sub(jolt);
    this.drawBadges();
    this.drawFloaters(now);
  }

  /** WASD panning, relative to where the camera is looking. */
  private keyPan(c: OrbitControls, dt: number) {
    if (!this.held.size || !dt) return;
    const f = (this.held.has('w') ? 1 : 0) - (this.held.has('s') ? 1 : 0);
    const r = (this.held.has('d') ? 1 : 0) - (this.held.has('a') ? 1 : 0);
    if (!f && !r) return;
    let fwd: THREE.Vector3, right: THREE.Vector3, scale: number;
    if (this.settings.topDown) {
      fwd = new THREE.Vector3(0, 0, -1);
      right = new THREE.Vector3(1, 0, 0);
      scale = (this.ortho.top - this.ortho.bottom) / this.ortho.zoom;
    } else {
      fwd = c.target.clone().sub(this.persp.position).setY(0).normalize();
      right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      scale = this.persp.position.distanceTo(c.target);
    }
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(scale * 0.7 * this.settings.panSpeed * dt);
    c.target.add(move);
    c.object.position.add(move);
  }

  private drawFloaters(now: number) {
    if (!this.floaters.length) return;
    const ctx = this.ctx;
    const v = new THREE.Vector3();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.floaters = this.floaters.filter((f) => {
      const p = (now - f.t0) / f.life;
      if (p >= 1) return false;
      v.copy(f.pos).project(this.camera);
      if (v.z > 1) return true;
      const x = ((v.x + 1) / 2) * innerWidth;
      const y = ((1 - v.y) / 2) * innerHeight - 18 - p * 42;
      const pop = p < 0.15 ? 0.6 + (p / 0.15) * 0.5 : 1.1 - Math.min(0.1, (p - 0.15) * 0.4);
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      ctx.font = `700 ${Math.round(f.size * pop)}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,14,10,0.85)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
      return true;
    });
  }

  /** Top-down map layer: team-coloured territory, hatched buildings, outlined water. */
  private drawMap() {
    const world = this.world!;
    const g = world.game;
    const ctx = this.ctx;
    const ppu = (innerHeight * this.ortho.zoom) / (this.ortho.top - this.ortho.bottom);
    const v = new THREE.Vector3();
    const s = ppu;
    for (let i = 0; i < g.tiles.length; i++) {
      const t = g.tiles[i];
      v.copy(world.tilePos(i)).project(this.ortho);
      const cx = ((v.x + 1) / 2) * innerWidth, cy = ((1 - v.y) / 2) * innerHeight;
      if (cx < -s || cy < -s || cx > innerWidth + s || cy > innerHeight + s) continue;
      const x = cx - s / 2, y = cy - s / 2;
      if (t.kind === 'building') {
        if (!t.visible) continue; // the fog keeps its secrets
        ctx.fillStyle = 'rgba(18,20,22,0.5)';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = -2; k <= 2; k++) {
          ctx.moveTo(x + Math.max(0, k) * s / 3, y + Math.max(0, -k) * s / 3);
          ctx.lineTo(x + s - Math.max(0, -k) * s / 3, y + s - Math.max(0, k) * s / 3);
        }
        ctx.stroke();
        continue;
      }
      if (!t.visible) continue;
      if (t.owner !== null) {
        const c = teamColor(g.teamOf(t.owner));
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = c;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c;
        ctx.lineWidth = t.isMother ? 3.5 : 1.5;
        ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
        if (t.isMother) {
          ctx.font = `${Math.round(s * 0.36)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('👑', cx, y + s * 0.2);
        }
      }
      if (t.kind === 'water') {
        ctx.strokeStyle = '#8FD0F0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawBadges() {
    const ctx = this.ctx;
    const dpr = this.overlay.width / innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.world) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.settings.topDown && this.settings.mapLayer) this.drawMap();
    const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const w = innerWidth, h = innerHeight;
    const all = [...this.world.badges, ...this.extraBadges()];
    const v = new THREE.Vector3();
    const camPos = cam.position;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2);
    const orthoPpu = (h * this.ortho.zoom) / (this.ortho.top - this.ortho.bottom);
    const items: { x: number; y: number; d: number; s: number; b: Badge }[] = [];
    for (const b of all) {
      v.copy(b.pos).project(cam);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      const d = camPos.distanceTo(b.pos);
      const ppu = this.settings.topDown ? orthoPpu : h / 2 / (tanHalf * d);
      items.push({ x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, d, s: ppu, b });
    }
    items.sort((a, b) => b.d - a.d);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      const { b } = it;
      // Size follows the tile's on-screen size, so far-away neighbours don't pile up.
      let bh = Math.max(11, Math.min(28, it.s * 0.3));
      if (b.small) bh *= 0.78;
      const font = Math.max(8, Math.round(bh * 0.66));
      const bw = Math.min(Math.max(bh * 1.55, b.text.length * font * 0.62 + bh * 0.75), Math.max(it.s * 0.94, b.text.length * font * 0.62 + 4));
      const x = it.x - bw / 2, y = it.y - bh / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, bh * 0.32);
      ctx.fillStyle = b.ghost ? 'rgba(10,14,10,0.45)' : 'rgba(10,14,10,0.82)';
      ctx.fill();
      ctx.lineWidth = b.ghost ? 1.6 : 2;
      ctx.strokeStyle = b.ring;
      if (b.ghost) ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = b.ghost ? 'rgba(255,255,255,0.9)' : '#FFFFFF';
      ctx.font = `600 ${font}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      ctx.fillText(b.text, it.x, it.y + 0.5);
    }
  }
}
