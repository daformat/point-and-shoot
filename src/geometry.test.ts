import { describe, expect, it } from "vitest";

import {
  contains,
  intersect,
  lean,
  near,
  spanning,
  union,
} from "./geometry.js";

const r = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

describe("geometry", () => {
  it("unions", () => {
    expect(union(r(0, 0, 10, 10), r(5, 5, 10, 10))).toEqual(r(0, 0, 15, 15));
    expect(union(null, r(1, 2, 3, 4))).toEqual(r(1, 2, 3, 4));
  });

  it("intersects, per axis", () => {
    expect(intersect(r(0, 0, 10, 10), r(5, 5, 10, 10))).toEqual(r(5, 5, 5, 5));
    expect(intersect(r(0, 0, 10, 10), r(20, 20, 5, 5))).toBeNull();
    expect(intersect(r(0, 0, 10, 10), r(5, 5, 10, 10), true, false)).toEqual(
      r(5, 0, 5, 10),
    );
  });

  it("contains", () => {
    expect(contains(r(0, 0, 10, 10), r(2, 2, 5, 5))).toBe(true);
    expect(contains(r(0, 0, 10, 10), r(8, 8, 5, 5))).toBe(false);
  });

  it("is near within the slack", () => {
    expect(near(r(0, 0, 10, 10), { x: 25, y: 5 }, 20)).toBe(true);
    expect(near(r(0, 0, 10, 10), { x: 35, y: 5 }, 20)).toBe(false);
    expect(near(null, { x: 0, y: 0 }, 20)).toBe(false);
  });

  it("spans two points either way", () => {
    expect(spanning({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual(r(0, 5, 10, 15));
  });

  it("leans towards the pointer, at most 1", () => {
    expect(lean(r(0, 0, 100, 100), { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
    const far = lean(r(0, 0, 100, 100), { x: 500, y: -500 });
    expect(far).toEqual({ x: 1, y: -1 });
  });
});
