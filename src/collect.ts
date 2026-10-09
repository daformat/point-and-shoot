import { HOST_TAG } from "./dom.js";
import { match } from "./targets.js";
import type { CollectContext, Flags, Rect, Target, Targeter } from "./types.js";

export type ElementsInRectOptions = {
  /** "inside" (the default): wholly within the rect; "overlap": any part of it. */
  mode?: "inside" | "overlap";
  /** Where to look. `document` by default. */
  root?: Element | Document;
  /** Never collected, nor anything inside. The overlay never is. */
  ignore?: string;
  flags?: Flags;
};

/**
 * What's in a rect (viewport px). A string is a plain selector, giving
 * `{ kind: "element", node }`; a targeter is any with `collect`, like
 * `match()`'s. Nothing is filtered or merged: each matcher's results come
 * back as it returned them, in matcher order.
 */
export function elementsInRect<D = unknown>(
  rect: Rect,
  matchers: readonly (string | Targeter<D>)[],
  options: ElementsInRectOptions = {},
): Target<D>[] {
  const ctx: CollectContext = {
    rect,
    mode: options.mode ?? "inside",
    root: options.root ?? document,
    flags: options.flags ?? {},
    ignore: options.ignore ? `${HOST_TAG}, ${options.ignore}` : HOST_TAG,
  };
  const found: Target<D>[] = [];
  for (const matcher of matchers) {
    const targeter = typeof matcher === "string" ? match<D>(matcher) : matcher;
    if (!targeter.collect) {
      throw new TypeError(
        `point-and-shoot: the "${targeter.name}" targeter can't collect: it has no collect().`,
      );
    }
    found.push(...targeter.collect(ctx));
  }
  return found;
}
