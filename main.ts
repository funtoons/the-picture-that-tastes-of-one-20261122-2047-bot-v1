// The picture that tastes of one ingredient — HONEY.
// A program that paints one delicious picture of honey, procedurally,
// with a tiny software rasterizer and a hand-rolled PNG encoder.
// No network, no randomness at run time, no external assets:
// two runs produce byte-identical output.
//
// Subject: one ingredient, honey. A close-up honeycomb slab, a wooden
// honey dipper dripping a thick glossy ribbon of honey into a shining
// pool. Warm light, saturated amber, gloss and melt everywhere so the
// picture reads delicious even at 300 pixels across.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- utils
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
// Deterministic 2D value noise (fixed seed, no Math.random anywhere).
function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}
function fbm(x: number, y: number): number {
  return (
    vnoise(x, y) * 0.55 +
    vnoise(x * 2.13 + 7.7, y * 2.13 + 3.1) * 0.28 +
    vnoise(x * 4.31 + 13.7, y * 4.31 + 9.4) * 0.17
  );
}

// ---------------------------------------------------------------- canvas
// Float framebuffer, RGB, 0..255.
const fb = new Float32Array(W * H * 3);

function setPx(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const ia = 1 - a;
  fb[i] = fb[i] * ia + r * a;
  fb[i + 1] = fb[i + 1] * ia + g * a;
  fb[i + 2] = fb[i + 2] * ia + b * a;
}
function addPx(x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  fb[i] = clamp(fb[i] + r * a, 0, 255);
  fb[i + 1] = clamp(fb[i + 1] + g * a, 0, 255);
  fb[i + 2] = clamp(fb[i + 2] + b * a, 0, 255);
}

type RGB = [number, number, number];

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Soft filled ellipse. `feather` softens the edge in pixels.
function ellipse(
  cx: number, cy: number, rx: number, ry: number,
  c: RGB, alpha: number, feather = 1.5,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx - feather - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + feather + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - feather - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + feather + 1));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const d = dx * dx + dy * dy;
      if (d > 1.15) continue;
      const a = alpha * (1 - smoothstep(1 - feather / Math.max(rx, ry), 1, Math.sqrt(d)));
      if (a > 0.004) setPx(x, y, c[0], c[1], c[2], a);
    }
  }
}

// Ellipse ring (stroke), soft.
function ellipseRing(
  cx: number, cy: number, rx: number, ry: number, thick: number,
  c: RGB, alpha: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - rx - thick - 2));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx + thick + 2));
  const y0 = Math.max(0, Math.floor(cy - ry - thick - 2));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry + thick + 2));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = alpha * (1 - smoothstep(0, 1, Math.abs(d - 1) * Math.max(rx, ry) / thick));
      if (a > 0.004) setPx(x, y, c[0], c[1], c[2], a);
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  ellipse(cx, cy, r, r, c, alpha, 1.2);
}

// Thick line with round caps, drawn as a chain of discs.
function thickLine(
  x0: number, y0: number, x1: number, y1: number,
  r: number, c: RGB, alpha: number,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(len / (r * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(lerp(x0, x1, t), lerp(y0, y1, t), r, c, alpha);
  }
}

// Cubic bezier ribbon of varying radius, with a glossy core stripe.
function ribbon(
  p0: [number, number], p1: [number, number],
  p2: [number, number], p3: [number, number],
  r0: number, r1: number, c: RGB, hi: RGB,
): void {
  const N = 260;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] +
      3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y =
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] +
      3 * mt * t * t * p2[1] + t * t * t * p3[1];
    const r = lerp(r0, r1, t);
    // body
    disc(x, y, r, c, 0.96);
    // shaded edge: darker crescent on the right side
    disc(x + r * 0.42, y + r * 0.1, r * 0.62, [122, 66, 0], 0.28);
    // glossy core stripe, offset up-left
    disc(x - r * 0.3, y - r * 0.22, r * 0.34, hi, 0.85);
    px = x;
    py = y;
  }
  void px;
  void py;
}

// Point-in-polygon (even-odd) for a flat hexagon.
function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function hexPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Signed distance to an axis-aligned rounded rectangle.
function sdRoundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, rad: number): number {
  const qx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2 + rad;
  const qy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + rad;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad;
}

