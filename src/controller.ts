/*
 * The mode: on with activate(), off with deactivate(), and in between the
 * spotlight follows the pointer from target to target. A click presses it
 * down and shoots, a drag draws an area. While a shot is pending, the
 * spotlight holds on its target and the page's clicks are swallowed.
 *
 * Nothing here knows about keys (other than Escape, which can be turned
 * off), formats, or where a capture goes: targeters say what's under the
 * pointer, handlers say what a shot does.
 */

import { createAnnouncer } from "./announcer.js";
import { boundsFor, forgetLineRects, lineRects } from "./bounds.js";
import { closestAcross, elementsAtPoint, FRAMES } from "./dom.js";
import { createEmitter } from "./emitter.js";
import { areaRect, lean, near, spanning } from "./geometry.js";
import { createHeuristics } from "./heuristics.js";
import {
  type FlashStyle,
  type OverlayStyle,
  type Renderer,
  type ShakeStyle,
  spotlight,
  type View,
} from "./spotlight.js";
import {
  defaultTargets,
  kindOf,
  SELECTION,
  selectionRange,
  selectionTarget,
} from "./targets.js";
import type {
  AreaRect,
  Flags,
  Point,
  Rect,
  ResolveContext,
  State,
  Target,
  Targeter,
} from "./types.js";

export type ShootContext<R = unknown> = {
  /** Fires on `cancel()`, Escape, or `destroy()`. */
  signal: AbortSignal;
  flags: Readonly<Flags>;
  point: Point;
  /** The spotlight's rect (or the area's), in viewport and page px. */
  rect: AreaRect;
  /**
   * Hide the overlay so it isn't in a screenshot. Resolves once it's off the
   * screen, with a function to call once the pixels are taken. Call it
   * before any await of your own, so the flash waits for the pixels too.
   */
  hideOverlay(): Promise<() => void>;
  /** Hand this shot to the area handler instead (canvas and iframes, as screenshots). */
  captureArea(rect?: Rect): Promise<R>;
};

/** Resolve to succeed (the value is passed on to `shot`), throw or reject to fail. */
export type ShootHandler<D, R> = (
  target: Target<D>,
  ctx: ShootContext<R>,
) => R | Promise<R>;

export type AreaOptions<R> = {
  onCapture: (rect: AreaRect, ctx: ShootContext<R>) => R | Promise<R>;
  /** Pixels the pointer must travel before a press becomes a drag: 4 by default. */
  threshold?: number;
  /** Smaller than this on either side is a miss: 8 by default. */
  minSize?: number;
};

export type ShotSuccess<D, R> = {
  ok: true;
  value: R;
  target: Target<D> | null;
  rect: AreaRect;
};

export type ShotFailure<D> = {
  ok: false;
  error?: unknown;
  cancelled: boolean;
  target: Target<D> | null;
  rect: AreaRect;
};

export type ShotResult<D, R> = ShotSuccess<D, R> | ShotFailure<D>;

type Message<A> = string | ((arg: A) => string | null | undefined) | false;

export type Announcements<D, R> = {
  /** Default: "Point and shoot. Click to capture, Escape to cancel." (to suit the options). */
  activate?: string | false;
  /** While hovering. false by default: too chatty. */
  target?: ((target: Target<D>) => string | null | undefined) | false;
  /** Default: "Captured". */
  success?: Message<ShotSuccess<D, R>>;
  /** Default: "Couldn't capture that". */
  failure?: Message<ShotFailure<D>>;
  /** Default: "Nothing to capture here". */
  miss?: string | false;
  /** A pending shot cancelled. Default: "Cancelled". */
  cancel?: string | false;
};

export type FeedbackOptions<D, R> = {
  /** A flash of light in the highlight (or the selection's lines). */
  flash?:
    | false
    | (FlashStyle & {
        /**
         * "shoot" (default): as the click lands, before the handler settles.
         * When the handler hides the overlay for a screenshot, once it's back.
         * "success": once the handler resolves. "manual": only on `flash()`.
         */
        on?: "shoot" | "success" | "manual";
      });
  /** The highlight shaking side to side. */
  shake?:
    | false
    | (ShakeStyle & {
        /** "both" (default): on a miss and on a failed shot (not a cancelled one). */
        on?: "both" | "miss" | "failure" | "manual";
      });
  /** Messages read by screen readers, from a polite live region. false for none. */
  announce?: false | Announcements<D, R>;
};

