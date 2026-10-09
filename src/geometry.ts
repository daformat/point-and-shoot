import type { AreaRect, Point, Rect } from "./types.js";

/** A DOMRect, or anything rect-like, as a plain object. */
export function plain(r: Rect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** r cut down to box on the clipped axes; null when nothing is left. */
export function intersect(
  r: Rect,
  box: Rect,
  clipX = true,
  clipY = true,
): Rect | null {
  const x = clipX ? Math.max(r.x, box.x) : r.x;
  const y = clipY ? Math.max(r.y, box.y) : r.y;
  const right = clipX
    ? Math.min(r.x + r.width, box.x + box.width)
    : r.x + r.width;
  const bottom = clipY
    ? Math.min(r.y + r.height, box.y + box.height)
    : r.y + r.height;
  return right - x > 0 && bottom - y > 0
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

/** b lies wholly within a. */
export function contains(a: Rect, b: Rect): boolean {
  return (
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height
  );
}

/** The point is within `slack` px of r. */
export function near(r: Rect | null, p: Point, slack: number): boolean {
  return (
    !!r &&
    r.x - p.x < slack &&
    p.x - (r.x + r.width) < slack &&
    r.y - p.y < slack &&
    p.y - (r.y + r.height) < slack
  );
}

/** The rect spanned by two points, a drag's start and end. */
export function spanning(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** A viewport rect, with its place in the page and the viewport's size. */
export function areaRect(viewport: Rect): AreaRect {
  const view = typeof window === "undefined" ? null : window;
  return {
    viewport: plain(viewport),
    page: {
      x: viewport.x + (view?.scrollX ?? 0),
      y: viewport.y + (view?.scrollY ?? 0),
      width: viewport.width,
      height: viewport.height,
    },
    viewportSize: {
      width: view?.innerWidth ?? 0,
      height: view?.innerHeight ?? 0,
    },
  };
}

/**
 * Which way, and how much, the spotlight leans towards the pointer: -1..1 on
 * each axis (Kosmik's displacement). The renderer scales it to px.
 */
export function lean(r: Rect, p: Point): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = (p.x - cx) / ((r.width + 10) / 2);
  const ry = (p.y - cy) / ((r.height + 10) / 2);
  return {
    x: Math.sign(rx) * Math.min(Math.sqrt(Math.abs(rx)), 1),
    y: Math.sign(ry) * Math.min(Math.sqrt(Math.abs(ry)), 1),
  };
}
