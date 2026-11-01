// Renderer, cameras, tilt-shift post-processing and the badge overlay.
// Stem counts are drawn on a 2D canvas *after* post-processing so they stay sharp.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { HueSaturationShader } from 'three/addons/shaders/HueSaturationShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import type { Dir } from '../../../shared/types';
import type { Badge, World } from './world';

export interface ViewSettings {
  tilt: boolean;
  blur: number;
  topDown: boolean;
}

const SETTINGS_KEY = 'og-view';

export function loadSettings(): ViewSettings {
  const d: ViewSettings = { tilt: true, blur: 0.4, topDown: false };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return d;
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

export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private tiltPasses: ShaderPass[] = [];
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
    for (let k = 0; k < 2; k++) {
      const h = new ShaderPass(HorizontalTiltShiftShader);
      const v = new ShaderPass(VerticalTiltShiftShader);
      this.composer.addPass(h);
      this.composer.addPass(v);
      this.tiltPasses.push(h, v);
    }
    const sat = new ShaderPass(HueSaturationShader);
    sat.uniforms.saturation.value = 0.18;
    this.composer.addPass(sat);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.persp, canvas);
    Object.assign(this.controls, { enableDamping: true, enablePan: true, screenSpacePanning: false, minPolarAngle: 0.2, maxPolarAngle: 1.2 });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.orthoControls = new OrbitControls(this.ortho, canvas);
    Object.assign(this.orthoControls, { enableRotate: false, enableDamping: true, screenSpacePanning: true, minZoom: 0.6, maxZoom: 4 });
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

  /** Glide the camera so `p` is in the middle of the screen (the sharp band). */
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
    const on = s.tilt && !s.topDown;
    const amt = 2 + 14 * s.blur; // gentler than the 8x8 kit: boards here are 20-26 tiles
    for (const p of this.tiltPasses) {
      p.enabled = on && s.blur > 0;
      if (p.uniforms.h) p.uniforms.h.value = amt / innerWidth;
      if (p.uniforms.v) p.uniforms.v.value = amt / innerHeight;
      p.uniforms.r.value = 0.5;
    }
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
    const c = this.settings.topDown ? this.orthoControls : this.controls;
    c.update();
    this.clampTarget(c);
    this.world?.frame(now);
    this.onFrame(now);
    this.composer.render();
    this.drawBadges();
  }

  private drawBadges() {
    const ctx = this.ctx;
    const dpr = this.overlay.width / innerWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.world) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
