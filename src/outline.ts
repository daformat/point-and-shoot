/*
 * The union of rects as one outline, corners rounded: a selection's lines lit
 * as a single shape instead of a stack of boxes.
 *
 * The rects' edges make a grid (coordinates compressed to the edges that
 * exist); its cells are filled from a 2D difference array, and the boundary
 * between filled and empty cells is walked into loops, clockwise around
 * shapes and counter-clockwise around holes. Linear in the grid's cells, which
 * `maxCells` bounds: past it, there's no outline (draw the bounds instead).
 */

import type { Rect } from "./types.js";

export type OutlineOptions = {
  /** Corner radius, px: 6 by default. Short edges get half their length. */
  radius?: number;
  /** The most grid cells to work through before giving up: 160 000 by default. */
  maxCells?: number;
};

/** Half-pixel steps: edges a hair apart are one edge. */
const snap = (v: number) => Math.round(v * 2) / 2;

function sortedUnique(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || out[out.length - 1] !== v) {
      out.push(v);
    }
  }
  return out;
}

/** The SVG path of rounded corners around a closed loop of corner points. */
function roundedLoop(xs: number[], ys: number[], radius: number): string {
  const n = xs.length;
  let d = "";
  for (let k = 0; k < n; k++) {
    const px = xs[(k + n - 1) % n]!;
    const py = ys[(k + n - 1) % n]!;
    const cx = xs[k]!;
    const cy = ys[k]!;
    const nx = xs[(k + 1) % n]!;
    const ny = ys[(k + 1) % n]!;
    const inLen = Math.abs(cx - px) + Math.abs(cy - py);
    const outLen = Math.abs(nx - cx) + Math.abs(ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    // Unit directions (edges are axis-aligned).
    const ix = Math.sign(cx - px);
    const iy = Math.sign(cy - py);
    const ox = Math.sign(nx - cx);
    const oy = Math.sign(ny - cy);
    const ax = cx - ix * r;
    const ay = cy - iy * r;
    const bx = cx + ox * r;
    const by = cy + oy * r;
    // y points down: a positive cross product is a clockwise turn.
    const sweep = ix * oy - iy * ox > 0 ? 1 : 0;
    d += `${k === 0 ? "M" : "L"}${ax} ${ay}`;
    d += r > 0 ? `A${r} ${r} 0 0 ${sweep} ${bx} ${by}` : "";
  }
  return d + "Z";
}

/**
 * The outline of the rects' union as an SVG path (`fill-rule: nonzero`), or
 * null when there's nothing to draw or it would take more than `maxCells`.
 */
export function outlinePath(
  rects: readonly Rect[],
  options: OutlineOptions = {},
): string | null {
  const radius = options.radius ?? 6;
  const maxCells = options.maxCells ?? 160_000;
  const boxes = rects.filter((r) => r.width > 0 && r.height > 0);
  if (!boxes.length) {
    return null;
  }
  const xs = sortedUnique(
    boxes.flatMap((r) => [snap(r.x), snap(r.x + r.width)]),
  );
  const ys = sortedUnique(
    boxes.flatMap((r) => [snap(r.y), snap(r.y + r.height)]),
  );
  const W = xs.length - 1;
  const H = ys.length - 1;
  if (W < 1 || H < 1 || W * H > maxCells) {
    return null;
  }
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));

  // Coverage per cell: a difference array, then prefix sums.
  const stride = W + 1;
  const diff = new Int32Array((W + 1) * (H + 1));
  for (const r of boxes) {
    const x0 = xi.get(snap(r.x))!;
    const x1 = xi.get(snap(r.x + r.width))!;
    const y0 = yi.get(snap(r.y))!;
    const y1 = yi.get(snap(r.y + r.height))!;
    if (x0 === x1 || y0 === y1) {
      continue;
    }
    diff[y0 * stride + x0]! += 1;
    diff[y0 * stride + x1]! -= 1;
    diff[y1 * stride + x0]! -= 1;
    diff[y1 * stride + x1]! += 1;
  }
  const filled = new Uint8Array(W * H);
  const row = new Int32Array(W + 1);
  for (let j = 0; j < H; j++) {
    let run = 0;
    for (let i = 0; i < W; i++) {
      run += diff[j * stride + i]!;
      row[i] = row[i]! + run;
      filled[j * W + i] = row[i]! > 0 ? 1 : 0;
    }
  }
  const at = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < W && j < H ? filled[j * W + i]! : 0;

  // Boundary edges between filled and empty cells, the filled side on the
  // right: up to two leave any grid vertex (where shapes touch at a corner).
  const vertices = (W + 1) * (H + 1);
  const out1 = new Int32Array(vertices).fill(-1);
  const out2 = new Int32Array(vertices).fill(-1);
  const edgeFrom: number[] = [];
  const edgeTo: number[] = [];
  const addEdge = (from: number, to: number) => {
    const id = edgeFrom.length;
    edgeFrom.push(from);
    edgeTo.push(to);
    if (out1[from] === -1) {
      out1[from] = id;
    } else {
      out2[from] = id;
    }
  };
  const v = (i: number, j: number) => j * stride + i;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!filled[j * W + i]) {
        continue;
      }
      if (!at(i, j - 1)) {
        addEdge(v(i, j), v(i + 1, j));
      }
      if (!at(i + 1, j)) {
        addEdge(v(i + 1, j), v(i + 1, j + 1));
      }
      if (!at(i, j + 1)) {
        addEdge(v(i + 1, j + 1), v(i, j + 1));
      }
      if (!at(i - 1, j)) {
        addEdge(v(i, j + 1), v(i, j));
      }
    }
  }

  // Walk the edges into loops, keeping only the corners. Where two edges
  // leave a vertex, turn right: shapes touching at a corner stay apart.
  const used = new Uint8Array(edgeFrom.length);
  const dir = (e: number) => {
    const from = edgeFrom[e]!;
    const to = edgeTo[e]!;
    return [
      Math.sign((to % stride) - (from % stride)),
      Math.sign(Math.floor(to / stride) - Math.floor(from / stride)),
    ] as const;
  };
  let d = "";
  for (let start = 0; start < edgeFrom.length; start++) {
    if (used[start]) {
      continue;
    }
    const cornersX: number[] = [];
    const cornersY: number[] = [];
    let e = start;
    let [dx, dy] = dir(e);
    for (let guard = 0; guard <= edgeFrom.length; guard++) {
      used[e] = 1;
      const to = edgeTo[e]!;
      let next = out1[to]!;
      const other = out2[to]!;
      if (other !== -1) {
        // Prefer a right turn: (dx, dy) → (-dy, dx) with y down.
        const [ax, ay] = dir(next);
        if (!(ax === -dy && ay === dx) || used[next]) {
          next = used[other] ? next : other;
        }
      }
      const [nx, ny] = dir(next);
      if (nx !== dx || ny !== dy) {
        cornersX.push(xs[to % stride]!);
        cornersY.push(ys[Math.floor(to / stride)]!);
      }
      if (next === start || used[next]) {
        break;
      }
      e = next;
      dx = nx;
      dy = ny;
    }
    if (cornersX.length >= 4) {
      d += roundedLoop(cornersX, cornersY, radius);
    }
  }
  return d || null;
}

/** A rounded rectangle's path, for when the outline is too much. */
export function roundedRectPath(r: Rect, radius = 6): string {
  const rad = Math.min(radius, r.width / 2, r.height / 2);
  return roundedLoop(
    [r.x, r.x + r.width, r.x + r.width, r.x],
    [r.y, r.y, r.y + r.height, r.y + r.height],
    rad,
  );
}
