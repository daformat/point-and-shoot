import { describe, expect, it } from "vitest";

import { outlinePath, roundedRectPath } from "./outline.js";

const r = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

/** The loops of a path, each its corner points' count (M and L commands). */
const loops = (d: string | null) =>
  (d ?? "")
    .split("Z")
    .filter(Boolean)
    .map((loop) => (loop.match(/[ML]/g) ?? []).length);

describe("outlinePath", () => {
  it("draws one rect as one loop of four corners", () => {
    expect(loops(outlinePath([r(0, 0, 100, 20)]))).toEqual([4]);
  });

  it("merges overlapping rects into one shape", () => {
    // Two lines of different widths, overlapping: an L-ish shape, six corners.
    expect(loops(outlinePath([r(0, 0, 100, 24), r(0, 20, 60, 24)]))).toEqual([
      6,
    ]);
  });

  it("keeps apart rects that don't touch", () => {
    expect(loops(outlinePath([r(0, 0, 10, 10), r(50, 0, 10, 10)]))).toEqual([
      4, 4,
    ]);
  });

  it("keeps apart rects touching only at a corner", () => {
    expect(loops(outlinePath([r(0, 0, 10, 10), r(10, 10, 10, 10)]))).toEqual([
      4, 4,
    ]);
  });

  it("outlines a hole too", () => {
    const ring = [
      r(0, 0, 30, 10),
      r(0, 20, 30, 10),
      r(0, 0, 10, 30),
      r(20, 0, 10, 30),
    ];
    expect(loops(outlinePath(ring))).toEqual([4, 4]);
  });

  it("rounds corners, no more than half the shortest edge", () => {
    expect(outlinePath([r(0, 0, 100, 20)], { radius: 6 })).toContain("A6 6");
    expect(outlinePath([r(0, 0, 100, 4)], { radius: 6 })).toContain("A2 2");
  });

  it("gives up past maxCells", () => {
    const many = Array.from({ length: 50 }, (_, i) => r(i * 3, i * 7, 2, 2));
    expect(outlinePath(many, { maxCells: 100 })).toBeNull();
    expect(outlinePath(many)).not.toBeNull();
  });

  it("is fast on a page's worth of lines", () => {
    const lines = Array.from({ length: 600 }, (_, i) =>
      r((i % 3) * 300, Math.floor(i / 3) * 22, 200 + ((i * 37) % 90), 20),
    );
    const start = performance.now();
    const d = outlinePath(lines);
    expect(d).not.toBeNull();
    expect(performance.now() - start).toBeLessThan(150);
  });
});

describe("roundedRectPath", () => {
  it("is a closed rounded rect", () => {
    expect(loops(roundedRectPath(r(0, 0, 50, 20)))).toEqual([4]);
  });
});