export type PointAndShootOptions<D = unknown, R = unknown> = {
  /** Tried in order, first non-null wins. Default: `[selection(), elements()]`. */
  targets?: readonly Targeter<D>[];
  /** What a click on a target does. Without it, a shot succeeds with no value. */
  onShoot?: ShootHandler<D, R>;
  /** Drag to capture a rect. Off unless given: without it a drag is a missed click. */
  area?: AreaOptions<R>;
  /** Where to look: elements outside it are never targeted. `document` by default. */
  root?: Element | Document;
  /**
   * Never targeted, nor anything inside, and their clicks go through to the
   * page while the mode is on: your own toolbar keeps working.
   */
  ignore?: string;
  /** After a successful shot: leave the mode ("deactivate", the default) or stay for another ("stay"). */
  after?: "deactivate" | "stay";
  /**
   * A text selection: "target" it like an element when pointed at (the
   * default), target it "anywhere" the pointer is (a click anywhere shoots
   * it), "shoot" it as soon as the mode turns on, or "ignore" it.
   */
  selection?: "target" | "anywhere" | "shoot" | "ignore";
  /** Leave the mode, and cancel a pending shot, on Escape. true by default. */
  escape?: boolean;
  /** Leave the mode when the window blurs or the tab hides. true by default. */
  exitOnBlur?: boolean;
  /**
   * Called on every pointer event while active, before the library acts on
   * it. Return false to let the event through to the page and leave the mode.
   */
  guard?: (event: PointerEvent) => boolean;
  /** Px of slack around the target before the pointer counts as gone. 20 by default. */
  grace?: number;
  /** Ms the pointer must rest on the target's container before the spotlight grows onto it. 180 by default. */
  dwell?: number;
  /** The flash, the shake and screen-reader announcements. */
  feedback?: FeedbackOptions<D, R>;
  /** The overlay's look, a renderer of your own, or null for none at all. */
  overlay?: OverlayStyle | Renderer | null;
  /** Force a cursor on the page while active: "pointer" by default, false to leave it alone. */
  cursor?: string | false;
  /**
   * Hide the browser's own selection highlight while the overlay lights a
   * selection, and bring it back after. true by default; never without an overlay.
   */
  hideSelection?: boolean;
};

export type Events<D, R> = {
  activate: () => void;
  deactivate: () => void;
  target: (target: Target<D> | null, previous: Target<D> | null) => void;
  press: (target: Target<D> | null) => void;
  /** A click landed on a target (or `shoot()` was called), before the handler runs. */
  shoot: (target: Target<D>, rect: AreaRect) => void;
  areastart: (rect: AreaRect) => void;
  areamove: (rect: AreaRect) => void;
  /** Before the handler runs. */
  areaend: (rect: AreaRect) => void;
  /** The handler settled, or the shot was cancelled. */
  shot: (result: ShotResult<D, R>) => void;
  /** A click on nothing, or too small an area. */
  miss: (point: Point) => void;
};

export type PointAndShoot<D = unknown, R = unknown> = {
  readonly state: State;
  /** What the spotlight is on, or null for the dot. */
  readonly target: Target<D> | null;
  readonly flags: Readonly<Flags>;
  /** Turn the mode on. `at`: the pointer, for when the page hasn't seen it move yet. */
  activate(options?: { at?: Point }): void;
  /** Turn it off. A pending shot keeps going unless `cancel()` is called too. */
  deactivate(): void;
  toggle(options?: { at?: Point }): void;
  /** Shoot without a click: the current target, an element, a range, or a target of your own. */
  shoot(target?: Target<D> | Element | Range): Promise<ShotResult<D, R>>;
  /** Run the area handler on a rect (viewport px), as if it had been dragged. */
  captureArea(rect: Rect): Promise<ShotResult<D, R>>;
  /** Abort a pending shot (its `signal` fires) and leave the mode. */
  cancel(): void;
  /** Switches the targeters and handlers read. Re-resolves the target. */
  setFlags(flags: Partial<Flags>): void;
  /** Re-resolve and re-measure the target, after the page changed under a still pointer. */
  refresh(): void;
  /** Change any option in place. */
  configure(options: Partial<PointAndShootOptions<D, R>>): void;
  /** Feedback by hand. Each respects its options and reduced motion. */
  flash(): void;
  shake(): void;
  announce(message: string): void;
  on<E extends keyof Events<D, R>>(
    type: E,
    listener: Events<D, R>[E],
  ): () => void;
  /** Remove every listener and the overlay, for good. */
  destroy(): void;
};

