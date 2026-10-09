/*
 * Where the spotlight goes: the extent of what's rendered inside an element
 * (its text runs and media, not its padding or empty columns), cut down by
 * whatever clips it (a carousel, a sidebar).
 */

import { childrenOf, invisible, parentOf, SKIP_TAGS } from "./dom.js";
import { intersect, plain, union } from "./geometry.js";
import { createHeuristics } from "./heuristics.js";
import type { Rect, Target } from "./types.js";

const BOUNDS_BUDGET = 600;
const BOUNDS_DEPTH = 24;

const defaults = createHeuristics();

/** Folds a clipping element (overflow other than visible) into clip. */
function clipBy(
  clip: Rect | null,
  element: Element,
  style: CSSStyleDeclaration,
): Rect | null {
  const clipX = style.overflowX !== "visible" && style.overflowX !== "";
  const clipY = style.overflowY !== "visible" && style.overflowY !== "";
  if (!clipX && !clipY) {
    return clip;
  }
  const box = element.getBoundingClientRect();
  const far = { x: -1e7, y: -1e7, width: 2e7, height: 2e7 };
  return (
    intersect(clip || far, box, clipX, clipY) || {
      x: box.x,
      y: box.y,
      width: 0,
      height: 0,
    }
  );
}

/**
 * The visible area left by the element's scrolling and clipping ancestors.
 * The body's overflow is the viewport's: skipped. null: nothing clips it.
 */
export function ancestorClip(element: Element): Rect | null {
  const doc = element.ownerDocument;
  let clip: Rect | null = null;
  let fixed = getComputedStyle(element).position === "fixed";
  for (
    let a = parentOf(element), i = 0;
    a && !fixed && i < 50;
    a = parentOf(a), i++
  ) {
    if (a === doc.body || a === doc.documentElement) {
      break;
    }
    const style = getComputedStyle(a);
    clip = clipBy(clip, a, style);
    // Past a fixed element, ancestors no longer clip (roughly).
    fixed = style.position === "fixed";
  }
  return clip;
}

/** The element's box after its ancestors' overflow, or null when clipped away entirely. */
export function visibleRect(element: Element): Rect | null {
  const own = plain(element.getBoundingClientRect());
  if (own.width <= 0 || own.height <= 0) {
    return null;
  }
  const clip = ancestorClip(element);
  return clip ? intersect(own, clip) : own;
}

/**
 * The extent of what's rendered inside root: its text runs and media, each
 * clipped by the overflow of elements in between. null when the subtree is
 * too big to measure, or shows nothing.
 */
export function contentBounds(
  root: Element,
  whole: (el: Element) => boolean = defaults.whole,
): Rect | null {
  const range = root.ownerDocument.createRange();
  const stack: [Node, Rect | null, number, boolean][] = [
    [root, null, 0, false],
  ];
  let budget = BOUNDS_BUDGET;
  let raw: Rect | null = null;
  let clipped: Rect | null = null;
  while (stack.length) {
    if (--budget < 0) {
      return null;
    }
    const [node, clip, depth, hidden] = stack.pop()!;
    let r: Rect | null = null;
    let leaf = false;
    let kidClip = clip;
    let kidHidden = hidden;
    if (node.nodeType === Node.TEXT_NODE) {
      if (hidden || !/\S/.test((node as Text).data)) {
        continue;
      }
      range.selectNodeContents(node);
      r = range.getBoundingClientRect();
      leaf = true;
    } else if (node instanceof Element) {
      if (SKIP_TAGS.has(node.tagName)) {
        continue;
      }
      const style = getComputedStyle(node);
      if (style.display === "none" || style.opacity === "0") {
        continue;
      }
      kidHidden = invisible(style);
      // Media whole; past the depth limit, a box stands in for its content.
      leaf = whole(node) || depth >= BOUNDS_DEPTH;
      if (!kidHidden && (leaf || style.backgroundImage.includes("url("))) {
        r = node.getBoundingClientRect();
      }
      if (!leaf) {
        kidClip = clipBy(clip, node, style);
      }
    }
    if (r && r.width > 0 && r.height > 0) {
      raw = union(raw, plain(r));
      const c = clip ? intersect(r, clip) : r;
      if (c && c.width > 1 && c.height > 1) {
        clipped = union(clipped, plain(c));
      }
    }
    if (leaf) {
      continue;
    }
    const kids = childrenOf(node, budget);
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push([kids[i]!, kidClip, depth + 1, kidHidden]);
    }
  }
  return clipped || raw;
}

