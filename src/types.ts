/** A point in the viewport, in CSS px. */
export type Point = { x: number; y: number };

/** A box in the viewport (or the page, where noted), in CSS px. */
export type Rect = { x: number; y: number; width: number; height: number };

/** A rect three ways: in the viewport, in the page, and the viewport's size at the time. */
export type AreaRect = {
  viewport: Rect;
  page: Rect;
  viewportSize: { width: number; height: number };
};

/** idle → active → pressed → (dragging) → pending → idle */
export type State = "idle" | "active" | "pressed" | "dragging" | "pending";

/** Free-form switches the targeters and handlers read, like Glea's ⌘ "text only". */
export type Flags = Record<string, boolean | string | number>;

/** What the spotlight is on. */
export type Target<D = unknown> = {
  /** "element" | "image" | "media" | "selection", or your own: "embed", "card"... */
  kind: string;
  node: Element | Range;
  /** Light the element's own box instead of the extent of its content (media and embeds do). */
  whole?: boolean;
  /** Bounds of your own, in viewport px, re-read on scroll and resize. */
  bounds?: () => Rect | null;
  /** Whatever the shot handler needs. */
  data?: D;
};

/** The heuristics the default targeter is made of, to build on. */
export type Heuristics = {
  /** Visible, not a page-sized wrapper, and with text, an image or media of its own. */
  meaningful(el: Element): boolean;
  /** An <img>, an <svg>, or a background image with no text over it. */
  image(el: Element): boolean;
  /** An image, a media element, or something holding media and no text. */
  media(el: Element): boolean;
};

export type ResolveContext<D = unknown> = {
  point: Point;
  /** Elements under the pointer, innermost first, open shadow roots included, the overlay and ignored ones left out. */
  stack: readonly Element[];
  flags: Readonly<Flags>;
  /** The target before this move, to keep it or not. */
  current: Target<D> | null;
  root: Element | Document;
  is: Heuristics;
};

export type CollectContext = {
  rect: Rect;
  /** "inside": wholly within the rect; "overlap": any part of it. */
  mode: "inside" | "overlap";
  root: Element | Document;
  flags: Readonly<Flags>;
  /** Selector of what's never collected, overlay included. */
  ignore: string;
};

export type Targeter<D = unknown> = {
  name: string;
  /** What's under the pointer. Leave it out for a targeter only used in areas. */
  resolve?(ctx: ResolveContext<D>): Target<D> | null | undefined;
  /** What's inside a rect, for `elementsInRect`. Leave it out for a targeter only used by pointing. */
  collect?(ctx: CollectContext): Target<D>[];
};
