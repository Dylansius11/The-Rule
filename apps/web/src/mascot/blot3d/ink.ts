/** Brand inks, the flat toon shader and the boiling ink hull every Blot part is drawn with. */
import {
  BackSide,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';

/* Brand inks (tokens.css). The toon shader keeps the lit side exactly on these values. */
export const INK = '#141210';
export const TOMATO = '#ff3b1f';
export const TOMATO_SHADE = '#e02c12';
export const BADGE = '#d8321a';
export const BADGE_SHADE = '#b8240f';
export const WHITE = '#fffaf0';
export const WHITE_SHADE = '#efe5cc';
export const GLINT = '#ffffff';
export const TONGUE = '#ff7fa8';
export const SUN = '#ffe814';

const VERT_TOON = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAG_TOON = /* glsl */ `
  uniform vec3 base;
  uniform vec3 shade;
  uniform vec3 light;
  varying vec3 vN;
  void main() {
    float d = dot(normalize(vN), light);
    gl_FragColor = vec4(mix(shade, base, smoothstep(-0.06, 0.0, d)), 1.0);
    #include <colorspace_fragment>
  }
`;
/* Inverted hull outline. The width "boils" a little, stepped like hand-drawn animation frames. */
const VERT_LINE = /* glsl */ `
  uniform float width;
  uniform float frame;
  void main() {
    float boil = 1.0 + 0.28 * sin(position.y * 11.0 + frame * 2.1) * sin(position.x * 9.0 - frame * 1.7);
    vec3 p = position + normal * width * boil;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const FRAG_LINE = /* glsl */ `
  uniform vec3 ink;
  void main() {
    gl_FragColor = vec4(ink, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface Kit {
  toon: (base: string, shade: string) => ShaderMaterial;
  flat: (color: string) => MeshBasicMaterial;
  line: (width: number) => ShaderMaterial;
  frame: { value: number };
}

export function makeKit(): Kit {
  const light = { value: new Vector3(-0.32, 0.42, 0.85).normalize() };
  const frame = { value: 0 };
  const ink = new Color(INK);
  return {
    frame,
    toon: (base, shade) =>
      new ShaderMaterial({
        uniforms: { base: { value: new Color(base) }, shade: { value: new Color(shade) }, light },
        vertexShader: VERT_TOON,
        fragmentShader: FRAG_TOON,
      }),
    flat: color => new MeshBasicMaterial({ color }),
    line: width =>
      new ShaderMaterial({
        uniforms: { width: { value: width }, frame, ink: { value: ink } },
        vertexShader: VERT_LINE,
        fragmentShader: FRAG_LINE,
        side: BackSide,
      }),
  };
}

/** A filled part plus its ink hull, sharing one geometry. */
export function inked(geo: BufferGeometry, fill: Material, kit: Kit, width: number): Group {
  const g = new Group();
  g.add(new Mesh(geo, fill), new Mesh(geo, kit.line(width)));
  return g;
}
