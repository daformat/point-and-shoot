/*
 * HTML to Markdown, Glea's: what a note can hold of a block, a selection or
 * an image. Forms, navigation and players are left out; icons too.
 */

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "button",
  "input",
  "select",
  "textarea",
  "form",
  "nav",
  "iframe",
  "object",
  "embed",
  "dialog",
  "point-and-shoot",
]);

export type MarkdownOptions = {
  /** Base for relative URLs: the node's document's base URI by default. */
  baseURI?: string;
  /** Images shown this small or smaller both ways are left out (portal badges, flags). 32 by default, 0 keeps all. */
  iconSize?: number;
  /** data: URLs longer than this are left out. 200000 by default. */
  maxDataURL?: number;
};

type Context = Required<MarkdownOptions> & { pre?: boolean };

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function absolute(url: string, ctx: Context): string {
  try {
    return new URL(url, ctx.baseURI).href;
  } catch {
    return "";
  }
}

function imageSource(img: HTMLImageElement, ctx: Context): string {
  let src = img.currentSrc || img.getAttribute("src") || "";
  if (
    (!src || src.startsWith("data:")) &&
    (img.dataset.src || img.dataset.lazySrc)
  ) {
    src = img.dataset.src || img.dataset.lazySrc || "";
  }
  const srcset = img.getAttribute("srcset");
  if (!src && srcset) {
    src = srcset.split(",").pop()!.trim().split(" ")[0] ?? "";
  }
  if (src.startsWith("data:")) {
    return src.length > ctx.maxDataURL ? "" : src;
  }
  return src ? absolute(src, ctx) : "";
}

/** Shown small both ways (or sized so in its attributes, for copies off the page). */
function isIcon(img: HTMLImageElement, ctx: Context): boolean {
  if (!ctx.iconSize) {
    return false;
  }
  const width = img.isConnected
    ? img.width
    : parseInt(img.getAttribute("width") ?? "", 10);
  const height = img.isConnected
    ? img.height
    : parseInt(img.getAttribute("height") ?? "", 10);
  return (
    width > 0 && height > 0 && width <= ctx.iconSize && height <= ctx.iconSize
  );
}

function isHidden(el: Element): boolean {
  if (!el.isConnected || typeof getComputedStyle !== "function") {
    return false;
  }
  const style = getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function children(node: Node, ctx: Context): string {
  return Array.from(node.childNodes)
    .map((n) => convert(n, ctx))
    .join("");
}

function block(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `\n\n${trimmed}\n\n` : "";
}

function list(node: Element, ctx: Context): string {
  const ordered = node.tagName === "OL";
  let index = parseInt(node.getAttribute("start") || "1", 10) || 1;
  const items: string[] = [];
  for (const li of Array.from(node.children)) {
    if (li.tagName !== "LI") {
      continue;
    }
    const marker = ordered ? `${index++}. ` : "- ";
    let content = Array.from(li.childNodes)
      .map((n) => {
        if (
          n instanceof Element &&
          (n.tagName === "UL" || n.tagName === "OL")
        ) {
          return "\n" + list(n, ctx).trim().replace(/^/gm, "  ");
        }
        return convert(n, ctx);
      })
      .join("");
    content = content.replace(/\n{2,}/g, "\n").trim();
    const checkbox = li.querySelector<HTMLInputElement>(
      ":scope > input[type=checkbox]",
    );
    const task = checkbox ? (checkbox.checked ? "[x] " : "[ ] ") : "";
    items.push(
      marker + task + content.replace(/\n/g, "\n" + " ".repeat(marker.length)),
    );
  }
  return `\n\n${items.join("\n")}\n\n`;
}

function table(node: Element, ctx: Context): string {
  const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children).map((cell) =>
      children(cell, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim(),
    ),
  );
  if (!rows.length) {
    return "";
  }
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) =>
    r.concat(Array<string>(width - r.length).fill(""));
  const lines = [
    `| ${pad(rows[0]!).join(" | ")} |`,
    `| ${Array<string>(width).fill("---").join(" | ")} |`,
  ];
  for (const r of rows.slice(1)) {
    lines.push(`| ${pad(r).join(" | ")} |`);
  }
  return `\n\n${lines.join("\n")}\n\n`;
}

function wrap(text: string, mark: string): string {
  return text.trim() ? `${mark}${text.trim()}${mark}` : text;
}

