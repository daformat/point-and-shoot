/*
 * What's worth pointing at: Glea's rules for telling a block with something
 * of its own to show from an empty wrapper, a media element from a box that
 * merely holds one.
 */

import {
  backgroundImage,
  findContent,
  invisible,
  isVisible,
  parentOf,
  prunes,
  within,
} from "./dom.js";
import type { Heuristics } from "./types.js";

/** Elements with no text of their own that are still worth capturing whole. */
export const MEDIA_TAGS = [
  "VIDEO",
  "IFRAME",
  "EMBED",
  "OBJECT",
  "CANVAS",
  "PICTURE",
  "AUDIO",
];

/**
 * Text counts once it has a letter or a digit (any script): bullets, dashes,
 * pipes and middle dots alone are decoration.
 */
const MEANINGFUL = /[\p{L}\p{N}]/u;

/** Per-call node budget, so pointer moves stay cheap on huge subtrees. */
const PROBE_BUDGET = 300;

export type HeuristicsOptions = {
  /** Taken whole, like <img>. Default: `MEDIA_TAGS`. */
  mediaTags?: readonly string[];
  /** Larger than this, in viewports, is a wrapper not worth lighting: 1.5 by default. */
  maxArea?: number;
  /** Taller than this, in viewports: 4 by default. */
  maxHeight?: number;
  /** Nothing outside it counts. */
  root?: Element | Document;
};

export type FullHeuristics = Heuristics & {
  /** Taken whole by the spotlight: their pixels are the content. */
  whole(el: Element): boolean;
  /** One of the media tags. */
  mediaTag(el: Element): boolean;
  /** An inline element up to the block it sits in. */
  block(el: Element): Element;
};

export function isSVG(element: Element): boolean {
  return element instanceof SVGSVGElement;
}

export function createHeuristics(
  options: HeuristicsOptions = {},
): FullHeuristics {
  const mediaTags = new Set(
    (options.mediaTags ?? MEDIA_TAGS).map((t) => t.toUpperCase()),
  );
  const maxArea = options.maxArea ?? 1.5;
  const maxHeight = options.maxHeight ?? 4;
  const root = options.root;

  const mediaTag = (el: Element) => mediaTags.has(el.tagName.toUpperCase());
  const whole = (el: Element) =>
    el.tagName === "IMG" || isSVG(el) || mediaTag(el);

  function hasMeaningfulText(element: Element): boolean {
    const found = findContent(
      element,
      (node) => {
        if (node instanceof Element) {
          return prunes(node) ? "skip" : false;
        }
        if (
          node.nodeType !== Node.TEXT_NODE ||
          !MEANINGFUL.test((node as Text).data)
        ) {
          return false;
        }
        const parent = node.parentElement;
        if (!parent) {
          return true;
        }
        // Hidden text, or screen-reader-only text squeezed into a 1px box.
        const box = parent.getBoundingClientRect();
        return (
          !invisible(getComputedStyle(parent)) &&
          box.width > 1 &&
          box.height > 1
        );
      },
      PROBE_BUDGET,
    );
    // Too big to scan: a subtree that large almost surely holds text.
    return found !== false;
  }

  function hasMedia(element: Element): boolean {
    return (
      findContent(
        element,
        (node) => {
          if (!(node instanceof Element)) {
            return false;
          }
          if (prunes(node)) {
            return "skip";
          }
          if (!whole(node) && !backgroundImage(node)) {
            return false;
          }
          const box = node.getBoundingClientRect();
          return box.width > 1 && box.height > 1 ? true : "skip";
        },
        PROBE_BUDGET,
      ) === true
    );
  }

  function image(element: Element): boolean {
    if (element.tagName === "IMG" || isSVG(element)) {
      return true;
    }
    return !!backgroundImage(element) && !hasMeaningfulText(element);
  }

  function media(element: Element): boolean {
    if (image(element) || mediaTag(element)) {
      return true;
    }
    return !hasMeaningfulText(element) && hasMedia(element);
  }

  function isPage(element: Element): boolean {
    const doc = element.ownerDocument;
    return element === doc.body || element === doc.documentElement;
  }

  function meaningful(element: Element): boolean {
    if (!(element instanceof Element) || isPage(element)) {
      return false;
    }
    if (root && !within(root, element)) {
      return false;
    }
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      return false;
    }
    // A wrapper covering more than 1.5 viewports, or 4 screens tall, lights
    // up most of the page: no help in picking something. A long article
    // column still passes.
    if (
      box.width * box.height > maxArea * innerWidth * innerHeight ||
      box.height > maxHeight * innerHeight
    ) {
      return false;
    }
    if (!isVisible(element)) {
      return false;
    }
    if (whole(element)) {
      return true;
    }
    return (
      hasMeaningfulText(element) ||
      !!backgroundImage(element) ||
      hasMedia(element)
    );
  }

  // A word inside a paragraph (an inline <span>, <a>, <em>...) targets its
  // paragraph: the block is what's worth capturing.
  function block(node: Element): Element {
    let current = node;
    for (let i = 0; i < 12; i++) {
      if (image(current) || mediaTag(current)) {
        break;
      }
      const display = getComputedStyle(current).display;
      if (display !== "inline" && display !== "contents") {
        break;
      }
      const parent = parentOf(current);
      if (
        !parent ||
        isPage(parent) ||
        (root && !within(root, parent)) ||
        !meaningful(parent)
      ) {
        break;
      }
      current = parent;
    }
    return current;
  }

  return { meaningful, image, media, whole, mediaTag, block };
}
