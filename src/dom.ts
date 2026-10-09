import type { Point } from "./types.js";

/** The overlay's host element, never targeted nor collected. */
export const HOST_TAG = "point-and-shoot";

/** Never rendered: not worth walking into. */
export const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "LINK",
  "META",
]);

/** Elements that keep pointer events to a document of their own. */
export const FRAMES = "iframe, frame, embed, object";

/** The parent, crossing out of a shadow root to its host. */
export function parentOf(node: Node): Element | null {
  if (node.parentElement) {
    return node.parentElement;
  }
  const parent = node.parentNode;
  return parent instanceof ShadowRoot ? parent.host : null;
}

/** closest(), crossing shadow roots. */
export function closestAcross(
  start: Element,
  selector: string,
): Element | null {
  for (let node: Element | null = start; node; node = parentOf(node)) {
    if (node.matches(selector)) {
      return node;
    }
  }
  return null;
}

/** root contains node, crossing shadow roots. */
export function within(root: Element | Document, node: Node): boolean {
  if (root.nodeType === Node.DOCUMENT_NODE) {
    return node.ownerDocument === root || node === root;
  }
  for (let n: Node | null = node; n; n = parentOf(n)) {
    if (n === root) {
      return true;
    }
  }
  return false;
}

/** A node's first children (at most `limit`), its open shadow root first. */
export function childrenOf(node: Node, limit: number): Node[] {
  const kids: Node[] =
    node instanceof Element && node.shadowRoot ? [node.shadowRoot] : [];
  for (let c = node.firstChild; c && kids.length < limit; c = c.nextSibling) {
    kids.push(c);
  }
  return kids;
}

/**
 * Depth-first over root's descendants (open shadow roots included) until
 * test() returns true; "skip" prunes a subtree. null: the budget ran out first.
 */
export function findContent(
  root: Node,
  test: (node: Node) => boolean | "skip",
  budget: number,
): boolean | null {
  const stack: Node[] = [root];
  while (stack.length) {
    if (--budget < 0) {
      return null;
    }
    const node = stack.pop()!;
    const result = node === root ? false : test(node);
    if (result === true) {
      return true;
    }
    if (
      result === "skip" ||
      (node instanceof Element && SKIP_TAGS.has(node.tagName))
    ) {
      continue;
    }
    stack.push(...childrenOf(node, budget).reverse());
  }
  return false;
}

/** The URL of an element's first background image, if it has one. */
export function backgroundImage(element: Element): string | null {
  const m = getComputedStyle(element).backgroundImage.match(
    /url\(\s*(['"]?)(.*?)\1\s*\)/,
  );
  return m && m[2] ? m[2] : null;
}

/** display:none or fully transparent subtrees show nothing. */
export function prunes(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.display === "none" || style.opacity === "0";
}

/** visibility: hidden or collapse. */
export function invisible(style: CSSStyleDeclaration): boolean {
  return style.visibility === "hidden" || style.visibility === "collapse";
}

export function isVisible(element: Element): boolean {
  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({
      opacityProperty: true,
      visibilityProperty: true,
    });
  }
  return !prunes(element) && !invisible(getComputedStyle(element));
}

/**
 * The elements under a point, innermost first. elementsFromPoint stops at
 * open shadow roots (web components): this looks inside them too.
 */
export function elementsAtPoint(
  point: Point,
  root: Element | Document = document,
): Element[] {
  const doc =
    root.nodeType === Node.DOCUMENT_NODE
      ? (root as Document)
      : root.ownerDocument!;
  if (typeof doc.elementsFromPoint !== "function") {
    return [];
  }
  let stack = doc.elementsFromPoint(point.x, point.y);
  for (
    let host = stack[0], depth = 0;
    host && host.shadowRoot && depth < 8;
    depth++
  ) {
    const inner = host.shadowRoot
      .elementsFromPoint(point.x, point.y)
      .filter((n) => !stack.includes(n));
    if (!inner.length) {
      break;
    }
    stack = inner.concat(stack);
    host = inner[0];
  }
  // Frames the pointer passes through (see FRAMES): the innermost one under
  // the point whose ancestor is what's on top, so nothing else covers it.
  const top = stack[0];
  for (const frame of Array.from(doc.querySelectorAll(FRAMES)).reverse()) {
    if (stack.includes(frame) || (top && !top.contains(frame))) {
      continue;
    }
    const r = frame.getBoundingClientRect();
    if (
      point.x >= r.left &&
      point.x < r.right &&
      point.y >= r.top &&
      point.y < r.bottom &&
      isVisible(frame)
    ) {
      stack = [frame, ...stack];
      break;
    }
  }
  return stack.filter(
    (node) =>
      node !== doc.body &&
      node !== doc.documentElement &&
      node.localName !== HOST_TAG &&
      within(root, node),
  );
}
