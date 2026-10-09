# point-and-shoot

Point at anything on a page and capture it. A spotlight morphs onto the block under the pointer, a click shoots it,
a drag draws an area. What a shot _does_ is yours: save it, send it, turn it into Markdown, collect the SVGs in an
area.

It is the point and shoot from Glea, lifted out of the app and its browser extensions as a
package: the targeting rules that tell a block worth capturing from an empty wrapper, the spotlight that follows
the pointer, and the press, drag and pending states around a shot. No hotkeys, no formats, no destinations: you turn
the mode on and off, say what can be pointed at, and what a shot does.

Zero dependencies, no framework, TypeScript.

## Installation

```bash
npm install @daformat/point-and-shoot
```

```bash
pnpm add @daformat/point-and-shoot
```

## Usage

```ts
import { createPointAndShoot } from "@daformat/point-and-shoot";

const pns = createPointAndShoot({
  // Resolve to succeed, throw to fail. The target's node is an Element or a Range.
  onShoot: (target) => save(target.node),
});

button.addEventListener("click", () => pns.activate());

// A confirmation is your UI: the library flashes and shakes, but shows no badge.
pns.on("shot", (result) => {
  if (result.ok) toast("Saved", result.rect.viewport);
});
```

While the mode is on, the page's clicks belong to it: a click shoots, Escape leaves. A successful shot leaves the
mode (`after: "stay"` keeps it). A failed one shakes and stays, for another try.

Importing touches nothing. Creating a controller only follows the pointer's whereabouts; nothing is added to the page
until the first `activate()`.

## Turning it on

There are no hotkeys in the library: the mode is on when you say so.

```ts
// A button of your own. `at` places the dot before the page has seen the pointer move.
toolbar.addEventListener("click", (e) =>
  pns.toggle({ at: { x: e.clientX, y: e.clientY } }),
);

// Held key, Glea style: on while ⌥ is held, off when released.
addEventListener(
  "keydown",
  (e) => e.key === "Alt" && !e.repeat && pns.activate(),
);
addEventListener("keyup", (e) => e.key === "Alt" && pns.deactivate());

// And the guard, in case the key's release is never seen (focus went elsewhere):
// returning false lets the event through to the page and leaves the mode.
createPointAndShoot({ guard: (e) => e.altKey });
```

Escape leaves the mode, and cancels a pending shot, unless `escape: false`. Blurring the window or hiding the tab
leaves it too, unless `exitOnBlur: false`. Only one controller is active per document: activating one deactivates
the other.

Elements matched by `ignore` are never targeted, and their clicks go through to the page while the mode is on, so
your own toolbar keeps working:

```ts
createPointAndShoot({ ignore: ".my-toolbar" });
```

## Targets

```ts
type Target<D> = {
  kind: string; // "element" | "image" | "media" | "selection", or your own
  node: Element | Range;
  whole?: boolean; // light the element's own box, not the extent of its content
  bounds?: () => Rect | null; // bounds of your own, re-read on scroll and resize
  data?: D; // whatever your handler needs
};
```

Targeters say what's under the pointer. They are tried in order, and the first one to answer wins. The default is
`[selection(), elements()]`:

- `selection(options?)`: the text selection, while the pointer is over it, or anywhere with `{ anywhere: true }`.
- `elements(options?)`: Glea's rules. Images first, then media, then the block around the innermost element with
  something of its own to show; a word in a paragraph targets the paragraph, and wrappers bigger than 1.5 viewports
  are skipped. Options: `mediaTags`, `maxArea`, `maxHeight`, `blocks`.

### Your own markup

`match(selector, map?)` takes the closest ancestor of anything under the pointer that matches. Put it ahead of the
defaults:

```ts
import {
  createPointAndShoot,
  defaultTargets,
  match,
} from "@daformat/point-and-shoot";

const cards = match("[data-card-id]", (el) => ({
  kind: "card",
  whole: true,
  data: { id: el.dataset.cardId },
}));

createPointAndShoot({ targets: [cards, ...defaultTargets] });
```

Return `null` from `map` to pass. For anything a selector can't say, write a targeter:

```ts
const embeds: Targeter<{ url: string }> = {
  name: "embeds",
  resolve: ({ stack, flags, is }) => {
    if (flags.textOnly) return null;
    for (const node of stack) {
      const url = embedURL(node); // yours
      if (url) return { kind: "embed", node, whole: true, data: { url } };
      if (is.meaningful(node)) break; // don't look under a dialog
    }
    return null;
  },
};
```

`stack` is what's under the pointer, innermost first, open shadow roots included, with the overlay and ignored
elements left out. `is` has the heuristics `elements()` is made of: `meaningful`, `image` and `media`.

### Flags

Free-form switches the targeters and handlers read. Glea holds ⌘ to collect posts as text rather than as embeds:

```ts
addEventListener(
  "keydown",
  (e) => e.key === "Meta" && pns.setFlags({ textOnly: true }),
);
addEventListener(
  "keyup",
  (e) => e.key === "Meta" && pns.setFlags({ textOnly: false }),
);
```

Setting flags re-resolves the target.

### Selections

- `selection: "target"` (the default) targets a text selection like an element, while the pointer is over it.
- `"anywhere"`: while there's a selection, it's the target wherever the pointer is, and a click anywhere shoots it.
- `"shoot"`: shoots it as soon as the mode turns on, without a click.
- `"ignore"`: leaves selections alone.

In a target list of your own, `selection({ anywhere: true })` does what `"anywhere"` does.

## Shooting

```ts
const pns = createPointAndShoot({
  onShoot: async (target, ctx) => {
    const response = await fetch("/save", {
      method: "POST",
      body: serialize(target),
      signal: ctx.signal,
    });
    if (!response.ok) throw new Error("Not saved");
    return response.json(); // passed on to the shot event as `value`
  },
});
```

While the handler runs, the state is `pending`: the spotlight holds on its target and follows it as the page
scrolls, and the page's clicks are swallowed. `ctx` has:

- `signal`: aborted by `cancel()`, Escape, or `destroy()`.
- `flags`, `point`, and `rect`: the spotlight's rect in viewport and page px.
- `hideOverlay()`: hides the overlay so it isn't in a screenshot. It resolves once the overlay is off the screen,
  with a function to call once the pixels are taken. Call it before any await of your own.
- `captureArea(rect?)`: hands the shot to the area handler. Glea does this for canvases, whose content Markdown can't
  hold.

Shoot without a click with `pns.shoot(target?)`, which takes the current target, an element, a range, or a target
of your own. It works with the mode on or off, and resolves with the result:

```ts
const result = await pns.shoot(document.querySelector("img")!);
```

With no `onShoot`, a shot succeeds with no value: handy when the `shoot` event is all you need.

On a touch screen, with no hover, the first tap on something targets it and a second tap shoots.

## Areas

Dragging is off unless you give an area handler. Without one, a drag is a missed click.

```ts
import { elementsInRect } from "@daformat/point-and-shoot";

createPointAndShoot({
  area: {
    onCapture: (rect) => {
      // Native and custom elements in one pass: strings are selectors, targeters are any with collect().
      const found = elementsInRect(rect.viewport, ["svg", cards], {
        mode: "overlap",
      });
      return found;
    },
    threshold: 4, // px before a press becomes a drag
    minSize: 8, // smaller than this either way is a miss
  },
});
```

`elementsInRect(rect, matchers, options?)` returns what the matchers return, as they return it: in matcher order,
each in document order, nothing filtered or merged. An element matched twice comes back twice, and a card's icons
come back as well as the card. `mode` is `"inside"` (the default) or `"overlap"`. Hidden elements, and elements
clipped away by an ancestor's overflow, are never collected.

### Screenshots

The library doesn't take them: no web API reads a page's pixels without an extension, a native host, or a
screen-share prompt. Hide the overlay and take them your own way:

```ts
area: {
  onCapture: async (rect, ctx) => {
    const shown = await ctx.hideOverlay();
    try {
      return await chrome.runtime.sendMessage({ action: "screenshot", rect }); // captureVisibleTab there
    } finally {
      shown();
    }
  },
},
```

## Feedback

The flash (when a shot lands), the shake (on a miss or a failure), and announcements to screen readers are all on by
default, and each can be customized or turned off:

```ts
createPointAndShoot({
  feedback: {
    // on: "shoot" (as the click lands, the default), "success", or "manual"
    flash: { on: "shoot", color: "white", intensity: 0.6, duration: 420 },
    // on: "both" (a miss and a failure, the default), "miss", "failure", or "manual"
    shake: { on: "both", distance: 4, duration: 820 },
    // Each a string, a function of the moment, or false. These are the defaults:
    announce: {
      activate: "Point and shoot. Click to capture, Escape to cancel.",
      target: false, // a function of the target, if you want hovering announced
      success: "Captured",
      failure: "Couldn't capture that",
      miss: "Nothing to capture here",
      cancel: "Cancelled",
    },
  },
});
```

`pns.flash()`, `pns.shake()` and `pns.announce(text)` play them by hand. With `prefers-reduced-motion`, the
spotlight jumps instead of gliding, the shake becomes a short pulse, and the flash is quicker. When the overlay is
hidden for a screenshot, the flash waits until it's back.

A badge, a toast, or a sound after a shot is yours to draw, from the `shot` event.

## Styling

```ts
createPointAndShoot({
  overlay: {
    color: "rgb(0 0 0 / 0.08)", // the highlight's fill
    pressedColor: "rgb(0 0 0 / 0.12)", // default: `color`, stronger
    dotColor: "rgb(0 0 0 / 0.3)", // the dot under the pointer, default: `color`, stronger
    border: "1px solid currentColor",
    padding: 5, // px around the target
    radius: 8, // px
    dotSize: 14, // px
    dotRadius: 6, // px
    pressScale: 0.95, // 1 for no press
    lean: 4, // px towards the pointer, 0 for none
    duration: 110, // ms between targets
    motion: "user", // "user" follows prefers-reduced-motion, or "full", or "none"
    zIndex: 2147483647,
  },
});
```

Every option is also a custom property on the overlay's host element, `<point-and-shoot>`, so a stylesheet can set it
per theme without any JS. Options set in JS take precedence.

```css
point-and-shoot {
  --pns-color: rgb(0 0 0 / 0.08);
  --pns-radius: 2px;
}
@media (prefers-color-scheme: dark) {
  point-and-shoot {
    --pns-color: rgb(255 255 255 / 0.12);
  }
}
point-and-shoot[data-state="pressed"] {
  --pns-border: 1px solid white;
}
```

| Property                | Default                   |
| ----------------------- | ------------------------- |
| `--pns-color`           | `rgb(112 88 255 / 0.2)`   |
| `--pns-pressed-color`   | `--pns-color`, 1.5× alpha |
| `--pns-dot-color`       | `--pns-color`, 2.5× alpha |
| `--pns-border`          | `none`                    |
| `--pns-padding`         | `5px`                     |
| `--pns-radius`          | `8px`                     |
| `--pns-dot-size`        | `14px`                    |
| `--pns-dot-radius`      | `6px`                     |
| `--pns-press-scale`     | `0.95`                    |
| `--pns-lean`            | `4px`                     |
| `--pns-duration`        | `110ms`                   |
| `--pns-z-index`         | `2147483647`              |
| `--pns-flash-color`     | `rgb(160 140 255)`        |
| `--pns-flash-intensity` | `0.55`                    |
| `--pns-flash-duration`  | `420ms`                   |
| `--pns-shake-distance`  | `4px`                     |
| `--pns-shake-duration`  | `820ms`                   |

