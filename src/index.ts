export type { Announcer } from "./announcer.js";
export { createAnnouncer } from "./announcer.js";
export type { LineRectsOptions } from "./bounds.js";
export {
  ancestorClip,
  boundsFor,
  contentBounds,
  forgetLineRects,
  lineRects,
  visibleRect,
} from "./bounds.js";
export type { ElementsInRectOptions } from "./collect.js";
export { elementsInRect } from "./collect.js";
export type {
  Announcements,
  AreaOptions,
  Events,
  FeedbackOptions,
  PointAndShoot,
  PointAndShootOptions,
  ShootContext,
  ShootHandler,
  ShotFailure,
  ShotResult,
  ShotSuccess,
} from "./controller.js";
export { createPointAndShoot } from "./controller.js";
export { elementsAtPoint, HOST_TAG } from "./dom.js";
export {
  areaRect,
  contains,
  intersect,
  near,
  spanning,
  union,
} from "./geometry.js";
export type { FullHeuristics, HeuristicsOptions } from "./heuristics.js";
export { createHeuristics, MEDIA_TAGS } from "./heuristics.js";
export type { OutlineOptions } from "./outline.js";
export { outlinePath, roundedRectPath } from "./outline.js";
export type {
  FlashStyle,
  OverlayStyle,
  Renderer,
  ShakeStyle,
  View,
} from "./spotlight.js";
export { spotlight } from "./spotlight.js";
export type { ElementsOptions, MatchMap, SelectionOptions } from "./targets.js";
export {
  defaultTargets,
  elements,
  kindOf,
  match,
  selection,
  selectionRange,
} from "./targets.js";
export type {
  AreaRect,
  CollectContext,
  Flags,
  Heuristics,
  Point,
  Rect,
  ResolveContext,
  State,
  Target,
  Targeter,
} from "./types.js";