// ---------------------------------------------------------------- palette
const AMBER_DEEP: RGB = [122, 62, 0];
const AMBER: RGB = [214, 132, 16];
const AMBER_BRIGHT: RGB = [255, 178, 46];
const AMBER_GLOW: RGB = [255, 205, 92];
const SPECULAR: RGB = [255, 243, 196];
const WAX_LIGHT: RGB = [232, 169, 60];
const WAX_MID: RGB = [185, 122, 30];
const WAX_DARK: RGB = [122, 74, 8];
const WOOD: RGB = [107, 63, 20];
const WOOD_DARK: RGB = [74, 42, 10];
const WOOD_LIGHT: RGB = [169, 122, 58];

// ---------------------------------------------------------------- scene
function paintBackground(): void {
  // Deep warm brown, darker at the top, glowing amber low centre.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const base = mix([26, 12, 2], [66, 32, 6], Math.pow(t, 1.25));
    // warm glow from upper left
    const gx = 300;
    const gy = 180;
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - gx) / 700, (y - gy) / 560);
      const glow = Math.max(0, 1 - d) * 0.55;
      const n = fbm(x * 0.012, y * 0.012);
      const r = clamp(base[0] + glow * 150 + (n - 0.5) * 7, 0, 255);
      const g = clamp(base[1] + glow * 88 + (n - 0.5) * 5, 0, 255);
      const b = clamp(base[2] + glow * 22 + (n - 0.5) * 3, 0, 255);
      const i = (y * W + x) * 3;
      fb[i] = r;
      fb[i + 1] = g;
      fb[i + 2] = b;
    }
  }
  // soft golden halo upper left
  ellipse(300, 170, 420, 300, [255, 170, 60], 0.16, 90);
  ellipse(300, 170, 240, 170, [255, 205, 110], 0.14, 70);
}

function paintHoneycomb(): void {
  // Slab body: big rounded rect, wax gradient with warm light from top.
  const x0 = 64;
  const y0 = 336;
  const x1 = 960;
  const y1 = 996;
  for (let y = Math.floor(y0); y <= y1; y++) {
    for (let x = Math.floor(x0); x <= x1; x++) {
      const d = sdRoundRect(x, y, x0, y0, x1, y1, 58);
      if (d > 2) continue;
      const edge = 1 - smoothstep(-2, 2, d);
      const t = (y - y0) / (y1 - y0);
      const base = mix(WAX_LIGHT, WAX_DARK, Math.pow(t, 1.1));
      const n = fbm(x * 0.02, y * 0.02);
      const shade = 0.92 + n * 0.16;
      setPx(x, y, base[0] * shade, base[1] * shade, base[2] * shade, edge);
    }
  }
  // Top rim light on the slab.
  thickLine(x0 + 60, y0 + 4, x1 - 60, y0 + 4, 5, [255, 214, 130], 0.5);

  // Hexagonal cells, staggered rows, clipped to the slab.
  // Pointy-top hexagons (vertices top/bottom): width 1.732R, height 2R,
  // so rows are spaced 1.5R apart and columns 1.732R, odd rows offset.
  const R = 47;
  const dx = R * 1.732;
  const dy = R * 1.5;
  let row = 0;
  for (let cy = y0 + 62; cy < y1 - 30; cy += dy, row++) {
    const off = row % 2 === 0 ? 0 : dx / 2;
    for (let cx = x0 + 52 + off; cx < x1 - 30; cx += dx) {
      if (sdRoundRect(cx, cy, x0 + 8, y0 + 8, x1 - 8, y1 - 8, 50) > -R) continue;
      const pts = hexPoints(cx, cy, R);
      const vary = hash2(Math.round(cx), Math.round(cy));
      const depth = 0.82 + vary * 0.36;
      // cell interior: dark amber cup, brighter toward the top-left light
      const x0b = Math.floor(cx - R);
      const x1b = Math.ceil(cx + R);
      const y0b = Math.floor(cy - R);
      const y1b = Math.ceil(cy + R);
      for (let y = y0b; y <= y1b; y++) {
        for (let x = x0b; x <= x1b; x++) {
          if (!pointInPoly(x + 0.5, y + 0.5, pts)) continue;
          const u = (x - cx) / R;
          const v = (y - cy) / R;
          const dist = Math.sqrt(u * u + v * v);
          // honey surface: bright pool at the bottom of the cup
          const pool = smoothstep(0.55, -0.35, v) * 0.9 + 0.1;
          const t = clamp(dist * 0.9 + (1 - pool) * 0.25, 0, 1);
          const c = mix(AMBER_BRIGHT, AMBER_DEEP, t);
          const n = fbm(x * 0.03 + vary * 9, y * 0.03);
          const shade = (0.9 + n * 0.2) * depth;
          setPx(x, y, c[0] * shade, c[1] * shade, c[2] * shade, 0.97);
        }
      }
      // wax rim: six short thick segments, lighter on the top edges
      for (let k = 0; k < 6; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % 6];
        const topEdge = a[1] < cy && b[1] < cy;
        thickLine(a[0], a[1], b[0], b[1], 4.5, topEdge ? [255, 214, 130] : WAX_MID, 0.95);
      }
      // glossy meniscus highlight inside the top-left of each cell
      ellipse(cx - R * 0.3, cy - R * 0.34, R * 0.42, R * 0.26, SPECULAR, 0.34, 6);
      // tiny bubble in some cells
      if (vary > 0.62) {
        disc(cx + R * 0.3, cy + R * 0.28, 3.5, SPECULAR, 0.75);
      }
    }
  }
}