/** The spotlight rect for a target, in viewport px, or null when it shows nothing. */
export function boundsFor(
  target: Target<unknown>,
  whole: (el: Element) => boolean = defaults.whole,
): Rect | null {
  if (target.bounds) {
    return target.bounds();
  }
  const node = target.node;
  if (node instanceof Range) {
    const r = node.getBoundingClientRect();
    return r.width > 0 || r.height > 0 ? plain(r) : null;
  }
  if (!node.isConnected) {
    return null;
  }
  const own = plain(node.getBoundingClientRect());
  const isWhole = target.whole ?? whole(node);
  const content = (!isWhole && contentBounds(node, whole)) || own;
  if (content.width <= 0 || content.height <= 0) {
    return null;
  }
  const outer = ancestorClip(node);
  // Clipped away entirely: better the unclipped box than nothing.
  return (outer && intersect(content, outer)) || content;
}

/** Shown as a whole in a selection: their box, not their text. */
const REPLACED = new Set([
  "IMG",
  "SVG",
  "VIDEO",
  "CANVAS",
  "IFRAME",
  "EMBED",
  "OBJECT",
  "PICTURE",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

export type LineRectsOptions = {
  /** The most nodes to walk: 4000 by default. */
  maxNodes?: number;
  /** The most boxes to gather: 2000 by default. */
  maxRects?: number;
  /** The most milliseconds to spend: 24 by default, so a slow machine gives up sooner. */
  maxTime?: number;
};

/** Merges boxes on the same line that touch or nearly do (words, inline runs), not across columns. */
function mergeLines(rects: Rect[]): Rect[] {
  rects.sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x);
  const lines: Rect[] = [];
  for (const r of rects) {
    const mid = r.y + r.height / 2;
    let merged = false;
    // The lines just before are the only ones that can share this one's middle.
    for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
      const l = lines[k]!;
      const sameLine =
        Math.abs(l.y + l.height / 2 - mid) < Math.min(l.height, r.height) / 2;
      const gap = Math.max(l.x, r.x) - Math.min(l.x + l.width, r.x + r.width);
      // Word spacing, at most: columns and media side by side stay apart.
      const near = Math.min(
        16,
        Math.max(6, Math.min(l.height, r.height) * 0.6),
      );
      if (sameLine && gap <= near) {
        lines[k] = union(l, r)!;
        merged = true;
        break;
      }
    }
    if (!merged) {
      lines.push(r);
    }
  }
  return lines;
}

/** The node a range starts at, in document order. */
function firstNode(range: Range): Node | null {
  const c = range.startContainer;
  if (c.nodeType === Node.TEXT_NODE || !c.childNodes.length) {
    return c;
  }
  const child = c.childNodes[range.startOffset];
  if (child) {
    return child;
  }
  // Past its last child: the next node after it.
  for (let n: Node | null = c; n; n = n.parentNode) {
    if (n.nextSibling) {
      return n.nextSibling;
    }
  }
  return null;
}

