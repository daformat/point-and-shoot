/*
 * The default overlay, Glea's: a dot under the pointer that morphs onto
 * whatever it points at, a translucent wash with no outline, pressed down on
 * a click and sprung back on release.
 *
 * A closed shadow root on a display:contents host, built node by node (pages
 * with Trusted Types reject innerHTML). Every look is a --pns-* custom
 * property, set on the host by the options or by the page's own stylesheet.
 */

import { HOST_TAG } from "./dom.js";
import { intersect, union } from "./geometry.js";
import { outlinePath, roundedRectPath } from "./outline.js";
import type { Point, Rect, State } from "./types.js";

/** What the renderer draws, on every change. */
export type View = {
  state: State;
  /** null: the dot under the pointer. */
  rect: Rect | null;
  /** Each line of a selection, merged per line, when the target is one. */
  lines: Rect[] | null;
  pointer: Point;
  /** The lean towards the pointer, -1..1 each way; the renderer scales it. */
  lean: Point;
  /** Jump there, no transition (scrolling, appearing). */
  instant: boolean;
};

export type FlashStyle = {
  color?: string;
  /** Peak opacity, 0..1. */
  intensity?: number;
  /** ms */
  duration?: number;
};

export type ShakeStyle = {
  /** px */
  distance?: number;
  /** ms */
  duration?: number;
};

export type Renderer = {
  mount(): void;
  unmount(): void;
  render(view: View): void;
  /** For screenshots: off and back on. */
  setHidden(hidden: boolean): void;
  /** Only what the options set is passed: the rest comes from the --pns-* properties. */
  flash(style: FlashStyle): void;
  shake(style: ShakeStyle): void;
};

export type OverlayStyle = {
  /** The highlight's fill: any CSS color. rgb(112 88 255 / 0.2) by default, Glea's purple. */
  color?: string;
  /** The fill while pressed. Default: `color` a little stronger. */
  pressedColor?: string;
  /** The dot's fill, with nothing targeted. Default: `color` stronger. */
  dotColor?: string;
  /** Any CSS border, e.g. "2px solid hotpink". None by default. */
  border?: string;
  /** Space between the target and the highlight, px. 5 by default. */
  padding?: number;
  /** Corner radius, px. 8 by default. */
  radius?: number;
  /** The dot's size, px. 4 by default. */
  dotSize?: number;
  /** How much the highlight shrinks while pressed. 0.95 by default, 1 for none. */
  pressScale?: number;
  /** How far the highlight leans towards the pointer, px. 4 by default, 0 for none. */
  lean?: number;
  /** ms for the highlight to move between targets: 110 by default. */
  duration?: number;
  /** "user" (default) follows prefers-reduced-motion; "full"; or "none" for no transitions. */
  motion?: "user" | "full" | "none";
  zIndex?: number;
  /** A selection's lines are lit as one shape, its corners rounded this much, px. 6 by default. */
  selectionRadius?: number;
  /** Space around each of a selection's lines, px. 4 by default. */
  selectionPadding?: number;
};

const SVG = "http://www.w3.org/2000/svg";
const px = (n: number) => `${n}px`;
const ms = (n: number) => `${n}ms`;

/** Each option, the custom property it sets, and how its value is written. */
const PROPERTIES: [keyof OverlayStyle, string, (v: never) => string][] = [
  ["color", "--pns-color", String],
  ["pressedColor", "--pns-pressed-color", String],
  ["dotColor", "--pns-dot-color", String],
  ["border", "--pns-border", String],
  ["padding", "--pns-padding", px],
  ["radius", "--pns-radius", px],
  ["dotSize", "--pns-dot-size", px],
  ["pressScale", "--pns-press-scale", String],
  ["lean", "--pns-lean", px],
  ["duration", "--pns-duration", ms],
  ["zIndex", "--pns-z-index", String],
];

const SPRING =
  "linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, " +
  "1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, " +
  "1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, " +
  "0.997 69.8%, 1.003 76.9%, 1)";

