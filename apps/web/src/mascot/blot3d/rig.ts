/** Assembles Blot from parts: body, eyes and faces, brows, seal, arms on shoulder pivots, stars, feet, shadow. */
import {
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import {
  INK,
  TOMATO,
  TOMATO_SHADE,
  BADGE,
  BADGE_SHADE,
  WHITE,
  WHITE_SHADE,
  GLINT,
  TONGUE,
  SUN,
  inked,
  type Kit,
} from './ink';
import { place, arcGeometry, starShape, bodyGeometry } from './shape';

export interface Rig {
  root: Group;
  body: Group;
  eyes: Group[];
  pupils: { group: Group; x: number; y: number }[];
  happyEyes: Mesh[];
  mouthCalm: Mesh;
  mouthHappy: Group;
  seal: Group;
  armL: Group;
  armR: Group;
  sparks: Group;
  stars: Mesh[];
  shadow: Mesh;
  dispose: () => void;
}

export function buildBlot(kit: Kit): Rig {
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const track = <T extends BufferGeometry>(g: T) => (geos.push(g), g);
  const tm = <T extends Material>(m: T) => (mats.push(m), m);
  const ink = tm(kit.flat(INK));
  const skin = tm(kit.toon(TOMATO, TOMATO_SHADE));

  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(inked(track(bodyGeometry()), skin, kit, 0.045));

  // Eyes: big paper whites on a thin ink rim, large pupils with two catch lights, as in the drawings.
  const eyes: Group[] = [];
  const pupils: Rig['pupils'] = [];
  const happyEyes: Mesh[] = [];
  const white = track(new SphereGeometry(0.37, 48, 32));
  white.scale(1, 1.03, 0.4);
  const rim = track(new SphereGeometry(0.37, 48, 32));
  rim.scale(1.075, 1.085, 0.38);
  const pupilGeo = track(new SphereGeometry(0.2, 32, 24));
  pupilGeo.scale(1, 1.04, 0.32);
  const glintBig = track(new SphereGeometry(0.062, 16, 12));
  const glintSmall = track(new SphereGeometry(0.028, 12, 10));
  const happyGeo = track(arcGeometry(0.17, 0.038, Math.PI * 0.78, Math.PI / 2));
  for (const x of [-0.4, 0.4]) {
    const eye = new Group();
    place(eye, x, 1.68, -0.03);
    const ring = new Mesh(rim, ink);
    ring.position.z = -0.014;
    eye.add(ring, new Mesh(white, tm(kit.toon(WHITE, WHITE_SHADE))));
    const pupil = new Group();
    const px = x < 0 ? 0.045 : -0.035;
    const py = -0.02;
    pupil.position.set(px, py, 0.13);
    pupil.add(new Mesh(pupilGeo, ink));
    const g1 = new Mesh(glintBig, tm(kit.flat(GLINT)));
    g1.position.set(0.075, 0.08, 0.06);
    const g2 = new Mesh(glintSmall, tm(kit.flat(GLINT)));
    g2.position.set(-0.07, -0.075, 0.06);
    pupil.add(g1, g2);
    eye.add(pupil);
    // Closed happy eye (^), shown only while he celebrates.
    const happy = new Mesh(happyGeo, ink);
    happy.position.set(0, -0.06, 0.16);
    happy.visible = false;
    eye.add(happy);
    happyEyes.push(happy);
    body.add(eye);
    eyes.push(eye);
    pupils.push({ group: pupil, x: px, y: py });
  }

  // Soft, slightly hopeful brows: short arcs with the inner ends a touch higher.
  const browGeo = track(arcGeometry(0.13, 0.03, Math.PI * 0.42, Math.PI / 2));
  for (const [x, tilt] of [
    [-0.36, -0.16],
    [0.36, 0.16],
  ] as const) {
    const b = new Mesh(browGeo, ink);
    place(b, x, 2.17, 0.008);
    b.rotateZ(tilt);
    body.add(b);
  }

  // Mouth: a small calm smile, swapped for the big open smile of the YES drawing.
  const mouthCalm = new Mesh(track(arcGeometry(0.075, 0.024, Math.PI * 0.62, -Math.PI / 2)), ink);
  place(mouthCalm, 0, 1.235, 0.01);
  body.add(mouthCalm);
  const mouthHappy = new Group();
  place(mouthHappy, 0, 1.25, 0.0);
  const open = track(new CircleGeometry(0.165, 40, Math.PI, Math.PI));
  open.scale(1, 0.95, 1);
  const lip = track(new CircleGeometry(0.2, 40, Math.PI, Math.PI));
  lip.scale(1, 0.98, 1);
  const lipMesh = new Mesh(lip, ink);
  const openMesh = new Mesh(open, tm(kit.flat('#5a0f06')));
  openMesh.position.set(0, -0.005, 0.004);
  const tongue = new Mesh(track(new CircleGeometry(0.08, 28)), tm(kit.flat(TONGUE)));
  tongue.scale.set(1.2, 0.65, 1);
  tongue.position.set(0, -0.115, 0.008);
  mouthHappy.add(lipMesh, openMesh, tongue);
  mouthHappy.visible = false;
  body.add(mouthHappy);

  // The keyhole seal on the belly: ink rim, darker disc, dashed ring, outlined keyhole.
  const badge = new Group();
  place(badge, 0, 0.56, 0.0);
  const disc = track(new CylinderGeometry(0.46, 0.46, 0.09, 64));
  disc.rotateX(Math.PI / 2);
  const rimGeo = track(new CylinderGeometry(0.5, 0.5, 0.07, 64));
  rimGeo.rotateX(Math.PI / 2);
  const rimMesh = new Mesh(rimGeo, ink);
  rimMesh.position.z = -0.012;
  badge.add(rimMesh, new Mesh(disc, tm(kit.toon(BADGE, BADGE_SHADE))));
  const seal = new Group();
  badge.add(seal);
  const dash = track(new CapsuleGeometry(0.015, 0.055, 4, 8));
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const d = new Mesh(dash, ink);
    d.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0.05);
    d.rotation.z = a;
    seal.add(d);
  }
  const keyShape = (k: number) => {
    const sh = new Shape();
    sh.absarc(0, 0.09, 0.1 * k, -Math.PI * 0.32, Math.PI * 1.32, false);
    sh.lineTo(-0.085 * k, -0.2 + 0.09 * (1 - k));
    sh.lineTo(0.085 * k, -0.2 + 0.09 * (1 - k));
    sh.closePath();
    return sh;
  };
  const keyhole = new Mesh(track(new ShapeGeometry(keyShape(1), 24)), ink);
  keyhole.position.z = 0.05;
  const keyInset = new Mesh(track(new ShapeGeometry(keyShape(0.56), 24)), tm(kit.flat(BADGE_SHADE)));
  keyInset.position.set(0, 0.012, 0.055);
  keyhole.scale.setScalar(1.3);
  keyInset.scale.setScalar(1.3);
  seal.add(keyhole, keyInset);
  body.add(badge);

  // Arms on shoulder pivots, so both can rise when he celebrates. Chubby tubes, round hands.
  const handGeo = track(new SphereGeometry(0.145, 32, 24));
  const arm = (pts: Vector3[], hand: Vector3) => {
    const g = new Group();
    const tube = track(new TubeGeometry(new CatmullRomCurve3(pts), 32, 0.085, 16, false));
    g.add(inked(tube, skin, kit, 0.032));
    const h = inked(handGeo, skin, kit, 0.032);
    h.position.copy(hand);
    g.add(h);
    return g;
  };
  const armL = new Group();
  armL.position.set(-0.96, 1.06, 0.2);
  armL.add(
    arm(
      [new Vector3(0.06, 0, 0), new Vector3(-0.2, -0.04, 0.05), new Vector3(-0.34, -0.24, 0.07)],
      new Vector3(-0.37, -0.34, 0.07),
    ),
  );
  const armR = new Group();
  armR.position.set(0.96, 1.06, 0.2);
  armR.add(
    arm(
      [new Vector3(-0.05, 0, 0), new Vector3(0.17, 0.08, 0.04), new Vector3(0.26, 0.28, 0.06)],
      new Vector3(0.26, 0.38, 0.06),
    ),
  );
  body.add(armL, armR);

  // Sun-yellow motion marks beside the waving hand.
  const sparks = new Group();
  sparks.position.set(1.4, 1.72, 0.2);
  const sparkGeo = track(new CapsuleGeometry(0.032, 0.13, 4, 8));
  for (const [x, y, a] of [
    [-0.08, 0.18, -0.45],
    [0.12, 0.05, -0.85],
    [0.2, -0.15, -1.25],
  ] as const) {
    const sp = inked(sparkGeo, tm(kit.flat(SUN)), kit, 0.022);
    sp.position.set(x, y, 0);
    sp.rotation.z = a;
    sparks.add(sp);
  }
  root.add(sparks);

  // Celebration stars, hidden until he is poked.
  const starGeo = track(new ShapeGeometry(starShape(0.16, 0.075)));
  const starRim = track(new ShapeGeometry(starShape(0.205, 0.105)));
  const stars: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const st = new Mesh(starGeo, tm(new MeshBasicMaterial({ color: SUN, transparent: true })));
    const edge = new Mesh(starRim, tm(new MeshBasicMaterial({ color: INK, transparent: true })));
    edge.position.z = -0.005;
    st.add(edge);
    st.visible = false;
    root.add(st);
    stars.push(st);
  }

  // Feet peek out under the hem.
  const footGeo = track(new CapsuleGeometry(0.17, 0.2, 8, 16));
  for (const x of [-0.42, 0.4]) {
    const f = inked(footGeo, tm(kit.toon(BADGE, BADGE_SHADE)), kit, 0.04);
    f.position.set(x, -0.2, 0.18);
    root.add(f);
  }

  // Soft floor shadow from a radial gradient.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(20,18,16,0.4)');
  grad.addColorStop(0.6, 'rgba(20,18,16,0.28)');
  grad.addColorStop(1, 'rgba(20,18,16,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const shadowTex = new CanvasTexture(c);
  const shadowMat = tm(
    new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, side: DoubleSide }),
  );
  const shadow = new Mesh(track(new PlaneGeometry(2.9, 1.15)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.4;
  root.add(shadow);

  return {
    root,
    body,
    eyes,
    pupils,
    happyEyes,
    mouthCalm,
    mouthHappy,
    seal,
    armL,
    armR,
    sparks,
    stars,
    shadow,
    dispose: () => {
      geos.forEach(g => g.dispose());
      mats.forEach(m => m.dispose());
      shadowTex.dispose();
    },
  };
}
