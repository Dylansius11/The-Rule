import { useEffect, useRef } from 'react';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { makeKit } from './blot3d/ink';
import { buildBlot } from './blot3d/rig';

export interface Blot3DProps {
  /** Called after the first frame is on screen, so the 2D art can hand over without a gap. */
  onReady: () => void;
  /** Called when WebGL is unavailable or the context is lost; the caller shows the 2D art. */
  onError: () => void;
  /** Called when the player pokes Blot. */
  onPoke?: () => void;
  className?: string;
}

const STAR_DIRS = [-2.5, -1.9, -1.2, 1.2, 1.9, 2.5].map(
  a => new Vector2(Math.sin(a), Math.cos(a) * 0.9 + 0.35),
);
const CELEBRATE_MS = 1100;

/**
 * Blot in toon-shaded 3D with boiling ink outlines. He watches the pointer, breathes, blinks and waves
 * now and then. Poked, he crouches, hops, beams like his YES drawing and throws up both arms while
 * stars pop. He never reacts to the rule.
 */
export default function Blot3D({ onReady, onError, onPoke, className = '' }: Blot3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onReady, onError, onPoke });
  cb.current = { onReady, onError, onPoke };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      cb.current.onError();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.cursor = 'pointer';
    canvas.style.touchAction = 'pan-y';
    el.appendChild(canvas);

    const scene = new Scene();
    // A long lens keeps the drawing's proportions (little perspective squeeze on the head).
    const camera = new PerspectiveCamera(19, 1, 0.1, 60);
    camera.position.set(0, 1.16, 11);
    camera.lookAt(0, 1.12, 0);
    const kit = makeKit();
    const rig = buildBlot(kit);
    scene.add(rig.root);

    const fit = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    // Pointer follow. Vertical attention is damped so he never stares up at the nav bar.
    const aim = { x: 0, y: 0 };
    const look = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      aim.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      aim.y = Math.max(-0.5, Math.min(0.5, -(e.clientY - (r.top + r.height * 0.42)) / window.innerHeight));
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // Poke: crouch, hop, beam, both arms up, stars, a wobble of the seal.
    const squash = { s: 1, v: 0 };
    const hop = { y: 0, v: 0, pending: 0 };
    let celebrateAt = -1e9;
    const onDown = () => {
      const now = performance.now();
      if (now - celebrateAt < 350) return;
      celebrateAt = now;
      squash.v -= 2.6;
      hop.pending = now + 90;
      cb.current.onPoke?.();
    };
    canvas.addEventListener('pointerdown', onDown);

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(el);

    let lost = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cb.current.onError();
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const t0 = performance.now();
    let last = t0;
    let nextBlink = t0 + 2000;
    let blinkAt = -1;
    let raf = 0;
    let first = true;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (lost || !visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      kit.frame.value = Math.floor(t * 7);
      const since = now - celebrateAt;
      const happy = since < CELEBRATE_MS;

      look.x += (aim.x - look.x) * Math.min(1, dt * 5);
      look.y += (aim.y - look.y) * Math.min(1, dt * 5);
      rig.root.rotation.y = look.x * 0.36;
      rig.root.rotation.x = -look.y * 0.1;
      for (const p of rig.pupils) p.group.position.set(p.x + look.x * 0.075, p.y + look.y * 0.05, 0.13);

      // Hop with gravity, triggered just after the crouch.
      if (hop.pending && now >= hop.pending) {
        hop.pending = 0;
        hop.v = 3.1;
      }
      if (hop.y > 0 || hop.v > 0) {
        hop.v -= 15 * dt;
        hop.y = Math.max(0, hop.y + hop.v * dt);
        if (hop.y === 0) {
          hop.v = 0;
          squash.v -= 1.8;
        }
      }
      const bob = 0.04 * Math.sin(t * 1.7);
      rig.root.position.y = bob + hop.y;
      rig.shadow.position.y = -0.4 - rig.root.position.y;
      rig.shadow.scale.setScalar(Math.max(0.55, 1 - rig.root.position.y * 0.9));

      // Spring squash and breathing; a little stretch while airborne.
      squash.v += (-(squash.s - 1) * 130 - squash.v * 10) * dt;
      squash.s += squash.v * dt;
      const sy = squash.s + 0.016 * Math.sin(t * 2.3) + Math.min(0.06, hop.v * 0.02);
      rig.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));

      // Face: the YES face while celebrating, otherwise open eyes with blinks.
      for (const e of rig.happyEyes) e.visible = happy;
      for (const p of rig.pupils) p.group.visible = !happy;
      rig.mouthCalm.visible = !happy;
      rig.mouthHappy.visible = happy;
      if (now >= nextBlink && blinkAt < 0) blinkAt = now;
      let open = 1;
      if (blinkAt >= 0) {
        const k = (now - blinkAt) / 160;
        open = k < 0.5 ? 1 - k * 1.8 : k < 1 ? 0.1 + (k - 0.5) * 1.8 : 1;
        if (k >= 1) {
          blinkAt = -1;
          nextBlink = now + 2600 + Math.random() * 3000;
        }
      }
      for (const e of rig.eyes) e.scale.y = happy ? 1 : Math.max(0.08, open);

      // Arms: idle waves in bursts; both shoot up while celebrating.
      const phase = t % 4.6;
      const env = phase < 1.4 ? Math.sin((phase / 1.4) * Math.PI) : 0;
      const up = happy ? Math.sin(Math.min(1, since / 160) * (Math.PI / 2)) : 0;
      rig.armR.rotation.z = (1 - up) * env * 0.32 * Math.sin(t * 13) + up * 0.5;
      rig.armL.rotation.z = -up * 2.0 - (1 - up) * 0.05 * Math.sin(t * 2.3);
      rig.sparks.visible = !happy && env > 0.05;
      rig.sparks.scale.setScalar(0.75 + 0.35 * env);

      // The seal wobbles like a jelly coin after a poke.
      const sealT = since / 1000;
      rig.seal.rotation.z = sealT < 1.2 ? 0.45 * Math.exp(-sealT * 3.6) * Math.sin(sealT * 20) : 0;

      // Stars pop out around his head and fade.
      const k = since / 900;
      rig.stars.forEach((st, i) => {
        const d = STAR_DIRS[i]!;
        const on = k >= 0 && k < 1;
        st.visible = on;
        if (!on) return;
        const ease = 1 - Math.pow(1 - k, 3);
        st.position.set(d.x * (0.72 + ease * 0.75), 1.62 + d.y * (0.42 + ease * 0.62), 1.1);
        st.scale.setScalar(Math.min(1, k * 6) * (1.1 - k * 0.4));
        st.rotation.z = (i % 2 ? 1 : -1) * k * 2.4;
        const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        (st.material as MeshBasicMaterial).opacity = fade;
        ((st.children[0] as Mesh).material as MeshBasicMaterial).opacity = fade;
      });

      renderer.render(scene, camera);
      if (first) {
        first = false;
        cb.current.onReady();
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('webglcontextlost', onLost);
      rig.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={host} aria-hidden="true" className={className} />;
}
