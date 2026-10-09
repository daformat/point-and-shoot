/*
 * What only a real browser can tell: layout-dependent targeting (content
 * bounds, clipping, inline blocks, shadow roots), real pointer input, and the
 * spotlight's pixels.
 */

import { expect, type Page, test } from "@playwright/test";

type Rect = { x: number; y: number; width: number; height: number };

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PointAndShoot: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pns: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setup: (opts?: any, style?: any) => boolean;
    lastView: () => {
      rect: Rect | null;
      lines: Rect[] | null;
      state: string;
    } | null;
    targetIs: (node: Node | null | undefined) => boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: any[][];
    linkClicks: number;
  }
}

async function box(page: Page, selector: string): Promise<Rect> {
  const b = await page.locator(selector).boundingBox();
  if (!b) {
    throw new Error(`${selector} has no box`);
  }
  return b;
}

async function hover(page: Page, x: number, y: number) {
  // Two steps, so pointermove fires even if the mouse is already there.
  await page.mouse.move(x + 1, y + 1);
  await page.mouse.move(x, y);
}

async function hoverCenter(page: Page, selector: string) {
  const b = await box(page, selector);
  await hover(page, b.x + b.width / 2, b.y + b.height / 2);
}

const targetIs = (page: Page, selector: string) =>
  page.evaluate((s) => window.targetIs(document.querySelector(s)), selector);

const lastRect = (page: Page) =>
  page.evaluate(() => window.lastView()?.rect ?? null);

const kind = (page: Page) =>
  page.evaluate(() => window.pns.target?.kind ?? null);

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixtures/page.html");
  await page.evaluate(() => window.setup());
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.pns.activate());
});

