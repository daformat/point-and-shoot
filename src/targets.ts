/*
 * Targeters: what's under the pointer, and what's in a rect. Tried in order,
 * first non-null wins, so a site's own markup goes ahead of the defaults.
 */

import { lineRects, visibleRect } from "./bounds.js";
import { closestAcross, HOST_TAG, isVisible } from "./dom.js";
import { contains, intersect, near } from "./geometry.js";
import { createHeuristics, type HeuristicsOptions } from "./heuristics.js";
import type {
  CollectContext,
  Flags,
  Rect,
  ResolveContext,
  Target,
  Targeter,
} from "./types.js";

/** Marks the targeters `selection()` makes, so `selection: "ignore"` can skip them. */
export const SELECTION = Symbol("point-and-shoot.selection");

type ComposedSelection = Selection & {
  getComposedRanges?: (...args: unknown[]) => StaticRange[];
};

/** Open shadow roots in and under the nodes, nested ones included. */
function shadowRootsIn(nodes: Node[], budget = 2000): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const stack = [...nodes];
  while (stack.length && --budget > 0) {
    const node = stack.pop()!;
    if (node instanceof Element && node.shadowRoot) {
      roots.push(node.shadowRoot);
      stack.push(node.shadowRoot);
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      stack.push(c);
    }
  }
  return roots;
}

/**
 * Text selected inside open shadow roots. Chromium and WebKit show the
 * document only the host's place, as a collapsed range, though toString()
 * has the text: getComposedRanges() has the real one, given the roots.
 */
function shadowRange(sel: ComposedSelection, at: Range): Range | null {
  const doc = at.startContainer.ownerDocument ?? document;
  const container = at.startContainer;
  const hosts = [
    container.childNodes[at.startOffset - 1],
    container.childNodes[at.startOffset],
    container,
  ].filter((n): n is ChildNode => !!n);
  const roots = shadowRootsIn(hosts);
  if (!roots.length) {
    return null;
  }
  let found: AbstractRange | null = null;
  if (typeof sel.getComposedRanges === "function") {
    try {
      found = sel.getComposedRanges({ shadowRoots: roots })[0] ?? null;
    } catch {
      // Safari 17 took the roots as arguments.
      found = sel.getComposedRanges(...roots)[0] ?? null;
    }
  }
  // Chromium before getComposedRanges: each root has a selection of its own.
  if (!found || found.collapsed) {
    for (const root of roots) {
      const own = (
        root as ShadowRoot & { getSelection?: () => Selection | null }
      ).getSelection?.();
      if (own && own.rangeCount && !own.isCollapsed) {
        return own.getRangeAt(0);
      }
    }
    return null;
  }
  // A Range can't span trees: what's selected in the start's tree.
  const range = doc.createRange();
  range.setStart(found.startContainer, found.startOffset);
  if (found.endContainer.getRootNode() === found.startContainer.getRootNode()) {
    range.setEnd(found.endContainer, found.endOffset);
  } else {
    range.setEndAfter(
      found.startContainer.getRootNode().lastChild ?? found.startContainer,
    );
  }
  return range.collapsed ? null : range;
}

/**
 * The text selection, when there is one and something is selected, inside
 * open shadow roots too.
 */
export function selectionRange(doc: Document = document): Range | null {
  const sel = doc.getSelection() as ComposedSelection | null;
  if (!sel || !sel.rangeCount || !sel.toString().trim()) {
    return null;
  }
  const range = sel.getRangeAt(0);
  return range.collapsed ? shadowRange(sel, range) : range;
}

export function selectionTarget(range: Range): Target<never> {
  return { kind: "selection", node: range };
}

export type SelectionOptions = {
  /** Target the selection wherever the pointer is, not only over it. */
  anywhere?: boolean;
};

/** The text selection, while the pointer is over it (or anywhere, with `anywhere`). */
export function selection(options: SelectionOptions = {}): Targeter<never> {
  const targeter: Targeter<never> & { [SELECTION]: true } = {
    name: "selection",
    [SELECTION]: true,
    resolve: ({ point, root }) => {
      const doc =
        root.nodeType === Node.DOCUMENT_NODE
          ? (root as Document)
          : root.ownerDocument!;
      const range = selectionRange(doc);
      if (!range) {
        return null;
      }
      if (options.anywhere) {
        return selectionTarget(range);
      }
      for (const r of lineRects(range)) {
        if (near(r, point, 4)) {
          return selectionTarget(range);
        }
      }
      return null;
    },
  };
  return targeter;
}

export type ElementsOptions = Omit<HeuristicsOptions, "root"> & {
  /** Walk inline elements up to their block. true by default. */
  blocks?: boolean;
};