function convert(node: Node, ctx: Context): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? "";
    return ctx.pre ? value : escapeMarkdown(value.replace(/\s+/g, " "));
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return children(node, ctx);
  }
  if (!(node instanceof Element)) {
    return "";
  }
  const tag = node.tagName.toLowerCase();
  if (
    SKIP.has(tag) ||
    node.getAttribute("aria-hidden") === "true" ||
    isHidden(node)
  ) {
    return "";
  }
  // Footnote markers like [1] mean nothing outside the page.
  if (
    tag === "sup" &&
    /^\s*\[\s*[\w\s]{1,12}\]\s*$/.test(node.textContent ?? "")
  ) {
    return "";
  }

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = children(node, ctx).replace(/\s+/g, " ").trim();
      return text ? `\n\n${"#".repeat(+tag[1]!)} ${text}\n\n` : "";
    }
    case "p":
    case "div":
    case "section":
    case "article":
    case "header":
    case "footer":
    case "main":
    case "aside":
    case "figure":
    case "dl":
    case "dd":
    case "dt":
    case "details":
    case "summary":
    case "address":
      return block(children(node, ctx));
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "strong":
    case "b":
      return wrap(children(node, ctx), "**");
    case "em":
    case "i":
    case "cite":
      return wrap(children(node, ctx), "*");
    case "del":
    case "s":
    case "strike":
      return wrap(children(node, ctx), "~~");
    case "code":
    case "kbd":
    case "samp":
      return ctx.pre
        ? (node.textContent ?? "")
        : "`" + (node.textContent ?? "").replace(/`/g, "'") + "`";
    case "pre": {
      const code =
        node instanceof HTMLElement &&
        node.isConnected &&
        typeof node.innerText === "string"
          ? node.innerText
          : (node.textContent ?? "");
      const lang =
        (node.querySelector("code")?.className.match(/language-(\S+)/) ||
          [])[1] || "";
      return `\n\n\`\`\`${lang}\n${code.replace(/\n+$/, "")}\n\`\`\`\n\n`;
    }
    case "blockquote":
      return (
        "\n\n" +
        children(node, ctx)
          .trim()
          .replace(/\n{3,}/g, "\n\n")
          .replace(/^/gm, "> ") +
        "\n\n"
      );
    case "ul":
    case "ol":
      return list(node, ctx);
    case "li":
      return block("- " + children(node, ctx).trim());
    case "table":
      return table(node, ctx);
    case "a": {
      const text = children(node, ctx).replace(/\s+/g, " ").trim();
      const href = node.getAttribute("href");
      if (!href || href.startsWith("javascript:") || href.startsWith("#")) {
        return text;
      }
      if (!text) {
        return "";
      }
      return /^!\[/.test(text) ? text : `[${text}](${absolute(href, ctx)})`;
    }
    case "img": {
      const img = node as HTMLImageElement;
      if (isIcon(img, ctx)) {
        return "";
      }
      const src = imageSource(img, ctx);
      if (!src) {
        return "";
      }
      const alt = (node.getAttribute("alt") || "")
        .replace(/[[\]\n]/g, " ")
        .trim();
      return `![${alt}](${src})`;
    }
    case "picture": {
      const img = node.querySelector("img");
      return img ? convert(img, ctx) : "";
    }
    case "figcaption": {
      const text = children(node, ctx).trim();
      return text ? `\n\n*${text}*\n\n` : "";
    }
    case "video": {
      const video = node as HTMLVideoElement;
      const src = video.currentSrc || node.getAttribute("src");
      return src ? `![Video](${absolute(src, ctx)})` : "";
    }
    case "svg":
    case "canvas":
      return "";
    default:
      return children(node, ctx);
  }
}

/**
 * Markdown for an element, a range (a selection) or a fragment. An empty
 * string when there's nothing Markdown can hold (a drawing, a widget).
 */
export function toMarkdown(
  node: Node | Range,
  options: MarkdownOptions = {},
): string {
  const source = node instanceof Range ? node.cloneContents() : node;
  const doc =
    node instanceof Range
      ? node.startContainer.ownerDocument
      : node.ownerDocument;
  const ctx: Context = {
    baseURI: options.baseURI ?? doc?.baseURI ?? "",
    iconSize: options.iconSize ?? 32,
    maxDataURL: options.maxDataURL ?? 200_000,
  };
  const markdown = convert(source, ctx)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdown && node instanceof Range) {
    return escapeMarkdown(node.toString().trim());
  }
  return markdown;
}