function paintPool(): void {
  // Glossy honey pool where the ribbon lands, bottom centre of the slab.
  const cx = 512;
  const cy = 902;
  // pool body
  for (let y = 800; y <= 985; y++) {
    for (let x = 170; x <= 854; x++) {
      const dxn = (x - cx) / 340;
      const dyn = (y - cy) / 92;
      const d = dxn * dxn + dyn * dyn;
      if (d > 1) continue;
      const a = 1 - smoothstep(0.86, 1, Math.sqrt(d));
      const t = clamp(Math.sqrt(d) * 1.1, 0, 1);
      const c = mix(AMBER_GLOW, AMBER_DEEP, t);
      const n = fbm(x * 0.02, y * 0.05);
      const shade = 0.94 + n * 0.12;
      setPx(x, y, c[0] * shade, c[1] * shade, c[2] * shade, a * 0.98);
    }
  }
  // ripple rings
  ellipseRing(cx, cy, 250, 66, 5, AMBER_GLOW, 0.4);
  ellipseRing(cx, cy, 170, 44, 4, SPECULAR, 0.32);
  ellipseRing(cx, cy, 96, 25, 3, SPECULAR, 0.28);
  // big specular streak on the pool
  ellipse(cx - 90, cy - 26, 150, 26, SPECULAR, 0.3, 14);
  ellipse(cx + 60, cy + 12, 90, 15, AMBER_GLOW, 0.3, 10);
  // bubbles on the pool
  const bubbles: [number, number, number][] = [
    [640, 872, 9], [700, 900, 6], [380, 890, 7], [430, 930, 5], [590, 936, 6], [330, 862, 4],
  ];
  for (const [bx, by, br] of bubbles) {
    disc(bx, by, br, [255, 220, 130], 0.85);
    disc(bx - br * 0.3, by - br * 0.3, br * 0.45, SPECULAR, 0.9);
  }
}

function paintDipper(): void {
  // Wooden honey dipper, handle from lower-left up to the head at top-right.
  // Soft shadow of the dipper on the comb.
  thickLine(210, 972, 640, 372, 26, [40, 18, 2], 0.35);
  // handle
  const hx0 = 168;
  const hy0 = 1006;
  const hx1 = 612;
  const hy1 = 396;
  thickLine(hx0, hy0, hx1, hy1, 21, WOOD_DARK, 1);
  thickLine(hx0, hy0, hx1, hy1, 16, WOOD, 1);
  // wood grain highlight along the handle
  thickLine(hx0 + 6, hy0 - 8, hx1 + 2, hy1 - 6, 4, WOOD_LIGHT, 0.55);
  // head: a short, fat, grooved cylinder at the end of the handle,
  // honey-coated. Five discs along the axis; the dark rings between
  // them read as the dipper's grooves.
  const ux = (hx1 - hx0) / Math.hypot(hx1 - hx0, hy1 - hy0);
  const uy = (hy1 - hy0) / Math.hypot(hx1 - hx0, hy1 - hy0);
  const px = -uy;
  const py = ux;
  const headCx = hx1 + ux * 58;
  const headCy = hy1 + uy * 58;
  for (let s = -2; s <= 2; s++) {
    const cx = headCx + ux * s * 22;
    const cy = headCy + uy * s * 22;
    const r = 52 - Math.abs(s) * 3.5;
    disc(cx, cy, r, WOOD_DARK, 1);
  }
  for (let s = -2; s <= 2; s++) {
    const cx = headCx + ux * s * 22;
    const cy = headCy + uy * s * 22;
    const r = 47 - Math.abs(s) * 3.5;
    // alternate amber and deep groove amber so the grooves show
    disc(cx, cy, r, s % 2 === 0 ? AMBER : [168, 96, 6], 0.97);
  }
  // groove rings: dark bands across the head, perpendicular to its axis
  for (const s of [-1.5, -0.5, 0.5, 1.5]) {
    const cx = headCx + ux * s * 22;
    const cy = headCy + uy * s * 22;
    thickLine(cx - px * 40, cy - py * 40, cx + px * 40, cy + py * 40, 4, [120, 64, 0], 0.85);
  }
  // one soft gloss highlight along the head's lit side (no dots)
  ellipse(
    headCx + px * -18, headCy + py * -18, 16, 34, SPECULAR, 0.5, 10,
  );
  // honey blob hanging off the bottom tip of the head
  disc(headCx - ux * 52, headCy - uy * 52, 26, AMBER, 1);
  disc(headCx - ux * 52 - 6, headCy - uy * 52 - 8, 12, AMBER_GLOW, 0.9);
  disc(headCx - ux * 52 - 9, headCy - uy * 52 - 11, 5, SPECULAR, 0.9);
  void px;
  void py;
}