/** The one controller active on a document, across copies of the library. */
const ACTIVE = Symbol.for("@daformat/point-and-shoot.active");
type Claimable = Document & { [ACTIVE]?: { deactivate(): void } };

/** The browser's selection highlight, made invisible (the selection stays). */
const HIDE_SELECTION =
  "*::selection { background: transparent !important; text-shadow: none !important; }";

/** Time for the overlay to fade before it's taken out. */
const FADE = 260;
/** A click this soon after a shot is the shot's own. */
const CLICK_WINDOW = 600;

const MOUSE_EVENTS = [
  "mousedown",
  "mouseup",
  "click",
  "auxclick",
  "dblclick",
  "contextmenu",
] as const;

type Pending = { abort: AbortController; hiding: boolean };

function isRenderer(value: unknown): value is Renderer {
  return (
    !!value &&
    typeof (value as Renderer).render === "function" &&
    typeof (value as Renderer).mount === "function"
  );
}

function sameNode(a: Element | Range, b: Element | Range): boolean {
  if (a === b) {
    return true;
  }
  if (a instanceof Range && b instanceof Range) {
    return (
      a.startContainer === b.startContainer &&
      a.startOffset === b.startOffset &&
      a.endContainer === b.endContainer &&
      a.endOffset === b.endOffset
    );
  }
  return false;
}

function same<D>(a: Target<D> | null, b: Target<D> | null): boolean {
  return !!a && !!b && a.kind === b.kind && sameNode(a.node, b.node);
}