The parts are exposed for anything more: `point-and-shoot::part(highlight)` (and `part(dot)` while it's the dot),
`::part(line)` for a selection's lines, and `::part(flash)`. The host's `data-state` is the controller's state.

The overlay lives in a closed shadow root, built without `innerHTML` (for pages with Trusted Types), so the page's
styles can't reach into it.

### Your own overlay

Pass `overlay: null` to draw nothing and use the events, `state` and `target` to draw it yourself (in React, say).
Or pass a renderer:

```ts
type Renderer = {
  mount(): void;
  unmount(): void;
  render(view: View): void; // on every change
  setHidden(hidden: boolean): void; // for screenshots
  flash(style: FlashStyle): void;
  shake(style: ShakeStyle): void;
};

type View = {
  state: State;
  rect: Rect | null; // null: the dot under the pointer
  lines: Rect[] | null; // a selection's lines
  pointer: Point;
  lean: Point; // -1..1 each way
  instant: boolean; // jump there, no transition (scrolling, appearing)
};
```

Announcements don't go through the renderer, so they keep working with no overlay.

## Events

```ts
pns.on("activate", () => {});
pns.on("deactivate", () => {});
pns.on("target", (target, previous) => {});
pns.on("press", (target) => {});
pns.on("shoot", (target, rect) => {}); // a click landed, before the handler runs
pns.on("areastart", (rect) => {});
pns.on("areamove", (rect) => {});
pns.on("areaend", (rect) => {}); // before the handler runs
pns.on("shot", (result) => {}); // { ok, value | error, cancelled, target, rect }
pns.on("miss", (point) => {});
```

`on()` returns a function that removes the listener.

## The controller

| Member               |                                                                       |
| -------------------- | --------------------------------------------------------------------- |
| `state`              | `"idle"`, `"active"`, `"pressed"`, `"dragging"` or `"pending"`        |
| `target`             | what the spotlight is on, or `null`                                   |
| `flags`              | the current flags                                                     |
| `activate({ at? })`  | turns the mode on                                                     |
| `deactivate()`       | turns it off; a pending shot keeps going                              |
| `toggle({ at? })`    |                                                                       |
| `shoot(target?)`     | shoots without a click, resolves with the result                      |
| `captureArea(rect)`  | runs the area handler on a rect, as if it had been dragged            |
| `cancel()`           | aborts a pending shot and leaves the mode                             |
| `setFlags(flags)`    | merges flags in and re-resolves                                       |
| `refresh()`          | re-resolves and re-measures, after the page changed under the pointer |
| `configure(options)` | changes any option in place                                           |
| `flash()`, `shake()` | feedback by hand                                                      |
| `announce(text)`     | says something to screen readers                                      |
| `on(type, listener)` | listens, returns the unsubscribe function                             |
| `destroy()`          | removes every listener and the overlay, for good                      |

Other options: `root` (only elements inside are targeted), `grace` (px of slack around the target before the pointer
counts as gone, 20), `dwell` (ms the pointer must rest on the target's container before the spotlight grows onto it,
180), and `cursor` (the cursor while active, `"pointer"`, or `false`).

The building blocks are exported too: `elementsAtPoint` (shadow-piercing), `boundsFor`, `contentBounds`,
`visibleRect`, `ancestorClip`, `lineRects`, `createHeuristics`, `kindOf`, `selectionRange`, `spotlight`,
`createAnnouncer`, and the geometry helpers.

## Markdown

An optional entry point, never in your bundle unless imported:

```ts
import { toMarkdown } from "@daformat/point-and-shoot/markdown";

toMarkdown(target.node); // an Element, a Range or a DocumentFragment
toMarkdown(node, { baseURI, iconSize: 32, maxDataURL: 200_000 });
```

Headings, emphasis, links and images (made absolute), lists, tables, code blocks and quotes. Forms, navigation,
players, footnote markers and icons are left out. It returns an empty string when there's nothing Markdown can hold,
such as a drawing or a widget.

## One file

For extension content scripts and WKWebView user scripts, which load plain files:
`dist/point-and-shoot.iife.js` (and `.iife.min.js`) puts everything, Markdown included, on `window.PointAndShoot`.

```js
const { createPointAndShoot, toMarkdown } = window.PointAndShoot;
```

## Tests

`pnpm test` runs the unit tests (vitest, happy-dom). `pnpm test:e2e` builds and runs the end-to-end suite in
Chromium, WebKit and Firefox (Playwright), for what only real layout can tell: content bounds, clipping, shadow roots,
frames, real pointer input, and the spotlight's pixels. Install the browsers once with
`pnpm exec playwright install`.

## Demo

```bash
pnpm build && python3 -m http.server
```

Then open http://localhost:8000/demo/.

## Notes

- Main frame only: the overlay can't reach into iframes, and an iframe is targeted whole. While the mode is on,
  frames (and embeds and objects) let the pointer through to the page, so they can be pointed at.
- Closed shadow roots can't be looked into; open ones are.
- The spring on release uses CSS `linear()` easing, and the derived pressed and dot colors use relative color syntax.
  Older browsers fall back to a plain ease and to the default colors.

## License

[Zero-Clause BSD](LICENSE)
