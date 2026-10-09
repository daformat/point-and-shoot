import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPointAndShoot, type PointAndShoot } from "./controller.js";
import { HOST_TAG } from "./dom.js";
import { defaultTargets, match, selection } from "./targets.js";
import {
  click,
  frames,
  installLayout,
  key,
  PAGE,
  pointer,
  tick,
} from "./test-utils.js";
import type { Target } from "./types.js";

let restore: () => void;
let instances: PointAndShoot<never, unknown>[] = [];

function create<D = never, R = unknown>(
  ...args: Parameters<typeof createPointAndShoot<D, R>>
) {
  const pns = createPointAndShoot<D, R>(...args);
  instances.push(pns as unknown as PointAndShoot<never, unknown>);
  return pns;
}

const $ = (id: string) => document.getElementById(id)!;
const host = () => document.querySelector(HOST_TAG);
const live = () =>
  document.querySelector("[data-point-and-shoot=announcer]")?.textContent;

const cards = match<{ id: string }>(".card", (el) => ({
  kind: "card",
  whole: true,
  data: { id: (el as HTMLElement).dataset.id! },
}));

beforeEach(() => {
  document.body.innerHTML = PAGE;
  restore = installLayout();
});

afterEach(() => {
  instances.forEach((p) => p.destroy());
  instances = [];
  restore();
  document.body.innerHTML = "";
});

describe("the mode", () => {
  it("adds nothing to the page until activated", () => {
    create();
    expect(host()).toBeNull();
    expect(document.querySelector("style[data-point-and-shoot]")).toBeNull();
  });

  it("turns on and off, with events and the overlay", async () => {
    const pns = create();
    const events: string[] = [];
    pns.on("activate", () => events.push("activate"));
    pns.on("deactivate", () => events.push("deactivate"));
    pns.activate();
    expect(pns.state).toBe("active");
    expect(host()).not.toBeNull();
    expect(
      document.querySelector("style[data-point-and-shoot=cursor]"),
    ).not.toBeNull();
    pns.deactivate();
    expect(pns.state).toBe("idle");
    expect(
      document.querySelector("style[data-point-and-shoot=cursor]"),
    ).toBeNull();
    expect(events).toEqual(["activate", "deactivate"]);
    await tick(300);
    expect(host()).toBeNull();
  });

  it("toggles", () => {
    const pns = create();
    pns.toggle();
    expect(pns.state).toBe("active");
    pns.toggle();
    expect(pns.state).toBe("idle");
  });

  it("leaves no overlay with overlay: null", () => {
    const pns = create({ overlay: null });
    pns.activate();
    expect(host()).toBeNull();
  });

  it("leaves the cursor alone with cursor: false", () => {
    const pns = create({ cursor: false });
    pns.activate();
    expect(
      document.querySelector("style[data-point-and-shoot=cursor]")?.textContent,
    ).not.toContain("cursor:");
  });

  it("lets the pointer through frames while active", () => {
    const pns = create();
    pns.activate();
    expect(
      document.querySelector("style[data-point-and-shoot=cursor]")?.textContent,
    ).toContain("iframe, frame, embed, object { pointer-events: none");
  });

  it("keeps one controller active per document", () => {
    const a = create();
    const b = create();
    a.activate();
    b.activate();
    expect(a.state).toBe("idle");
    expect(b.state).toBe("active");
  });

  it("is gone for good once destroyed", () => {
    const pns = create();
    pns.activate();
    pns.destroy();
    expect(host()).toBeNull();
    pns.activate();
    expect(pns.state).toBe("idle");
  });
});

describe("targeting", () => {
  it("follows the pointer to the block under it", async () => {
    const pns = create();
    const seen: (Target<never> | null)[] = [];
    pns.on("target", (t) => seen.push(t));
    pns.activate({ at: { x: 70, y: 25 } });
    await frames();
    // The word is inline: its paragraph is the target.
    expect(pns.target?.node).toBe($("intro"));
    expect(pns.target?.kind).toBe("element");
    pointer("pointermove", 100, 300);
    expect(pns.target?.node).toBe($("photo"));
    expect(pns.target?.kind).toBe("image");
    expect(seen.map((t) => t && (t.node as Element).id)).toEqual([
      "intro",
      "photo",
    ]);
  });

  it("tries custom targeters first", async () => {
    const pns = create({ targets: [cards, ...defaultTargets] });
    pns.activate({ at: { x: 40, y: 115 } });
    await frames();
    expect(pns.target?.kind).toBe("card");
    expect(pns.target?.data).toEqual({ id: "a" });
  });

  it("never targets ignored elements", async () => {
    const pns = create({ ignore: "#toolbar" });
    pns.activate({ at: { x: 620, y: 30 } });
    await frames();
    expect(pns.target?.node).not.toBe($("button"));
    expect(pns.target?.node).not.toBe($("toolbar"));
  });

  it("re-resolves when flags change", async () => {
    const pns = create<{ id: string }>({
      // No waiting on the container: the flags are what's tested here.
      dwell: 0,
      targets: [
        {
          name: "flagged",
          resolve: (ctx) => (ctx.flags.cards ? cards.resolve!(ctx) : null),
        },
        ...defaultTargets,
      ],
    });
    pns.activate({ at: { x: 40, y: 115 } });
    await frames();
    expect(pns.target?.kind).toBe("element");
    pns.setFlags({ cards: true });
    expect(pns.flags).toEqual({ cards: true });
    expect(pns.target?.kind).toBe("card");
  });
});