const CSS = `
  :host {
    all: initial;
    --pns-color: rgb(112 88 255 / 0.2);
    --pns-pressed-color: rgb(112 88 255 / 0.3);
    --pns-dot-color: rgb(112 88 255 / 0.5);
    --pns-border: none;
    --pns-padding: 5px;
    --pns-radius: 8px;
    --pns-dot-size: 4px;
    --pns-press-scale: 0.95;
    --pns-lean: 4px;
    --pns-duration: 110ms;
    --pns-z-index: 2147483647;
    --pns-flash-color: rgb(160 140 255);
    --pns-flash-intensity: 0.55;
    --pns-flash-duration: 420ms;
    --pns-shake-distance: 4px;
    --pns-shake-duration: 820ms;
  }
  @supports (color: rgb(from red r g b)) {
    :host {
      --pns-pressed-color: rgb(from var(--pns-color) r g b / calc(alpha * 1.5));
      --pns-dot-color: rgb(from var(--pns-color) r g b / calc(alpha * 2.5));
    }
  }
  .root {
    --x: -20px; --y: -20px; --w: 0px; --h: 0px; --lx: 0; --ly: 0; --scale: 1;
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    --spring: ${SPRING};
    pointer-events: none;
  }
  .portal {
    position: fixed; inset: 0; pointer-events: none; z-index: var(--pns-z-index);
    transition: opacity 200ms ease-out;
  }
  .root.leaving .portal { opacity: 0; }
  .root.hidden .portal { visibility: hidden; transition: none; }

  .shift {
    position: absolute; inset: 0;
    transform: translate(calc(var(--lx) * var(--pns-lean)), calc(var(--ly) * var(--pns-lean) / 2));
    transition: transform 50ms linear;
  }

  .area {
    --pad: var(--pns-padding);
    position: absolute; left: 0; top: 0; box-sizing: border-box;
    width: calc(var(--w) + 2 * var(--pad));
    height: calc(var(--h) + 2 * var(--pad));
    transform: translate(calc(var(--x) - var(--pad)), calc(var(--y) - var(--pad))) scale(var(--scale));
    transform-origin: center;
    border: var(--pns-border);
    border-radius: var(--pns-radius);
    background: var(--pns-color);
    opacity: 0;
    transition:
      transform var(--pns-duration) var(--ease),
      width var(--pns-duration) var(--ease),
      height var(--pns-duration) var(--ease),
      border-radius var(--pns-duration) var(--ease),
      background-color 160ms ease-out,
      opacity 160ms ease-out;
    will-change: transform, width, height;
  }
  .root.on .area { opacity: 1; }
  /* With nothing targeted, the dot sits under the pointer: no easing. */
  .root.blank .area {
    --pad: calc(var(--pns-dot-size) / 2);
    border-radius: calc(var(--pns-dot-size) / 2);
    background: var(--pns-dot-color);
    transition: opacity 160ms ease-out;
  }
  /* The dot morphs into the first element it points at, and back when the
     pointer leaves it: frame, corners and tint together, a little longer
     than moves between elements. */
  .root.morphing .area {
    transition: transform 240ms var(--ease), width 240ms var(--ease), height 240ms var(--ease),
                border-radius 240ms var(--ease), background-color 240ms ease-out, opacity 160ms ease-out;
  }
  /* Press down, then spring back when released. */
  .root.pressed { --scale: var(--pns-press-scale); }
  .root.pressed .area { background: var(--pns-pressed-color); transition-timing-function: cubic-bezier(0.3, 0, 0.5, 1); }
  .root.released .area {
    transition: transform 520ms var(--spring), width var(--pns-duration) var(--ease),
                height var(--pns-duration) var(--ease), background-color 160ms ease-out, opacity 160ms ease-out;
  }
  /* The drawn area is what's captured: no padding around it. */
  .root.dragging .area { --pad: 0px; transition: none; }
  .root.instant .area, .root.instant .shift { transition: none; }

  /* A text selection: its lines lit as one shape, corners rounded. */
  .lines {
    position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;
    opacity: 0; transition: opacity 160ms ease-out;
  }
  .lines .fill { fill: var(--pns-color); }
  .lines .flash { fill: var(--pns-flash-color); }
  .root.selection .area { display: none; }
  .root.selection.on .lines { opacity: 1; }

  /* The shot: a flash of light inside the highlight. */
  .flash {
    position: absolute; inset: 0; border-radius: inherit;
    background: var(--pns-flash-color); opacity: 0;
  }
  .root.shot .flash { animation: pns-flash var(--pns-flash-duration) ease-out; }
  @keyframes pns-flash { 0% { opacity: var(--pns-flash-intensity); } 100% { opacity: 0; } }

  /* A miss: the highlight shakes its head. */
  .root.error .shift { animation: pns-shake var(--pns-shake-duration) cubic-bezier(.36, .07, .19, .97) both; }
  @keyframes pns-shake {
    10%, 90% { transform: translate3d(calc(var(--pns-shake-distance) * -0.25), 0, 0); }
    20%, 80% { transform: translate3d(calc(var(--pns-shake-distance) * 0.5), 0, 0); }
    30%, 50%, 70% { transform: translate3d(calc(var(--pns-shake-distance) * -1), 0, 0); }
    40%, 60% { transform: translate3d(var(--pns-shake-distance), 0, 0); }
  }
  @keyframes pns-pulse { 0%, 100% { opacity: 1; } 35% { opacity: 0.35; } }
`;