function gatherLines(
  range: Range,
  maxNodes: number,
  maxRects: number,
  maxTime: number,
): Rect[] {
  const doc = range.startContainer.ownerDocument ?? document;
  const bounds = () => {
    const r = range.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [plain(r)] : [];
  };
  const rects: Rect[] = [];
  // Hidden text still has boxes: one style lookup per parent.
  const visible = new Map<Element, boolean>();
  const shows = (el: Element | null) => {
    if (!el) {
      return true;
    }
    let v = visible.get(el);
    if (v === undefined) {
      // Screen-reader-only text: its box squeezed to a pixel, its lines
      // clipped away though they still have boxes of their own.
      const box = el.getBoundingClientRect();
      v = !invisible(getComputedStyle(el)) && box.width >= 2 && box.height >= 2;
      visible.set(el, v);
    }
    return v;
  };
  // What an element's ancestors' overflow lets show (a carousel, a
  // sidebar): each element's worked out once, from its parent's.
  const clips = new Map<Element, Rect | null>();
  const clipOf = (el: Element): Rect | null => {
    if (clips.has(el)) {
      return clips.get(el)!;
    }
    const parent = parentOf(el);
    let clip: Rect | null = null;
    if (parent && parent !== doc.body && parent !== doc.documentElement) {
      const style = getComputedStyle(el);
      clip =
        style.position === "fixed"
          ? null
          : clipBy(clipOf(parent), parent, getComputedStyle(parent));
    }
    clips.set(el, clip);
    return clip;
  };
  const push = (list: ArrayLike<DOMRect>, el: Element | null) => {
    const clip = el ? clipOf(el) : null;
    for (let k = 0; k < list.length; k++) {
      const r = list[k]!;
      // Screen-reader-only text squeezed into a pixel shows nothing.
      if (r.width < 2 || r.height < 2) {
        continue;
      }
      const shown = clip ? intersect(r, clip) : plain(r);
      if (shown && shown.width >= 2 && shown.height >= 2) {
        rects.push(shown);
      }
    }
  };
  const common = range.commonAncestorContainer;
  if (common.nodeType === Node.TEXT_NODE) {
    push(range.getClientRects(), common.parentElement);
    return mergeLines(rects);
  }
  const walker = doc.createTreeWalker(
    common,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  const sub = doc.createRange();
  let node = firstNode(range);
  if (!node || !common.contains(node)) {
    return bounds();
  }
  walker.currentNode = node;
  // Past a subtree: its next sibling, or an ancestor's.
  const skip = (): Node | null => {
    let n = walker.nextSibling();
    while (!n) {
      if (!walker.parentNode()) {
        return null;
      }
      n = walker.nextSibling();
    }
    return n;
  };
  let budget = maxNodes;
  const deadline = performance.now() + maxTime;
  while (node) {
    if (
      --budget < 0 ||
      rects.length > maxRects ||
      ((budget & 63) === 0 && performance.now() > deadline)
    ) {
      // Too much to draw line by line: one box around it all.
      return bounds();
    }
    if (!range.intersectsNode(node)) {
      if (range.comparePoint(node, 0) > 0) {
        break;
      }
      node = walker.nextNode();
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      if (/\S/.test((node as Text).data) && shows(node.parentElement)) {
        sub.selectNodeContents(node);
        if (node === range.startContainer) {
          sub.setStart(node, range.startOffset);
        }
        if (node === range.endContainer) {
          sub.setEnd(node, range.endOffset);
        }
        push(sub.getClientRects(), node.parentElement);
      }
      node = walker.nextNode();
      continue;
    }
    const tag = (node as Element).tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) {
      node = skip();
    } else if (REPLACED.has(tag)) {
      push([(node as Element).getBoundingClientRect()], node as Element);
      node = skip();
    } else {
      node = walker.nextNode();
    }
  }
  return mergeLines(rects);
}

let lineCache: {
  key: string;
  start: Node;
  end: Node;
  scrollX: number;
  scrollY: number;
  lines: Rect[];
} | null = null;

/**
 * A range's lines, in viewport px: its text, line by line (runs on the same
 * line merged, columns kept apart), and its media's boxes. Past `maxNodes`,
 * `maxRects` or `maxTime`, a single box around it all. Cached until the range changes, an
 * element scrolls (see `forgetLineRects`) or the viewport resizes; the
 * page's own scrolling moves the cached lines along.
 */
export function lineRects(
  range: Range,
  options: LineRectsOptions = {},
): Rect[] {
  const view = range.startContainer.ownerDocument?.defaultView ?? window;
  const key = [
    range.startOffset,
    range.endOffset,
    view.innerWidth,
    view.innerHeight,
  ].join(",");
  const c = lineCache;
  if (
    c &&
    c.key === key &&
    c.start === range.startContainer &&
    c.end === range.endContainer
  ) {
    const dx = c.scrollX - view.scrollX;
    const dy = c.scrollY - view.scrollY;
    if (dx || dy) {
      c.lines = c.lines.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
      c.scrollX = view.scrollX;
      c.scrollY = view.scrollY;
    }
    return c.lines;
  }
  const lines = gatherLines(
    range,
    options.maxNodes ?? 4000,
    options.maxRects ?? 2000,
    options.maxTime ?? 24,
  );
  lineCache = {
    key,
    start: range.startContainer,
    end: range.endContainer,
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    lines,
  };
  return lines;
}

/** Drops the cached lines: something other than the page scrolled, or the page changed. */
export function forgetLineRects(): void {
  lineCache = null;
}