test.describe("targeting", () => {
  test("lights the text, not the padding around it", async ({ page }) => {
    await hover(page, 230, 90);
    expect(await targetIs(page, "#padded")).toBe(true);
    const rect = (await lastRect(page))!;
    const text = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("padded")!);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(rect.width).toBeLessThan(150);
    expect(rect.x).toBeCloseTo(text.x, 0);
    expect(rect.width).toBeCloseTo(text.width, 0);
    expect(rect.height).toBeCloseTo(text.height, 0);
  });

  test("an inline link targets its paragraph", async ({ page }) => {
    await hoverCenter(page, "#link");
    expect(await targetIs(page, "#para")).toBe(true);
  });

  test("clips to a scrolling ancestor", async ({ page }) => {
    const carousel = await box(page, "#carousel");
    // Scrolled so the second slide's text runs past the carousel's edge.
    await page.evaluate(
      () => (document.getElementById("carousel")!.scrollLeft = 150),
    );
    await hover(page, carousel.x + 200, carousel.y + 40);
    expect(await targetIs(page, "#slide-2")).toBe(true);
    const rect = (await lastRect(page))!;
    const slide = await box(page, "#slide-2");
    expect(slide.x + slide.width).toBeGreaterThan(carousel.x + carousel.width);
    expect(rect.x).toBeGreaterThanOrEqual(slide.x - 0.5);
    expect(rect.x + rect.width).toBeLessThanOrEqual(
      carousel.x + carousel.width + 0.5,
    );
  });

  test("skips a wrapper taller than four viewports", async ({ page }) => {
    const huge = await box(page, "#huge");
    await hover(page, huge.x + 100, huge.y + 400);
    expect(await page.evaluate(() => window.pns.target)).toBeNull();
    await hoverCenter(page, "#huge-child");
    expect(await targetIs(page, "#huge-child")).toBe(true);
  });

  test("hidden and screen-reader-only text show nothing", async ({ page }) => {
    await hover(page, 40, 400);
    expect(await targetIs(page, "#hidden-wrap")).toBe(false);
  });

  test("picks the image, not its wrapper", async ({ page }) => {
    await hoverCenter(page, "#img");
    expect(await targetIs(page, "#img")).toBe(true);
    expect(await kind(page)).toBe("image");
  });

  test("a background image with no text is an image", async ({ page }) => {
    await hoverCenter(page, "#bg");
    expect(await targetIs(page, "#bg")).toBe(true);
    expect(await kind(page)).toBe("image");
  });

  test("part of a drawing targets the whole drawing", async ({ page }) => {
    await hoverCenter(page, "#circle");
    expect(await targetIs(page, "#drawing")).toBe(true);
  });

  test("looks inside open shadow roots", async ({ page }) => {
    const host = await box(page, "#shadow");
    await hover(page, host.x + 40, host.y + 30);
    const inside = await page.evaluate(() =>
      window.targetIs(
        document.getElementById("shadow")!.shadowRoot!.getElementById("inner"),
      ),
    );
    expect(inside).toBe(true);
  });

  test("canvas and iframes are media, taken whole", async ({ page }) => {
    await hoverCenter(page, "#canvas");
    expect(await kind(page)).toBe("media");
    const canvas = await box(page, "#canvas");
    expect(await lastRect(page)).toEqual(canvas);
    await hoverCenter(page, "#frame");
    expect(await targetIs(page, "#frame")).toBe(true);
  });

  test("holds the target across gaps until the pointer rests on the container", async ({
    page,
  }) => {
    const icon = await box(page, "#icon-1");
    await hover(page, icon.x + 12, icon.y + 12);
    expect(await targetIs(page, "#icon-1")).toBe(true);
    // The gap between the first two icons: the row, for a moment, is ignored.
    await hover(page, icon.x + 32, icon.y + 12);
    expect(await targetIs(page, "#icon-1")).toBe(true);
    await page.waitForTimeout(300);
    expect(await targetIs(page, "#icons")).toBe(true);
  });

  test("lights each line of a selection", async ({ page }) => {
    await page.evaluate(() => {
      const p = document.getElementById("select-p")!;
      const range = document.createRange();
      range.selectNodeContents(p);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await hover(
      page,
      (await box(page, "#select-p")).x + 20,
      (await box(page, "#select-p")).y + 10,
    );
    expect(await kind(page)).toBe("selection");
    const lines = await page.evaluate(() => window.lastView()?.lines?.length);
    expect(lines).toBeGreaterThanOrEqual(2);
  });

  test("select all lights text and media, not the boxes around them", async ({
    page,
  }) => {
    await page.evaluate(() => getSelection()!.selectAllChildren(document.body));
    const lines = (await page.evaluate(() =>
      window.PointAndShoot.lineRects(getSelection()!.getRangeAt(0)),
    )) as Rect[];
    const huge = await box(page, "#huge");
    // The tall column's line of text, not the column.
    expect(lines.every((r) => r.height < 200)).toBe(true);
    expect(lines.some((r) => Math.abs(r.x - huge.x) < 2)).toBe(true);
    // The two columns' lines on the same row stay apart.
    const para = await box(page, "#para");
    expect(
      lines.some(
        (r) => r.x + r.width > para.x + para.width + 20 && r.x < para.x + 10,
      ),
    ).toBe(false);
    // The carousel's hidden slides, clipped away by its overflow.
    const carousel = await box(page, "#carousel");
    expect(
      lines.some(
        (r) =>
          r.y < carousel.y + carousel.height &&
          r.y + r.height > carousel.y &&
          r.x + r.width > carousel.x + carousel.width + 1 &&
          r.x < 450, // the cards' own lines start at 460
      ),
    ).toBe(false);
    // Media whole.
    const img = await box(page, "#img");
    expect(lines).toContainEqual(img);
  });

  test("a heavy selection stays quick, and gives up to one box", async ({
    page,
  }) => {
    const ms = await page.evaluate(() => {
      const main = document.createElement("div");
      main.style.cssText = "position:absolute;left:0;top:1200px;width:900px";
      for (let i = 0; i < 3000; i++) {
        const p = document.createElement("p");
        p.innerHTML = `Paragraph ${i} with <b>bold</b>, <a href="#">a link</a> and more words to wrap a little.`;
        main.append(p);
      }
      document.body.append(main);
      getSelection()!.selectAllChildren(document.body);
      const range = getSelection()!.getRangeAt(0);
      const { lineRects, forgetLineRects, outlinePath } = window.PointAndShoot;
      forgetLineRects();
      const t0 = performance.now();
      const lines = lineRects(range);
      const t1 = performance.now();
      lineRects(range); // cached
      const t2 = performance.now();
      const d = outlinePath(lines);
      const t3 = performance.now();
      return {
        gather: t1 - t0,
        cached: t2 - t1,
        outline: t3 - t2,
        count: lines.length,
        drawn: !!d,
      };
    });
    console.log(JSON.stringify(ms));
    expect(ms.count).toBe(1); // past the budget: one box
    // Its time budget (24ms) and one bounding box, with room for slow CI machines.
    expect(ms.gather).toBeLessThan(250);
    expect(ms.cached).toBeLessThan(2);
  });

  test("the browser's highlight hides while the outline shows", async ({
    page,
  }) => {
    const highlight = (inShadow: boolean) =>
      page.evaluate((shadow) => {
        const el = shadow
          ? document
              .getElementById("shadow")!
              .shadowRoot!.getElementById("inner")!
          : document.getElementById("select-p")!;
        return getComputedStyle(el, "::selection").backgroundColor;
      }, inShadow);
    const transparent = /rgba\(0, 0, 0, 0\)|transparent/;
    const yellow = /rgb\(255, 255, 0\)/;
    // A highlight of the page's own, so its hiding and return show.
    await page.evaluate(() => {
      const css = "::selection { background: rgb(255, 255, 0); }";
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      const root = document.getElementById("shadow")!.shadowRoot!;
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    });
    for (const inShadow of [false, true]) {
      expect(await highlight(inShadow)).toMatch(yellow);
      await page.evaluate(() => {
        window.setup({ selection: "anywhere" });
        getSelection()!.removeAllRanges();
      });
      // A real drag-selection: WebKit drops one set from script in a shadow root.
      const b = await page
        .locator(inShadow ? "#shadow #inner" : "#select-p")
        .boundingBox();
      await page.mouse.move(b!.x + 2, b!.y + 10);
      await page.mouse.down();
      await page.mouse.move(b!.x + 120, b!.y + 10, { steps: 5 });
      await page.mouse.up();
      await page.evaluate(() => window.pns.activate({ at: { x: 5, y: 5 } }));
      await hover(page, 900, 600);
      expect(await kind(page)).toBe("selection");
      expect(await highlight(inShadow)).toMatch(transparent);
      await page.evaluate(() => window.pns.deactivate());
      await page.waitForTimeout(100);
      expect(await highlight(inShadow)).toMatch(yellow);
      expect(
        await page.evaluate(() => getSelection()!.toString().length),
      ).toBeGreaterThan(0);
    }
  });

  test("text selected inside a shadow root", async ({ page }) => {
    // A real drag-selection: Chromium and WebKit show the document only a
    // collapsed range at the host.
    const inner = page.locator("#shadow").locator("#inner");
    const b = (await inner.boundingBox())!;
    await page.evaluate(() => window.pns.deactivate());
    await page.mouse.move(b.x + 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        window.PointAndShoot.selectionRange()?.toString(),
      ),
    ).toBe("Inside a shadow root");

    // Pointed at: its lines light up.
    await page.evaluate(() => window.pns.activate());
    await hover(page, b.x + 20, b.y + b.height / 2);
    expect(await kind(page)).toBe("selection");
    expect(await page.evaluate(() => window.lastView()?.lines?.length)).toBe(1);

    // Shot as the mode turns on, as Glea does.
    const shot = await page.evaluate(async () => {
      window.setup({
        selection: "shoot",
        onShoot: (t: { node: Range }) =>
          window.PointAndShoot.toMarkdown(t.node),
      });
      window.pns.activate();
      await new Promise((r) => setTimeout(r, 50));
      return window.events.find(([t]) => t === "shot")?.[1];
    });
    expect(shot).toMatchObject({ ok: true, value: "Inside a shadow root" });
  });

  test("a selection wins wherever the pointer is with selection: anywhere", async ({
    page,
  }) => {
    const select = () =>
      page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById("select-p")!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
      });
    // By default, away from the selection, the image is what's pointed at.
    await select();
    await hoverCenter(page, "#img");
    expect(await kind(page)).toBe("image");

    await page.evaluate(() => {
      window.setup({
        selection: "anywhere",
        onShoot: (t: { kind: string }) => t.kind,
      });
      window.pns.activate();
    });
    await select();
    await hoverCenter(page, "#img");
    expect(await kind(page)).toBe("selection");
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(50);
    const shot = await page.evaluate(
      () => window.events.find(([t]) => t === "shot")?.[1],
    );
    expect(shot).toMatchObject({ ok: true, value: "selection" });
  });
});

