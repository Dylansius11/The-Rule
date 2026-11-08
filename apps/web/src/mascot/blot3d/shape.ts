/** Blot's silhouette, traced from asset/mascot/master-v1.png, and helpers that seat parts on his body. */
import {
  BufferGeometry,
  LatheGeometry,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* Body silhouette, traced from asset/mascot/master-v1.png: a dome over a gently flared skirt. */
export const H = 2.66;
export const HC = 1.26;
export const R = 1.04;
export const FLARE = 0.12;
export const DEPTH = 0.8;

export function radiusAt(y: number): number {
  if (y >= HC) {
    // A superellipse crown: fuller and rounder on top than a plain ellipse, like the drawing.
    const t = (y - HC) / (H - HC);
    return R * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 1 / 2.2);
  }
  const t = 1 - y / HC;
  return R + FLARE * t * t;
}

/** Point on the front of the body at (x, y), lifted along z. */
export function front(x: number, y: number, lift = 0): Vector3 {
  const r = radiusAt(y);
  return new Vector3(x, y, DEPTH * Math.sqrt(Math.max(0, r * r - x * x)) + lift);
}

/** Orientation that lays a +z facing part flat on the body surface at (x, y). */
export function surfaceQuat(x: number, y: number): Quaternion {
  const e = 0.01;
  const p = front(x, y);
  const tx = front(x + e, y).sub(p);
  const ty = front(x, y + e).sub(p);
  const n = new Vector3().crossVectors(tx, ty).normalize();
  return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
}

export function bodyGeometry(): BufferGeometry {
  const pts: Vector2[] = [
    new Vector2(0.001, -0.04),
    new Vector2(R + FLARE - 0.14, -0.05),
    new Vector2(R + FLARE, 0.03),
  ];
  for (let i = 1; i <= 40; i++) {
    const y = 0.03 + ((H - 0.03) * i) / 40;
    pts.push(new Vector2(Math.max(0.001, radiusAt(y)), y));
  }
  let geo: BufferGeometry = new LatheGeometry(pts, 160);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    const theta = Math.atan2(v.z, v.x);
    // Scalloped hem: eight soft waves around the skirt, strongest at the very bottom.
    const f = Math.min(1, Math.max(0, 1 - (v.y + 0.05) / 0.42));
    v.y += 0.085 * Math.sin(theta * 8 + 0.6) * f * Math.min(1, r / (R + FLARE));
    // A slight hand-made wobble in the silhouette.
    const wob =
      1 + (1 - f) * (0.01 * Math.sin(theta * 3 + v.y * 4.2) + 0.006 * Math.sin(theta * 7 - v.y * 6));
    pos.setXYZ(i, v.x * wob, v.y, v.z * wob * DEPTH);
  }
  geo.computeVertexNormals();
  return geo;
}

export function place(obj: Object3D, x: number, y: number, lift: number) {
  obj.position.copy(front(x, y, lift));
  obj.quaternion.copy(surfaceQuat(x, y));
}

/** An ink arc lying in the xy plane, centred on `mid` (radians), spanning `span`. */
export function arcGeometry(radius: number, tube: number, span: number, mid: number): TorusGeometry {
  const g = new TorusGeometry(radius, tube, 10, 32, span);
  g.rotateZ(mid - span / 2);
  return g;
}

export function starShape(outer: number, inner: number): Shape {
  const sh = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  return sh;
}
