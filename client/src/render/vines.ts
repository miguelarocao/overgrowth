// The queued path drawn as a translucent vine in the team colour, one segment per
// step, with a chevron pointing the way. The next step pulses; later steps fade.
import * as THREE from 'three';
import type { QueuedMove } from '../../../shared/types';
import { KINDS, qFrom, V } from './kit';

interface Segment {
  id: number;
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  cone: THREE.Mesh;
  move: QueuedMove;
}

const leafGeo = new THREE.SphereGeometry(1, 6, 4);
const leafMat = new THREE.MeshStandardMaterial({ color: '#6DB25A', depthTest: false, transparent: true, opacity: 0.9 });

export class Vines {
  readonly group = new THREE.Group();
  private segs: Segment[] = [];
  private flashing: { group: THREE.Group; mat: THREE.MeshStandardMaterial; t0: number }[] = [];
  private key = '';

  constructor(private tilePos: (i: number, y?: number) => THREE.Vector3, private dest: (m: QueuedMove) => number) {
    this.group.renderOrder = 5;
  }

  private build(m: QueuedMove, k: number, color: THREE.Color, soft: THREE.Color) {
    const A = this.tilePos(m.from, 0.2), B = this.tilePos(this.dest(m), 0.2);
    const dir = B.clone().sub(A).normalize();
    const side = V(-dir.z, 0, dir.x);
    const mid = A.clone().lerp(B, 0.5).addScaledVector(side, (k % 2 ? -1 : 1) * 0.07).add(V(0, 0.04, 0));
    const curve = new THREE.CatmullRomCurve3([A.clone().addScaledVector(dir, 0.12), mid, B.clone().addScaledVector(dir, -0.16)]);
    const mat = new THREE.MeshStandardMaterial({ color: soft, emissive: color, emissiveIntensity: 0.6, transparent: true, opacity: 0.9, roughness: 0.5, depthTest: false });
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, m.half ? 0.016 : 0.032, 6, false), mat);
    const cone = new THREE.Mesh(KINDS.cone.geo, mat);
    const cs = m.half ? 0.05 : 0.07;
    cone.scale.set(cs, 0.15, cs);
    cone.position.copy(B.clone().addScaledVector(dir, -0.1));
    cone.position.y = 0.21;
    cone.quaternion.copy(qFrom(dir));
    g.add(tube, cone);
    [0.35, 0.68].forEach((t, n) => {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.copy(curve.getPoint(t).addScaledVector(side, n ? -0.05 : 0.05));
      leaf.scale.set(0.05, 0.014, 0.03);
      leaf.rotation.y = Math.atan2(dir.x, dir.z) + (n ? -0.6 : 0.6);
      g.add(leaf);
    });
    for (const o of g.children) o.renderOrder = 5;
    return { group: g, mat, cone };
  }

  /** Rebuild when the queue changes (cheap: queues are short). */
  set(queue: QueuedMove[], teamHex: string) {
    const key = teamHex + queue.map((m) => `${m.id}${m.half ? 'h' : ''}`).join(',');
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const color = new THREE.Color(teamHex);
    const soft = color.clone().lerp(new THREE.Color('#ffffff'), 0.4);
    queue.forEach((m, k) => {
      const { group, mat, cone } = this.build(m, k, color, soft);
      mat.opacity = Math.max(0.3, 0.92 - k * 0.07);
      this.group.add(group);
      this.segs.push({ id: m.id, group, mat, cone, move: m });
    });
  }

  /** Dropped steps flash red for ~400 ms before disappearing. */
  flash(moves: QueuedMove[], now: number) {
    const red = new THREE.Color('#FF3B30');
    moves.forEach((m, k) => {
      const { group, mat } = this.build(m, k, red, red);
      mat.emissiveIntensity = 1.4;
      this.group.add(group);
      this.flashing.push({ group, mat, t0: now });
    });
  }

  private clear() {
    for (const s of this.segs) {
      this.group.remove(s.group);
      (s.group.children[0] as THREE.Mesh).geometry.dispose();
      s.mat.dispose();
    }
    this.segs = [];
  }

  frame(now: number, reduced: boolean) {
    const first = this.segs[0];
    if (first) {
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.008);
      first.mat.emissiveIntensity = 0.8 + 0.7 * pulse;
      first.cone.scale.setScalar(1);
      const cs = (first.move.half ? 0.05 : 0.07) * (1 + 0.18 * pulse);
      first.cone.scale.set(cs, 0.15 * (1 + 0.18 * pulse), cs);
    }
    this.flashing = this.flashing.filter((f) => {
      const p = (now - f.t0) / 400;
      if (p >= 1) {
        this.group.remove(f.group);
        (f.group.children[0] as THREE.Mesh).geometry.dispose();
        f.mat.dispose();
        return false;
      }
      f.mat.opacity = 0.95 * (1 - p) * (0.6 + 0.4 * Math.sin(p * Math.PI * 4));
      return true;
    });
  }
}