test.describe("pointer input", () => {
  test("a click shoots and never reaches the page", async ({ page }) => {
    await hoverCenter(page, "#link");
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.linkClicks)).toBe(0);
    expect(
      await page.evaluate(() => window.events.some(([t]) => t === "shot")),
    ).toBe(true);
    expect(await page.evaluate(() => window.pns.state)).toBe("idle");
    // The mode's off: clicks are the page's again.
    await page.locator("#link").click();
    expect(await page.evaluate(() => window.linkClicks)).toBe(1);
  });

  test("a drag captures the area it draws", async ({ page }) => {
    await page.evaluate(() => {
      window.setup({
        area: {
          onCapture: (rect: { viewport: Rect }) =>
            window.PointAndShoot.elementsInRect(rect.viewport, [".card"]).map(
              (t: { node: HTMLElement }) => t.node.id,
            ),
        },
      });
      window.pns.activate();
    });
    const a = await box(page, "#card-a");
    const b = await box(page, "#card-b");
    await page.mouse.move(a.x - 10, a.y - 10);
    await page.mouse.down();
    await page.mouse.move(a.x + 50, a.y + 30, { steps: 4 });
    await page.mouse.move(b.x + b.width + 10, b.y + b.height + 10, {
      steps: 4,
    });
    await page.mouse.up();
    await page.waitForTimeout(50);
    const shot = await page.evaluate(() => {
      const e = window.events.find(([t]) => t === "shot");
      return e?.[1];
    });
    expect(shot.ok).toBe(true);
    expect(shot.value).toEqual(["card-a", "card-b"]);
    expect(shot.rect.viewport.x).toBeCloseTo(a.x - 10, 0);
    expect(shot.rect.viewport.width).toBeCloseTo(b.x + b.width + 20 - a.x, 0);
  });

  test("follows the target as the page scrolls while pending", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.setup({ onShoot: () => new Promise(() => {}) });
      window.pns.activate();
    });
    await hoverCenter(page, "#para");
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => window.pns.state)).toBe("pending");
    const before = (await lastRect(page))!;
    await page.evaluate(() => window.scrollBy(0, 100));
    await page.waitForTimeout(100);
    const after = (await lastRect(page))!;
    expect(after.y).toBeCloseTo(before.y - 100, 0);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.pns.state)).toBe("idle");
  });
});