describe("shooting", () => {
  it("shoots the target on a click, then leaves the mode", async () => {
    const onShoot = vi.fn(() => "done");
    const pns = create({ onShoot });
    const shots: unknown[] = [];
    pns.on("shot", (r) => shots.push(r));
    pns.activate();
    const { down, up } = click(100, 300);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(onShoot).toHaveBeenCalledOnce();
    expect(onShoot.mock.calls[0]![0 as never]).toMatchObject({
      node: $("photo"),
    });
    await tick();
    expect(shots).toMatchObject([{ ok: true, value: "done" }]);
    expect(pns.state).toBe("idle");
  });

  it("stays with after: stay", async () => {
    const pns = create({ after: "stay", onShoot: () => 1 });
    pns.activate();
    click(100, 300);
    await tick();
    expect(pns.state).toBe("active");
  });

  it("holds while pending and swallows the page's clicks", async () => {
    let finish!: (v: string) => void;
    const pns = create({
      onShoot: () => new Promise<string>((r) => (finish = r)),
    });
    pns.activate();
    click(100, 300);
    expect(pns.state).toBe("pending");
    const pageClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    $("intro").dispatchEvent(pageClick);
    expect(pageClick.defaultPrevented).toBe(true);
    finish("ok");
    await tick();
    expect(pns.state).toBe("idle");
  });

  it("stays on failure, and says so", async () => {
    const pns = create({
      onShoot: () => {
        throw new Error("nope");
      },
    });
    const shots: { ok: boolean; cancelled?: boolean }[] = [];
    pns.on("shot", (r) => shots.push(r));
    pns.activate();
    click(100, 300);
    await tick(80);
    expect(shots).toMatchObject([{ ok: false, cancelled: false }]);
    expect(pns.state).toBe("active");
    expect(live()).toBe("Couldn't capture that");
  });

  it("misses a click on nothing", async () => {
    const onShoot = vi.fn();
    const pns = create({ onShoot });
    const misses: unknown[] = [];
    pns.on("miss", (p) => misses.push(p));
    pns.activate();
    click(900, 900);
    expect(onShoot).not.toHaveBeenCalled();
    expect(misses).toEqual([{ x: 900, y: 900 }]);
  });

  it("succeeds with no value and no handler", async () => {
    const pns = create();
    const shots: unknown[] = [];
    pns.on("shot", (r) => shots.push(r));
    pns.activate();
    click(100, 300);
    await tick();
    expect(shots).toMatchObject([{ ok: true, value: undefined }]);
  });

  it("shoots programmatically, mode or not", async () => {
    const onShoot = vi.fn((t: Target<never>) => t.kind);
    const pns = create({ onShoot });
    const result = await pns.shoot($("photo"));
    expect(result).toMatchObject({ ok: true, value: "image" });
    expect(pns.state).toBe("idle");
  });

  it("refuses a second shot while one is pending", async () => {
    const pns = create({ onShoot: () => new Promise(() => {}) });
    void pns.shoot($("photo"));
    const second = await pns.shoot($("intro"));
    expect(second.ok).toBe(false);
  });

  it("hands a shot to the area handler", async () => {
    const onCapture = vi.fn(() => "pixels");
    const pns = create({
      area: { onCapture },
      onShoot: (_t, ctx) => ctx.captureArea(),
    });
    const result = await pns.shoot($("photo"));
    expect(result).toMatchObject({ ok: true, value: "pixels" });
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it("hides the overlay for a screenshot", async () => {
    const setHidden = vi.fn();
    const renderer = {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      setHidden,
      flash: vi.fn(),
      shake: vi.fn(),
    };
    const pns = create({
      overlay: renderer,
      onShoot: async (_t, ctx) => {
        const shown = await ctx.hideOverlay();
        expect(setHidden).toHaveBeenLastCalledWith(true);
        expect(renderer.flash).not.toHaveBeenCalled();
        shown();
        return 1;
      },
    });
    await pns.shoot($("photo"));
    expect(setHidden).toHaveBeenLastCalledWith(false);
    expect(renderer.flash).toHaveBeenCalledOnce();
  });
});

describe("Escape and cancel", () => {
  it("cancels a pending shot", async () => {
    let signal!: AbortSignal;
    const pns = create({
      onShoot: (_t, ctx) => {
        signal = ctx.signal;
        return new Promise(() => {});
      },
    });
    const pending = (pns.activate(), click(100, 300), null);
    void pending;
    expect(pns.state).toBe("pending");
    const esc = key("Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect(signal.aborted).toBe(true);
    await tick(80);
    expect(pns.state).toBe("idle");
    expect(live()).toBe("Cancelled");
  });

  it("leaves the mode", () => {
    const pns = create();
    pns.activate();
    key("Escape");
    expect(pns.state).toBe("idle");
  });

  it("can be turned off", () => {
    const pns = create({ escape: false });
    pns.activate();
    const esc = key("Escape");
    expect(esc.defaultPrevented).toBe(false);
    expect(pns.state).toBe("active");
  });

  it("resolves shoot() as cancelled", async () => {
    const pns = create({ onShoot: () => new Promise(() => {}) });
    const result = pns.shoot($("photo"));
    pns.cancel();
    expect(await result).toMatchObject({ ok: false, cancelled: true });
  });
});

describe("guard and ignore", () => {
  it("lets the event through and leaves the mode when the guard says no", () => {
    let held = true;
    const pns = create({ guard: () => held });
    pns.activate();
    held = false;
    const down = pointer("pointerdown", 100, 300);
    expect(down.defaultPrevented).toBe(false);
    expect(pns.state).toBe("idle");
  });

  it("lets clicks on ignored elements through", () => {
    const onShoot = vi.fn();
    const pns = create({ ignore: "#toolbar", onShoot });
    pns.activate();
    const { down } = click(620, 30);
    const pageClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    $("button").dispatchEvent(pageClick);
    expect(down.defaultPrevented).toBe(false);
    expect(pageClick.defaultPrevented).toBe(false);
    expect(onShoot).not.toHaveBeenCalled();
    expect(pns.state).toBe("active");
  });
});

describe("areas", () => {
  it("draws and captures an area", async () => {
    const onCapture = vi.fn(() => "area");
    const pns = create({ area: { onCapture } });
    const events: string[] = [];
    pns.on("areastart", () => events.push("start"));
    pns.on("areamove", () => events.push("move"));
    pns.on("areaend", () => events.push("end"));
    pns.activate();
    pointer("pointermove", 10, 10);
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 50, 40);
    expect(pns.state).toBe("dragging");
    pointer("pointermove", 110, 90);
    pointer("pointerup", 110, 90);
    expect(events).toEqual(["start", "move", "end"]);
    expect(onCapture).toHaveBeenCalledOnce();
    expect((onCapture.mock.calls[0] as unknown[])[0]).toMatchObject({
      viewport: { x: 10, y: 10, width: 100, height: 80 },
    });
    await tick();
    expect(pns.state).toBe("idle");
  });

  it("misses too small an area", () => {
    const onCapture = vi.fn();
    const pns = create({ area: { onCapture, minSize: 20 } });
    const misses = vi.fn();
    pns.on("miss", misses);
    pns.activate();
    pointer("pointermove", 10, 10);
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 25, 25);
    pointer("pointerup", 25, 25);
    expect(onCapture).not.toHaveBeenCalled();
    expect(misses).toHaveBeenCalledOnce();
  });

  it("is a miss without the area option", () => {
    const onShoot = vi.fn();
    const pns = create({ onShoot });
    const misses = vi.fn();
    pns.on("miss", misses);
    pns.activate();
    pointer("pointermove", 100, 300);
    pointer("pointerdown", 100, 300);
    pointer("pointermove", 200, 380);
    expect(pns.state).toBe("pressed");
    pointer("pointerup", 200, 380);
    expect(onShoot).not.toHaveBeenCalled();
    expect(misses).toHaveBeenCalledOnce();
  });

  it("captures an area programmatically", async () => {
    const pns = create({ area: { onCapture: (r) => r.viewport.width } });
    expect(
      await pns.captureArea({ x: 0, y: 0, width: 42, height: 10 }),
    ).toMatchObject({
      ok: true,
      value: 42,
    });
  });
});

describe("touch", () => {
  it("targets on the first tap and shoots on the second", () => {
    const onShoot = vi.fn();
    const pns = create({ onShoot });
    pns.activate();
    pointer("pointerdown", 100, 300, { pointerType: "touch" });
    pointer("pointerup", 100, 300, { pointerType: "touch" });
    expect(pns.target?.node).toBe($("photo"));
    expect(onShoot).not.toHaveBeenCalled();
    pointer("pointerdown", 100, 300, { pointerType: "touch" });
    pointer("pointerup", 100, 300, { pointerType: "touch" });
    expect(onShoot).toHaveBeenCalledOnce();
  });
});

describe("selection", () => {
  it("targets the selection anywhere with selection({ anywhere: true })", () => {
    select();
    const ctx = {
      point: { x: 900, y: 900 },
      stack: [],
      flags: {},
      current: null,
      root: document,
      is: {} as never,
    };
    expect(selection().resolve!(ctx)).toBeNull();
    expect(selection({ anywhere: true }).resolve!(ctx)).toMatchObject({
      kind: "selection",
    });
  });

  function select() {
    const range = document.createRange();
    range.selectNodeContents($("intro"));
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return range;
  }

  it("shoots it on activation with selection: shoot", async () => {
    select();
    const onShoot = vi.fn((t: Target<never>) => t.kind);
    const pns = create({ selection: "shoot", onShoot });
    pns.activate();
    expect(onShoot).toHaveBeenCalledOnce();
    expect(onShoot.mock.calls[0]![0].node).toBeInstanceOf(Range);
    await tick();
    expect(pns.state).toBe("idle");
  });

  it("hides the browser's selection highlight while it's lit, then brings it back", async () => {
    select();
    const pns = create({
      selection: "shoot",
      onShoot: () => new Promise(() => {}),
    });
    const rule = () =>
      document.querySelector("style[data-point-and-shoot=selection]");
    pns.activate();
    expect(rule()?.textContent).toContain("::selection");
    pns.cancel();
    await tick(500);
    expect(rule()).toBeNull();
    // The selection itself is still there.
    expect(getSelection()!.toString()).toContain("Some");
  });

  it("leaves the highlight alone with hideSelection: false", () => {
    select();
    const pns = create({
      selection: "shoot",
      hideSelection: false,
      onShoot: () => new Promise(() => {}),
    });
    pns.activate();
    expect(
      document.querySelector("style[data-point-and-shoot=selection]"),
    ).toBeNull();
  });

  it("leaves it alone otherwise", () => {
    select();
    const onShoot = vi.fn();
    const pns = create({ onShoot });
    pns.activate();
    expect(onShoot).not.toHaveBeenCalled();
  });
});

describe("announcements", () => {
  it("announces the mode and the result", async () => {
    const pns = create({
      onShoot: () => ({ message: "Saved" }),
      feedback: { announce: { success: (r) => r.value.message } },
    });
    pns.activate();
    await tick(80);
    expect(live()).toBe("Point and shoot. Click to capture, Escape to cancel.");
    click(100, 300);
    await tick(80);
    expect(live()).toBe("Saved");
  });

  it("can be silenced", async () => {
    const pns = create({ feedback: { announce: false } });
    pns.activate();
    pns.announce("hello");
    await tick(80);
    expect(live()).toBeUndefined();
  });
});

describe("feedback", () => {
  function fakeRenderer() {
    return {
      mount: vi.fn(),
      unmount: vi.fn(),
      render: vi.fn(),
      setHidden: vi.fn(),
      flash: vi.fn(),
      shake: vi.fn(),
    };
  }

  it("flashes on the shot and shakes on a miss by default", async () => {
    const renderer = fakeRenderer();
    const pns = create({ overlay: renderer, after: "stay" });
    pns.activate();
    click(100, 300);
    expect(renderer.flash).toHaveBeenCalledOnce();
    await tick();
    click(900, 900);
    expect(renderer.shake).toHaveBeenCalledOnce();
  });

  it("passes on only the options given", () => {
    const renderer = fakeRenderer();
    const pns = create({
      overlay: renderer,
      feedback: { flash: { color: "red" }, shake: { distance: 9 } },
    });
    pns.activate();
    pns.flash();
    pns.shake();
    expect(renderer.flash).toHaveBeenCalledWith({
      color: "red",
      intensity: undefined,
      duration: undefined,
    });
    expect(renderer.shake).toHaveBeenCalledWith({
      distance: 9,
      duration: undefined,
    });
  });

  it("flashes on success only, when asked", async () => {
    const renderer = fakeRenderer();
    let finish!: () => void;
    const pns = create({
      overlay: renderer,
      onShoot: () => new Promise<void>((r) => (finish = r)),
      feedback: { flash: { on: "success" } },
    });
    pns.activate();
    click(100, 300);
    expect(renderer.flash).not.toHaveBeenCalled();
    finish();
    await tick();
    expect(renderer.flash).toHaveBeenCalledOnce();
  });

  it("can be turned off", () => {
    const renderer = fakeRenderer();
    const pns = create({
      overlay: renderer,
      feedback: { flash: false, shake: false },
    });
    pns.activate();
    click(100, 300);
    pns.flash();
    pns.shake();
    expect(renderer.flash).not.toHaveBeenCalled();
    expect(renderer.shake).not.toHaveBeenCalled();
  });
});