function paintRibbonAndDrops(): void {
  // Thick ribbon of honey falling from the dipper head into the pool.
  ribbon(
    [615, 391], [540, 510], [600, 650], [520, 838],
    30, 17, AMBER, SPECULAR,
  );
  // second, thinner ribbon strand beside it
  ribbon(
    [636, 400], [610, 520], [640, 660], [556, 830],
    11, 7, AMBER_BRIGHT, SPECULAR,
  );
  // mid-air droplet, teardrop shape
  disc(596, 560, 13, AMBER, 1);
  ellipse(596, 546, 8, 14, AMBER, 1);
  disc(592, 552, 4, SPECULAR, 0.9);
  // small droplet near the pool
  disc(548, 786, 8, AMBER_BRIGHT, 1);
  disc(545, 782, 3, SPECULAR, 0.9);
  // splash crown where the ribbon hits the pool
  ellipse(520, 838, 46, 14, AMBER_BRIGHT, 0.95, 4);
  disc(486, 828, 7, AMBER_GLOW, 0.95);
  disc(556, 826, 6, AMBER_GLOW, 0.95);
  disc(512, 824, 5, SPECULAR, 0.9);
  // scattered glossy droplets on the comb
  const drops: [number, number, number][] = [
    [240, 620, 12], [760, 600, 10], [830, 700, 13], [180, 760, 9], [700, 760, 8], [330, 700, 7],
  ];
  for (const [dx, dy, dr] of drops) {
    disc(dx, dy, dr, AMBER_BRIGHT, 0.95);
    disc(dx - dr * 0.3, dy - dr * 0.35, dr * 0.4, SPECULAR, 0.85);
  }
}

function paintFinish(): void {
  // Warm light bloom top-left over everything, very soft.
  ellipse(240, 130, 380, 260, [255, 190, 90], 0.07, 120);
  // Vignette: darken the corners so the eye stays on the honey.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const v = smoothstep(0.72, 1.35, d) * 0.34;
      if (v > 0.003) {
        const i = (y * W + x) * 3;
        fb[i] *= 1 - v;
        fb[i + 1] *= 1 - v;
        fb[i + 2] *= 1 - v;
      }
    }
  }
  // Fine grain for a photographic feel (deterministic).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hash2(x, y) - 0.5;
      const i = (y * W + x) * 3;
      fb[i] = clamp(fb[i] + n * 2, 0, 255);
      fb[i + 1] = clamp(fb[i + 1] + n * 2, 0, 255);
      fb[i + 2] = clamp(fb[i + 2] + n * 2, 0, 255);
    }
  }
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 3;
      const di = row + 1 + x * 3;
      // Quantize to even values: halves the colour entropy, so the PNG
      // stays well under 1 MiB, with no visible difference.
      raw[di] = clamp(Math.round(fb[si] / 2) * 2, 0, 255);
      raw[di + 1] = clamp(Math.round(fb[si + 1] / 2) * 2, 0, 255);
      raw[di + 2] = clamp(Math.round(fb[si + 2] / 2) * 2, 0, 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- main
function main(): void {
  const t0 = Date.now();
  paintBackground();
  paintHoneycomb();
  paintPool();
  paintDipper();
  paintRibbonAndDrops();
  paintFinish();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'entry.png');
  writeFileSync(out, png);
  const ms = Date.now() - t0;
  console.log(`wrote ${out} ${png.length} bytes in ${ms} ms`);
}

main();