/** Reduced motion: things jump instead of gliding, the shake is a pulse, the flash is quicker. */
const REDUCED = `
  .area, .root.blank .area, .root.morphing .area, .root.released .area {
    transition: background-color 160ms ease-out, opacity 160ms ease-out;
  }
  .shift { transform: none; transition: none; }
  .root.pressed { --scale: 1; }
  .root.error .shift { animation: none; }
  .root.error .area, .root.error .lines .fill { animation: pns-pulse 400ms ease-out; }
  .root.shot .flash { animation-duration: calc(var(--pns-flash-duration) / 2); }
`;

function cssFor(motion: OverlayStyle["motion"]): string {
  if (motion === "full") {
    return CSS;
  }
  if (motion === "none") {
    return CSS + REDUCED;
  }
  return `${CSS}@media (prefers-reduced-motion: reduce) {${REDUCED}}`;
}

function el(tag: string, className: string, parent: Node): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

/** Glea's spotlight, with your look. */
export function spotlight(style: OverlayStyle = {}): Renderer {
  let host: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let area: HTMLElement | null = null;
  let lines: SVGSVGElement | null = null;
  let fill: SVGPathElement | null = null;
  let flashPath: SVGPathElement | null = null;
  let drawn: Rect[] | null = null;
  let last: View | null = null;
  let morphTimer = 0;

  function build() {
    host = document.createElement(HOST_TAG);
    // all: initial undoes page rules that reach it, like Reddit's
    // ":not(:defined) { visibility: hidden }" (it's never a defined element).
    // display: contents keeps it from making a stacking context.
    host.style.cssText =
      "all: initial !important; display: contents !important;";
    for (const [key, property, write] of PROPERTIES) {
      const value = style[key];
      if (value !== undefined) {
        host.style.setProperty(property, write(value as never));
      }
    }
    const shadow = host.attachShadow({ mode: "closed" });
    el("style", "", shadow).textContent = cssFor(style.motion);
    root = el("div", "root blank leaving", shadow);
    const portal = el("div", "portal", root);
    const shift = el("div", "shift", portal);
    area = el("div", "area", shift);
    area.setAttribute("part", "highlight dot");
    el("div", "flash", area).setAttribute("part", "flash");
    lines = document.createElementNS(SVG, "svg");
    lines.setAttribute("class", "lines");
    fill = document.createElementNS(SVG, "path");
    fill.setAttribute("class", "fill");
    fill.setAttribute("part", "selection");
    flashPath = document.createElementNS(SVG, "path");
    flashPath.setAttribute("class", "flash");
    flashPath.setAttribute("part", "flash");
    lines.append(fill, flashPath);
    shift.appendChild(lines);
  }

  function setVar(name: string, value: string) {
    root!.style.setProperty(name, value);
  }

  // The lines near the viewport, padded, as one rounded shape: or, when that's
  // too much, one rounded box around them.
  function drawLines(rects: Rect[]) {
    if (rects === drawn) {
      return;
    }
    drawn = rects;
    const pad = style.selectionPadding ?? 4;
    const radius = style.selectionRadius ?? 6;
    const margin = pad + radius + 50;
    const view = {
      x: -margin,
      y: -margin,
      width: innerWidth + 2 * margin,
      height: innerHeight + 2 * margin,
    };
    const near: Rect[] = [];
    for (const r of rects) {
      const p = {
        x: r.x - pad,
        y: r.y - pad,
        width: r.width + 2 * pad,
        height: r.height + 2 * pad,
      };
      if (intersect(p, view)) {
        near.push(p);
      }
    }
    let d = outlinePath(near, { radius });
    if (!d && near.length) {
      const box = near.reduce<Rect | null>((u, r) => union(u, r), null)!;
      d = roundedRectPath(intersect(box, view) ?? box, radius);
    }
    fill!.setAttribute("d", d ?? "");
    flashPath!.setAttribute("d", d ?? "");
  }

  function restart(className: string) {
    root!.classList.remove(className);
    void root!.offsetWidth;
    root!.classList.add(className);
  }

  return {
    mount() {
      if (!host) {
        build();
      }
      if (!host!.isConnected) {
        (document.documentElement || document).appendChild(host!);
      }
    },

    unmount() {
      host?.remove();
      last = null;
      clearTimeout(morphTimer);
    },

    render(view) {
      if (!root || !area) {
        return;
      }
      const prev = last;
      last = view;
      const list = root.classList;
      const appearing = !prev || prev.state === "idle";
      const dot = !view.rect && !view.lines;
      const wasDot = !prev || (!prev.rect && !prev.lines);

      if (view.instant || appearing) {
        list.add("instant");
      }
      if (view.rect) {
        setVar("--x", px(view.rect.x));
        setVar("--y", px(view.rect.y));
        setVar("--w", px(Math.max(0, view.rect.width)));
        setVar("--h", px(Math.max(0, view.rect.height)));
      } else {
        setVar("--x", px(view.pointer.x));
        setVar("--y", px(view.pointer.y));
        setVar("--w", "0px");
        setVar("--h", "0px");
      }
      setVar("--lx", String(view.lean.x));
      setVar("--ly", String(view.lean.y));
      if (list.contains("instant")) {
        void root.offsetHeight;
        list.remove("instant");
      }

      // Between the dot and an element, either way: a slower morph.
      if (!appearing && dot !== wasDot && view.state !== "dragging") {
        list.add("morphing");
        clearTimeout(morphTimer);
        morphTimer = window.setTimeout(() => list.remove("morphing"), 260);
      }
      if (view.state === "pressed" || view.state === "dragging") {
        list.remove("released");
      } else if (prev?.state === "pressed") {
        list.add("released");
      }
      list.toggle("on", view.state !== "idle");
      list.toggle("leaving", view.state === "idle");
      list.toggle("pressed", view.state === "pressed");
      list.toggle("dragging", view.state === "dragging");
      list.toggle("blank", dot);
      list.toggle("selection", !!view.lines);
      area.setAttribute("part", dot ? "highlight dot" : "highlight");
      host!.dataset.state = view.state;
      if (view.lines) {
        drawLines(view.lines);
      } else if (drawn) {
        drawn = null;
        fill!.setAttribute("d", "");
        flashPath!.setAttribute("d", "");
      }
      if (appearing) {
        list.remove("error", "shot", "released");
      }
    },

    setHidden(hidden) {
      root?.classList.toggle("hidden", hidden);
    },

    flash(s) {
      if (!root) {
        return;
      }
      if (s.color !== undefined) {
        setVar("--pns-flash-color", s.color);
      }
      if (s.intensity !== undefined) {
        setVar("--pns-flash-intensity", String(s.intensity));
      }
      if (s.duration !== undefined) {
        setVar("--pns-flash-duration", ms(s.duration));
      }
      restart("shot");
    },

    shake(s) {
      if (!root) {
        return;
      }
      if (s.distance !== undefined) {
        setVar("--pns-shake-distance", px(s.distance));
      }
      if (s.duration !== undefined) {
        setVar("--pns-shake-duration", ms(s.duration));
      }
      restart("error");
    },
  };
}