/**
 * Glea's heuristics: images first, then media, then the block around the
 * innermost meaningful element. Kinds: "image", "media" or "element".
 */
export function elements(options: ElementsOptions = {}): Targeter<never> {
  const blocks = options.blocks ?? true;
  let cached: {
    root: Element | Document;
    is: ReturnType<typeof createHeuristics>;
  } | null = null;
  const heuristicsFor = (root: Element | Document) => {
    if (!cached || cached.root !== root) {
      cached = { root, is: createHeuristics({ ...options, root }) };
    }
    return cached.is;
  };
  return {
    name: "elements",
    resolve: ({ stack, root }) => {
      const is = heuristicsFor(root);
      const meaningful = stack.filter(is.meaningful);
      // Prefer images under the pointer (an <img> over other image-likes).
      const images = meaningful
        .filter(is.image)
        .sort(
          (a, b) =>
            (a.tagName === "IMG" ? -1 : 1) - (b.tagName === "IMG" ? -1 : 1),
        );
      let pick =
        images[0] || meaningful.find(is.mediaTag) || meaningful[0] || null;
      if (!pick) {
        return null;
      }
      // Part of a drawing: the whole drawing.
      const svg = pick.closest("svg");
      if (svg && pick !== svg) {
        let outer: Element = svg;
        for (
          let s = svg.parentElement?.closest("svg");
          s;
          s = s.parentElement?.closest("svg")
        ) {
          outer = s;
        }
        pick = outer;
      }
      const node = blocks ? is.block(pick) : pick;
      return { kind: kindOf(node, is), node, whole: is.whole(node) };
    },
  };
}

/** "image", "media" or "element", the way `elements()` names what it finds. */
export function kindOf(
  node: Element,
  is: ReturnType<typeof createHeuristics> = createHeuristics(),
): "image" | "media" | "element" {
  if (is.image(node)) {
    return "image";
  }
  if (is.mediaTag(node)) {
    return "media";
  }
  if (is.media(node)) {
    // A box holding a picture and no text is that picture.
    return node.querySelector("img, svg, picture") ? "image" : "media";
  }
  return "element";
}

export type MatchMap<D> = (
  el: Element,
  flags: Readonly<Flags>,
) => Omit<Target<D>, "node"> | null | undefined;

/** Within the rect, by the collect mode. */
function inRect(box: Rect, rect: Rect, mode: CollectContext["mode"]) {
  return mode === "inside" ? contains(rect, box) : !!intersect(box, rect);
}

/** Elements matching `selector` inside ctx.rect, visible, in document order. */
export function collectMatches(
  selector: string,
  ctx: CollectContext,
): Element[] {
  const found: Element[] = [];
  for (const el of Array.from(ctx.root.querySelectorAll(selector))) {
    if (ctx.ignore && el.closest(ctx.ignore)) {
      continue;
    }
    if (!isVisible(el)) {
      continue;
    }
    const box = visibleRect(el);
    if (box && inRect(box, ctx.rect, ctx.mode)) {
      found.push(el);
    }
  }
  return found;
}

/**
 * Markup of your own. Pointing: the closest ancestor of anything under the
 * pointer that matches, looking through empty layers (a backdrop, a
 * transparent link) down to the first element with something of its own to
 * show. In an area: every visible match in the rect. Return null from `map`
 * to skip an element.
 */
export function match<D = unknown>(
  selector: string,
  map?: MatchMap<D>,
): Targeter<D> {
  const toTarget = (el: Element, flags: Readonly<Flags>): Target<D> | null => {
    if (!map) {
      return { kind: "element", node: el };
    }
    const fields = map(el, flags);
    return fields ? { ...fields, node: el } : null;
  };
  return {
    name: `match(${selector})`,
    resolve: (ctx: ResolveContext<D>) => {
      for (const node of ctx.stack) {
        const hit = closestAcross(node, selector);
        if (
          hit &&
          hit.localName !== HOST_TAG &&
          hit.getBoundingClientRect().width > 0
        ) {
          const target = toTarget(hit, ctx.flags);
          if (target) {
            return target;
          }
        }
        if (ctx.is.meaningful(node)) {
          break;
        }
      }
      return null;
    },
    collect: (ctx: CollectContext) =>
      collectMatches(selector, ctx)
        .map((el) => toTarget(el, ctx.flags))
        .filter((t): t is Target<D> => !!t),
  };
}

/** `[selection(), elements()]` */
export const defaultTargets: readonly Targeter<never>[] = Object.freeze([
  selection(),
  elements(),
]);