function stop(e: Event) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function createPointAndShoot<D = unknown, R = unknown>(
  options: PointAndShootOptions<D, R> = {},
): PointAndShoot<D, R> {
  let opts = { ...options };
  let renderer: Renderer | null = null;
  let is = createHeuristics({ root: opts.root });

  const pointer: Point = { x: -1, y: -1 };
  let pointerKnown = false;
  let flags: Flags = {};
  let active = false;
  let pending: Pending | null = null;
  let pressed = false;
  let dragging = false;
  let moved = false;
  let tapPreview = false;
  let pressPoint: Point | null = null;
  let target: Target<D> | null = null;
  let rect: Rect | null = null;
  let mounted = false;
  let destroyed = false;
  let hideTimer = 0;
  let flashEnd = 0;
  let swallowClick = 0;
  let containerCandidate: Element | null = null;
  let containerSince = 0;
  let containerTimer = 0;
  let cursorStyle: HTMLStyleElement | null = null;
  let listeners: AbortController | null = null;

  const emitter = createEmitter<Events<D, R>>();
  const announcer = createAnnouncer();

  function setRenderer() {
    const overlay = opts.overlay;
    if (renderer && mounted) {
      renderer.unmount();
      mounted = false;
    }
    renderer =
      overlay === null
        ? null
        : isRenderer(overlay)
          ? overlay
          : spotlight(overlay ?? {});
  }
  setRenderer();

  const root = () => opts.root ?? document;
  const doc = () => {
    const r = root();
    return r.nodeType === Node.DOCUMENT_NODE
      ? (r as Document)
      : r.ownerDocument!;
  };
  const state = (): State =>
    pending
      ? "pending"
      : dragging
        ? "dragging"
        : pressed
          ? "pressed"
          : active
            ? "active"
            : "idle";

  // ------------------------------------------------------------- feedback

  const flashOptions = () =>
    opts.feedback?.flash === false ? null : (opts.feedback?.flash ?? {});
  const shakeOptions = () =>
    opts.feedback?.shake === false ? null : (opts.feedback?.shake ?? {});

  function flash() {
    const f = flashOptions();
    if (f && mounted && renderer) {
      renderer.flash({
        color: f.color,
        intensity: f.intensity,
        duration: f.duration,
      });
      flashEnd = performance.now() + (f.duration ?? 420);
    }
  }

  function shake() {
    const s = shakeOptions();
    if (s && mounted) {
      renderer?.shake({ distance: s.distance, duration: s.duration });
    }
  }

  function flashOn(moment: "shoot" | "success") {
    const f = flashOptions();
    if (f && (f.on ?? "shoot") === moment) {
      flash();
    }
  }

  function shakeOn(moment: "miss" | "failure") {
    const s = shakeOptions();
    const on = s?.on ?? "both";
    if (s && (on === "both" || on === moment)) {
      shake();
    }
  }

  function defaultActivate() {
    const how = opts.area ? "Click or drag to capture" : "Click to capture";
    return `Point and shoot. ${how}${opts.escape === false ? "" : ", Escape to cancel"}.`;
  }

  function say<K extends keyof Announcements<D, R>>(
    key: K,
    fallback: string | null,
    arg?: unknown,
  ) {
    const messages = opts.feedback?.announce;
    if (messages === false) {
      return;
    }
    const value = messages?.[key];
    if (value === false) {
      return;
    }
    const text: string | null | undefined =
      value === undefined
        ? fallback
        : typeof value === "function"
          ? (value as (a: unknown) => string | null | undefined)(arg)
          : (value as string);
    if (text) {
      announcer.say(text);
    }
  }

  // ------------------------------------------------------------- drawing

  function view(instant: boolean): View {
    const range = target?.node instanceof Range ? target.node : null;
    const s = state();
    return {
      state: s,
      rect,
      lines: range ? lineRects(range) : null,
      pointer: { ...pointer },
      lean:
        rect && !range && (s === "active" || s === "pressed")
          ? lean(rect, pointer)
          : { x: 0, y: 0 },
      instant,
    };
  }

  function render(instant = false) {
    if (renderer && mounted) {
      const v = view(instant);
      renderer.render(v);
      syncSelectionHighlight(
        v.lines && v.state !== "idle" ? (target!.node as Range) : null,
      );
    } else {
      syncSelectionHighlight(null);
    }
  }

  // The browser's own selection highlight, hidden while the overlay lights
  // the selection: in the document, and in the shadow root it's in.
  let hiddenSelection: {
    style: HTMLStyleElement;
    root: ShadowRoot | null;
    sheet: CSSStyleSheet | null;
  } | null = null;

  function syncSelectionHighlight(range: Range | null) {
    const hide = !!range && opts.hideSelection !== false;
    const root = range?.startContainer.getRootNode() ?? null;
    const shadow = root instanceof ShadowRoot ? root : null;
    if (hide && hiddenSelection && hiddenSelection.root === shadow) {
      return;
    }
    if (hiddenSelection) {
      hiddenSelection.style.remove();
      const { root: r, sheet } = hiddenSelection;
      if (r && sheet) {
        r.adoptedStyleSheets = r.adoptedStyleSheets.filter((s) => s !== sheet);
      }
      hiddenSelection = null;
    }
    if (!hide) {
      return;
    }
    const d = doc();
    const style = d.createElement("style");
    style.setAttribute("data-point-and-shoot", "selection");
    style.textContent = HIDE_SELECTION;
    (d.head || d.documentElement).appendChild(style);
    let sheet: CSSStyleSheet | null = null;
    if (
      shadow &&
      typeof CSSStyleSheet === "function" &&
      "adoptedStyleSheets" in shadow
    ) {
      try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(HIDE_SELECTION);
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      } catch {
        sheet = null;
      }
    }
    hiddenSelection = { style, root: shadow, sheet };
  }

  function mount() {
    clearTimeout(hideTimer);
    if (renderer && !mounted) {
      renderer.mount();
      mounted = true;
    } else if (renderer) {
      // The page may have replaced the overlay's parent (SPAs do).
      renderer.mount();
    }
  }

  /** Fade out, then take the overlay out, unless the mode came back meanwhile. */
  function hide() {
    clearTimeout(hideTimer);
    const fade = () => {
      render();
      target = null;
      rect = null;
      hideTimer = window.setTimeout(() => {
        if (state() === "idle" && renderer && mounted) {
          renderer.unmount();
          mounted = false;
        }
      }, FADE);
    };
    // A flash plays out before the overlay fades.
    const wait = flashEnd - performance.now();
    if (wait > 0 && mounted) {
      hideTimer = window.setTimeout(fade, wait);
    } else {
      fade();
    }
  }

  function setCursor(on: boolean) {
    cursorStyle?.remove();
    cursorStyle = null;
    if (!on) {
      return;
    }
    const rules: string[] = [];
    if (opts.cursor !== false) {
      rules.push(`cursor: ${opts.cursor ?? "pointer"} !important;`);
    }
    // Drawing an area with a finger: the page mustn't scroll instead.
    if (opts.area) {
      rules.push("touch-action: none !important;");
    }
    // A frame keeps the pointer's events to its own document: let them
    // through to the page, which finds frames by their box instead.
    let css = `${FRAMES} { pointer-events: none !important; }`;
    if (rules.length) {
      css += ` * { ${rules.join(" ")} }`;
    }
    const d = doc();
    cursorStyle = d.createElement("style");
    cursorStyle.setAttribute("data-point-and-shoot", "cursor");
    cursorStyle.textContent = css;
    (d.head || d.documentElement).appendChild(cursorStyle);
  }

  // ------------------------------------------------------------- targeting

  function resolve(): Target<D> | null {
    const ignore = opts.ignore;
    const ctx: ResolveContext<D> = {
      point: { ...pointer },
      stack: elementsAtPoint(pointer, root()).filter(
        (el) => !ignore || !closestAcross(el, ignore),
      ),
      flags,
      current: target,
      root: root(),
      is,
    };
    for (const targeter of opts.targets ??
      (defaultTargets as readonly Targeter<D>[])) {
      if (!targeter.resolve) {
        continue;
      }
      if (SELECTION in targeter && opts.selection === "ignore") {
        continue;
      }
      if (SELECTION in targeter && opts.selection === "anywhere") {
        const range = selectionRange(doc());
        if (range) {
          return selectionTarget(range) as Target<D>;
        }
        continue;
      }
      const found = targeter.resolve(ctx);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function isContainerOfTarget(next: Target<D>): boolean {
    const current = target?.node;
    return (
      current instanceof Element &&
      next.node instanceof Element &&
      next.node !== current &&
      next.node.contains(current)
    );
  }

  function retarget(next: Target<D> | null, r: Rect | null) {
    const previous = target;
    target = next;
    rect = r;
    if (!same(previous, next)) {
      emitter.emit("target", next, previous);
      if (next) {
        say("target", null, next);
      }
    }
  }

  /** Follow the pointer: the target under it, or the dot. */
  function update(instant = false, remeasure = false) {
    if (!active || pending || dragging || destroyed) {
      return;
    }
    if (remeasure && target) {
      const r = boundsFor(target, is.whole);
      if (r) {
        rect = r;
      } else {
        retarget(null, null);
      }
    }
    if (!pointerKnown) {
      render(instant);
      return;
    }
    let next = resolve();
    // Crossing the gaps between small siblings (a row of icons) lands on
    // their container for a moment: keep the current target unless the
    // pointer rests there, so the wash doesn't balloon between each one.
    const dwell = opts.dwell ?? 180;
    if (next && isContainerOfTarget(next)) {
      const node = next.node as Element;
      if (containerCandidate !== node) {
        containerCandidate = node;
        containerSince = performance.now();
        clearTimeout(containerTimer);
        containerTimer = window.setTimeout(() => update(), dwell);
      }
      if (performance.now() - containerSince < dwell) {
        next = target;
      }
    } else {
      containerCandidate = null;
      clearTimeout(containerTimer);
    }
    if (next && !same(next, target)) {
      const r = boundsFor(next, is.whole);
      if (r && r.width > 0 && r.height > 0) {
        retarget(next, r);
      }
    } else if (!next && !near(rect, pointer, opts.grace ?? 20)) {
      // Leaving an element: the wash shrinks back into the dot.
      retarget(null, null);
    }
    render(instant);
  }

  // ------------------------------------------------------------- shooting

  function miss(point: Point) {
    emitter.emit("miss", point);
    shakeOn("miss");
    say("miss", "Nothing to capture here");
  }

  async function run(
    shotTarget: Target<D> | null,
    shotRect: Rect,
    exec: (ctx: ShootContext<R>) => R | Promise<R>,
  ): Promise<ShotResult<D, R>> {
    listen();
    mount();
    const p: Pending = { abort: new AbortController(), hiding: false };
    pending = p;
    pressed = false;
    dragging = false;
    const area = areaRect(shotRect);
    render();

    const ctx: ShootContext<R> = {
      signal: p.abort.signal,
      flags: { ...flags },
      point: { ...pointer },
      rect: area,
      hideOverlay: async () => {
        p.hiding = true;
        renderer?.setHidden(true);
        // One frame to apply, one to be sure it's painted without it.
        await frame();
        await frame();
        return () => {
          renderer?.setHidden(false);
          if (pending === p) {
            flashOn("shoot");
          }
        };
      },
      captureArea: (r) => {
        const handler = opts.area?.onCapture;
        if (!handler) {
          return Promise.reject(
            new Error("point-and-shoot: captureArea() needs the area option."),
          );
        }
        return Promise.resolve().then(() =>
          handler(r ? areaRect(r) : area, ctx),
        );
      },
    };

    if (shotTarget) {
      emitter.emit("shoot", shotTarget, area);
    } else {
      emitter.emit("areaend", area);
    }

    let result: Promise<R>;
    try {
      result = Promise.resolve(exec(ctx));
    } catch (error) {
      result = Promise.reject(error);
    }
    if (!p.hiding) {
      flashOn("shoot");
    }
    const aborted = new Promise<never>((_, reject) => {
      p.abort.signal.addEventListener("abort", () =>
        reject(p.abort.signal.reason),
      );
    });

    let outcome: ShotResult<D, R>;
    try {
      const value = await Promise.race([result, aborted]);
      outcome = { ok: true, value, target: shotTarget, rect: area };
    } catch (error) {
      outcome = {
        ok: false,
        error,
        cancelled: p.abort.signal.aborted,
        target: shotTarget,
        rect: area,
      };
    }
    if (pending === p && !destroyed) {
      settle(outcome);
    }
    return outcome;
  }

  function settle(outcome: ShotResult<D, R>) {
    pending = null;
    renderer?.setHidden(false);
    if (outcome.ok) {
      flashOn("success");
      say("success", "Captured", outcome);
    } else if (outcome.cancelled) {
      say("cancel", "Cancelled");
    } else {
      shakeOn("failure");
      say("failure", "Couldn't capture that", outcome);
    }
    emitter.emit("shot", outcome);
    if (pending) {
      // A listener started another shot.
      return;
    }
    const stay = active && (!outcome.ok || opts.after === "stay");
    if (stay) {
      update(false, true);
    } else if (active) {
      deactivate();
    } else {
      hide();
    }
  }

  function busy(): ShotFailure<D> {
    return {
      ok: false,
      error: new Error("point-and-shoot: a shot is already pending."),
      cancelled: false,
      target: null,
      rect: areaRect(rect ?? { x: 0, y: 0, width: 0, height: 0 }),
    };
  }

  function toTarget(input: Target<D> | Element | Range): Target<D> {
    if (input instanceof Range) {
      return selectionTarget(input);
    }
    if (input instanceof Element) {
      return { kind: kindOf(input, is), node: input, whole: is.whole(input) };
    }
    return input;
  }

  function shootTarget(t: Target<D>): Promise<ShotResult<D, R>> {
    const onShoot = opts.onShoot;
    return run(
      t,
      rect ?? { x: pointer.x, y: pointer.y, width: 0, height: 0 },
      (ctx) => (onShoot ? onShoot(t, ctx) : (undefined as R)),
    );
  }

  function shootArea(r: Rect): Promise<ShotResult<D, R>> {
    const onCapture = opts.area!.onCapture;
    retarget(null, r);
    return run(null, r, (ctx) => onCapture(ctx.rect, ctx));
  }

  // ------------------------------------------------------------- events

  function onPointerTrack(e: PointerEvent) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointerKnown = true;
  }

  /** The event is on an element the options leave out. */
  function ignored(e: Event): boolean {
    const ignore = opts.ignore;
    const origin = e.composedPath()[0];
    return (
      !!ignore && origin instanceof Element && !!closestAcross(origin, ignore)
    );
  }

  function guardFails(e: PointerEvent) {
    return active && !pending && !!opts.guard && !opts.guard(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (!active || pending) {
      return;
    }
    if (!pressed && guardFails(e)) {
      deactivate();
      return;
    }
    if (pressed && pressPoint) {
      const far =
        Math.hypot(pointer.x - pressPoint.x, pointer.y - pressPoint.y) >
        (opts.area?.threshold ?? 4);
      if (far && !moved) {
        moved = true;
      }
      if (moved && opts.area) {
        // Dragging draws a free-form area.
        const starting = !dragging;
        dragging = true;
        rect = spanning(pressPoint, pointer);
        if (target) {
          const previous = target;
          target = null;
          emitter.emit("target", null, previous);
        }
        render();
        emitter.emit(starting ? "areastart" : "areamove", areaRect(rect));
        return;
      }
      if (moved) {
        // A drag with nothing to draw: it's going to be a miss.
        return;
      }
    }
    update();
  }

  function onPointerDown(e: PointerEvent) {
    if ((active || pending) && ignored(e)) {
      return;
    }
    if (pending) {
      stop(e);
      return;
    }
    if (!active) {
      return;
    }
    if (guardFails(e)) {
      // The mode's over: let the click through.
      deactivate();
      return;
    }
    if (e.button !== 0) {
      return;
    }
    stop(e);
    pressed = true;
    moved = false;
    pressPoint = { x: e.clientX, y: e.clientY };
    try {
      doc().documentElement.setPointerCapture(e.pointerId);
    } catch {
      // Not every pointer can be captured.
    }
    // The pointer may land without moving there first (a tap, a tool):
    // what's under it now is what's pressed. No hover on a touch screen, so
    // there a first tap on something new only targets it, a second shoots.
    const before = target;
    update();
    tapPreview = e.pointerType !== "mouse" && !same(before, target);
    render();
    emitter.emit("press", target);
  }

  function onPointerUp(e: PointerEvent) {
    if (!pressed) {
      return;
    }
    stop(e);
    pressed = false;
    swallowClick = performance.now();
    const point = { x: e.clientX, y: e.clientY };
    if (dragging) {
      dragging = false;
      const minSize = opts.area?.minSize ?? 8;
      if (
        opts.area &&
        rect &&
        rect.width >= minSize &&
        rect.height >= minSize
      ) {
        void shootArea(rect);
      } else {
        rect = null;
        render();
        miss(point);
        update();
      }
      return;
    }
    if (moved) {
      moved = false;
      render();
      miss(point);
      return;
    }
    if (tapPreview) {
      tapPreview = false;
      render();
      if (!target) {
        miss(point);
      }
      return;
    }
    // A selection is only ever targeted from where the pointer is (or from
    // anywhere): its lines can be far from the pointer and still be it.
    const selected = target?.node instanceof Range;
    if (!target || (!selected && !near(rect, pointer, opts.grace ?? 20))) {
      render();
      miss(point);
      return;
    }
    void shootTarget(target);
  }

  function onPointerCancel() {
    if (!pressed) {
      return;
    }
    pressed = false;
    dragging = false;
    moved = false;
    tapPreview = false;
    render();
    update();
  }

  function onMouse(e: MouseEvent) {
    // Swallow only the click that immediately follows a shot.
    if (swallowClick && (e.type === "click" || e.type === "dblclick")) {
      const recent = performance.now() - swallowClick < CLICK_WINDOW;
      swallowClick = 0;
      if (recent) {
        stop(e);
        return;
      }
    }
    if ((active || pending) && !ignored(e)) {
      stop(e);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && opts.escape !== false && (active || pending)) {
      stop(e);
      cancel();
    }
  }

  function onBlur() {
    if (opts.exitOnBlur !== false && active && !pending) {
      deactivate();
    }
  }

  function onVisibility() {
    if (doc().hidden) {
      onBlur();
    }
  }

  function onScroll(e: Event) {
    // An element scrolled: a selection's cached lines inside it moved.
    if (e.target !== doc() && e.target !== doc().defaultView) {
      forgetLineRects();
    }
    if (!mounted) {
      return;
    }
    if (pending && target) {
      // Follow the target being shot.
      rect = boundsFor(target, is.whole) ?? rect;
      render(true);
    } else if (active && !pressed) {
      update(true, true);
    }
  }

  function onResize() {
    if (target && mounted) {
      rect = boundsFor(target, is.whole) ?? rect;
      render(true);
    }
  }

  function listen() {
    if (listeners || destroyed) {
      return;
    }
    listeners = new AbortController();
    const signal = listeners.signal;
    const capture = { capture: true, signal };
    const view = doc().defaultView ?? window;
    view.addEventListener("pointermove", onPointerMove, capture);
    view.addEventListener("pointerdown", onPointerDown, capture);
    view.addEventListener("pointerup", onPointerUp, capture);
    view.addEventListener("pointercancel", onPointerCancel, capture);
    for (const type of MOUSE_EVENTS) {
      view.addEventListener(type, onMouse, capture);
    }
    view.addEventListener("keydown", onKeyDown, capture);
    view.addEventListener("scroll", onScroll, capture);
    view.addEventListener("resize", onResize, { signal });
    view.addEventListener("blur", onBlur, { signal });
    doc().addEventListener("visibilitychange", onVisibility, { signal });
  }

  // Only the pointer's whereabouts are followed before the first activate().
  const tracker = new AbortController();
  if (typeof window !== "undefined") {
    window.addEventListener("pointermove", onPointerTrack, {
      capture: true,
      passive: true,
      signal: tracker.signal,
    });
    window.addEventListener("pointerdown", onPointerTrack, {
      capture: true,
      passive: true,
      signal: tracker.signal,
    });
  }

  // ------------------------------------------------------------- the mode

  function activate(o: { at?: Point } = {}) {
    if (destroyed) {
      return;
    }
    if (o.at) {
      pointer.x = o.at.x;
      pointer.y = o.at.y;
      pointerKnown = true;
    }
    if (active || pending) {
      return;
    }
    const d = doc() as Claimable;
    const other = d[ACTIVE];
    if (other && other !== api) {
      other.deactivate();
    }
    d[ACTIVE] = api;
    active = true;
    listen();
    mount();
    setCursor(true);
    emitter.emit("activate");
    say("activate", defaultActivate());

    if (opts.selection === "shoot") {
      const range = selectionRange(doc());
      if (range) {
        const t = selectionTarget(range) as Target<D>;
        rect = boundsFor(t, is.whole);
        target = t;
        render(true);
        void shootTarget(t);
        return;
      }
    }
    target = null;
    rect = null;
    render(true);
    // A frame as the dot, so it morphs onto the first target.
    requestAnimationFrame(() => update());
  }

  function deactivate() {
    if (!active) {
      return;
    }
    active = false;
    pressed = false;
    dragging = false;
    moved = false;
    tapPreview = false;
    containerCandidate = null;
    clearTimeout(containerTimer);
    setCursor(false);
    const d = doc() as Claimable;
    if (d[ACTIVE] === api) {
      delete d[ACTIVE];
    }
    emitter.emit("deactivate");
    if (!pending) {
      hide();
    }
  }

  function cancel() {
    if (pending) {
      pending.abort.abort(
        typeof DOMException === "function"
          ? new DOMException("Cancelled", "AbortError")
          : new Error("Cancelled"),
      );
    }
    deactivate();
  }

  const api: PointAndShoot<D, R> = {
    get state() {
      return state();
    },
    get target() {
      return target;
    },
    get flags() {
      return flags;
    },
    activate,
    deactivate,
    toggle(o) {
      if (active) {
        deactivate();
      } else {
        activate(o);
      }
    },
    shoot(input) {
      if (destroyed || pending) {
        return Promise.resolve(busy());
      }
      const t = input === undefined ? target : toTarget(input);
      if (!t) {
        return Promise.resolve({
          ...busy(),
          error: new Error("point-and-shoot: nothing to shoot."),
        });
      }
      target = t;
      rect = boundsFor(t, is.whole);
      return shootTarget(t);
    },
    captureArea(r) {
      if (destroyed || pending) {
        return Promise.resolve(busy());
      }
      if (!opts.area) {
        return Promise.resolve({
          ...busy(),
          error: new Error(
            "point-and-shoot: captureArea() needs the area option.",
          ),
        });
      }
      listen();
      mount();
      return shootArea(r);
    },
    cancel,
    setFlags(next) {
      flags = { ...flags, ...next } as Flags;
      update(false, true);
    },
    refresh() {
      update(false, true);
    },
    configure(next) {
      const overlayChanged = "overlay" in next && next.overlay !== opts.overlay;
      opts = { ...opts, ...next };
      if ("root" in next) {
        is = createHeuristics({ root: opts.root });
      }
      if (overlayChanged) {
        setRenderer();
        if (state() !== "idle") {
          mount();
          render(true);
        }
      }
      if (active) {
        setCursor(true);
        update(false, true);
      }
    },
    flash,
    shake,
    announce(message) {
      if (opts.feedback?.announce !== false) {
        announcer.say(message);
      }
    },
    on(type, listener) {
      return emitter.on(type, listener);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      cancel();
      destroyed = true;
      pending = null;
      listeners?.abort();
      tracker.abort();
      clearTimeout(hideTimer);
      clearTimeout(containerTimer);
      if (renderer && mounted) {
        renderer.unmount();
      }
      mounted = false;
      syncSelectionHighlight(null);
      announcer.destroy();
      emitter.clear();
    },
  };

  return api;
}
