import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { elementsInRect } from "./collect.js";
import { match } from "./targets.js";
import { installLayout, PAGE } from "./test-utils.js";

let restore: () => void;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  restore = installLayout();
});

afterEach(() => {
  restore();
  document.body.innerHTML = "";
});

const ids = (targets: { node: Element | Range }[]) =>
  targets.map(
    (t) => (t.node as Element).id || (t.node as HTMLElement).dataset.id,
  );

const cards = match(".card", (el) => ({
  kind: "card",
  data: { id: (el as HTMLElement).dataset.id },
}));

describe("elementsInRect", () => {
  it("takes plain selectors", () => {
    const found = elementsInRect({ x: 0, y: 90, width: 460, height: 120 }, [
      "h3",
    ]);
    expect(ids(found)).toEqual(["title-a", "title-b"]);
    expect(found[0]!.kind).toBe("element");
  });

  it("mixes native and custom matchers, in matcher order, nothing merged", () => {
    const found = elementsInRect({ x: 0, y: 90, width: 460, height: 120 }, [
      cards,
      "svg",
      ".card",
    ]);
    expect(found.map((t) => t.kind)).toEqual([
      "card",
      "card",
      "element",
      "element",
      "element",
    ]);
    expect(ids(found)).toEqual(["a", "b", "icon-a", "a", "b"]);
  });

  it("takes only what's wholly inside, or anything overlapping", () => {
    const rect = { x: 0, y: 90, width: 300, height: 120 };
    expect(ids(elementsInRect(rect, [cards]))).toEqual(["a"]);
    expect(ids(elementsInRect(rect, [cards], { mode: "overlap" }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips what map returns null for", () => {
    const onlyB = match(".card", (el) =>
      (el as HTMLElement).dataset.id === "b" ? { kind: "card" } : null,
    );
    const found = elementsInRect({ x: 0, y: 0, width: 800, height: 600 }, [
      onlyB,
    ]);
    expect(ids(found)).toEqual(["b"]);
  });

  it("skips ignored elements", () => {
    const found = elementsInRect(
      { x: 0, y: 0, width: 800, height: 600 },
      ["h3"],
      {
        ignore: "[data-id=a] *",
      },
    );
    expect(ids(found)).toEqual(["title-b"]);
  });

  it("throws for a targeter that can't collect", () => {
    expect(() =>
      elementsInRect({ x: 0, y: 0, width: 1, height: 1 }, [
        { name: "pointing-only", resolve: () => null },
      ]),
    ).toThrow(/can't collect/);
  });
});