test.describe("elementsInRect", () => {
  test("inside or overlapping, from real layout", async ({ page }) => {
    const a = await box(page, "#card-a");
    const ids = (mode: string) =>
      page.evaluate(
        ([rect, m]) =>
          window.PointAndShoot.elementsInRect(rect, [".card"], { mode: m }).map(
            (t: { node: HTMLElement }) => t.node.id,
          ),
        [
          {
            x: a.x - 5,
            y: a.y - 5,
            width: a.width + 40,
            height: a.height + 10,
          },
          mode,
        ] as const,
      );
    expect(await ids("inside")).toEqual(["card-a"]);
    expect(await ids("overlap")).toEqual(["card-a", "card-b"]);
  });
});

test.describe("the spotlight's pixels", () => {
  async function pixel(page: Page, x: number, y: number) {
    const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
    return page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
    }, shot.toString("base64"));
  }

  const near = (a: number[], b: number[]) =>
    a.every((v, i) => Math.abs(v - b[i]!) < 12);

  test("draws over the target in the configured color, and hides for screenshots", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.setup(
        {
          feedback: { flash: false },
          onShoot: async (
            _t: unknown,
            ctx: { hideOverlay(): Promise<() => void> },
          ) => {
            const shown = await ctx.hideOverlay();
            (window as unknown as { hidden: boolean }).hidden = true;
            await new Promise((r) => setTimeout(r, 400));
            shown();
            return 1;
          },
        },
        { color: "rgb(255 0 0)", padding: 0, motion: "none", lean: 0 },
      );
      window.pns.activate();
    });
    const bg = await box(page, "#bg");
    await hover(page, bg.x + bg.width / 2, bg.y + bg.height / 2);
    await page.waitForTimeout(400);
    expect(near(await pixel(page, bg.x + 10, bg.y + 10), [255, 0, 0])).toBe(
      true,
    );
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
      () => (window as unknown as { hidden: boolean }).hidden,
    );
    // The overlay's off the screen: the page's own teal shows.
    expect(near(await pixel(page, bg.x + 10, bg.y + 10), [0, 128, 128])).toBe(
      true,
    );
  });

  test("draws the dot at Glea's size, 14px", async ({ page }) => {
    await page.evaluate(() => {
      window.setup({}, { dotColor: "rgb(255 0 0)", motion: "none" });
    });
    // Over nothing: the empty band under the tall column's first line.
    const huge = await box(page, "#huge");
    const x = Math.round(huge.x + 100);
    const y = Math.round(huge.y + 600);
    await page.mouse.move(x, y);
    await page.evaluate(() => window.pns.activate());
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x, y);
    await page.waitForTimeout(400);
    expect(near(await pixel(page, x + 5, y), [255, 0, 0])).toBe(true);
    expect(near(await pixel(page, x, y + 5), [255, 0, 0])).toBe(true);
    expect(near(await pixel(page, x + 9, y), [255, 0, 0])).toBe(false);
  });

  test("takes its color from the page's stylesheet", async ({ page }) => {
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent =
        "point-and-shoot { --pns-color: rgb(0 0 255); --pns-padding: 0px; --pns-lean: 0px; }";
      document.head.append(style);
    });
    const bg = await box(page, "#bg");
    await hover(page, bg.x + bg.width / 2, bg.y + bg.height / 2);
    await page.waitForTimeout(500);
    expect(near(await pixel(page, bg.x + 10, bg.y + 10), [0, 0, 255])).toBe(
      true,
    );
  });
});

test.describe("markdown", () => {
  test("converts a block from the page", async ({ page }) => {
    const md = await page.evaluate(() =>
      window.PointAndShoot.toMarkdown(document.getElementById("para")),
    );
    // In-page anchors mean nothing outside the page: their text stays, not the link.
    expect(md).toBe(
      "A paragraph with an inline link and *emphasis* in it, long enough to wrap.",
    );
  });
});
