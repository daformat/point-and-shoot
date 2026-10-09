/*
 * happy-dom has no layout: boxes come from a data-rect="x y width height"
 * attribute, and elementsFromPoint from those boxes, innermost first.
 */

import type { Rect } from "./types.js";

function rectOf(el: Element): Rect {
  const attr = el.getAttribute("data-rect");
  if (!attr) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const [x, y, width, height] = attr.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { x, y, width, height };
}

function domRect(r: Rect): DOMRect {
  return {
    ...r,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
    toJSON: () => r,
  } as DOMRect;
}

function depth(el: Element): number {
  let d = 0;
  for (let n: Element | null = el; n; n = n.parentElement) {
    d++;
  }
  return d;
}

export function installLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  const originalFromPoint = document.elementsFromPoint;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return domRect(rectOf(this));
  };
  document.elementsFromPoint = (x: number, y: number) =>
    Array.from(document.querySelectorAll("[data-rect]"))
      .filter((el) => {
        const r = rectOf(el);
        return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
      })
      .sort((a, b) => depth(b) - depth(a));
  return () => {
    Element.prototype.getBoundingClientRect = original;
    document.elementsFromPoint = originalFromPoint;
  };
}

/** A pointer event at (x, y), dispatched on what's there (or the body). */
export function pointer(
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
): PointerEvent {
  const event = new PointerEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerType: "mouse",
    pointerId: 1,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  const target = document.elementsFromPoint(x, y)[0] ?? document.body;
  target.dispatchEvent(event);
  return event;
}

/** Move there, press and release: a click. */
export function click(x: number, y: number, init: PointerEventInit = {}) {
  pointer("pointermove", x, y, init);
  const down = pointer("pointerdown", x, y, init);
  const up = pointer("pointerup", x, y, init);
  return { down, up };
}

export function key(name: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
}

export const tick = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Two animation frames. */
export const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

export const PAGE = `
  <style>em { display: inline; }</style>
  <main data-rect="0 0 800 600">
    <p id="intro" data-rect="20 20 400 40">Some <em id="em" data-rect="60 20 40 20">words</em> in a paragraph.</p>
    <div class="card" data-id="a" data-rect="20 100 200 100">
      <h3 id="title-a" data-rect="30 110 180 20">Card A</h3>
      <svg id="icon-a" data-rect="30 150 20 20"></svg>
    </div>
    <div class="card" data-id="b" data-rect="240 100 200 100">
      <h3 id="title-b" data-rect="250 110 180 20">Card B</h3>
    </div>
    <img id="photo" alt="A photo" src="https://example.com/photo.jpg" data-rect="20 220 300 200" />
    <div id="toolbar" data-rect="600 20 100 40"><button id="button" data-rect="610 25 80 30">Tool</button></div>
    <div id="empty" data-rect="500 300 100 100"></div>
  </main>
`;
