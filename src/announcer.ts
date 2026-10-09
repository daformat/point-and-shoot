/*
 * A polite live region for screen readers: visually hidden, outside the
 * overlay so it works with no overlay at all, added on the first message.
 */

const HIDDEN =
  "position: fixed !important; width: 1px !important; height: 1px !important; " +
  "margin: -1px !important; padding: 0 !important; border: 0 !important; " +
  "overflow: hidden !important; clip-path: inset(50%) !important; white-space: nowrap !important;";

export type Announcer = {
  say(message: string): void;
  destroy(): void;
};

export function createAnnouncer(): Announcer {
  let region: HTMLElement | null = null;
  let timer = 0;
  return {
    say(message) {
      if (typeof document === "undefined" || !message) {
        return;
      }
      if (!region || !region.isConnected) {
        region = document.createElement("div");
        region.setAttribute("aria-live", "polite");
        region.setAttribute("aria-atomic", "true");
        region.setAttribute("data-point-and-shoot", "announcer");
        region.style.cssText = HIDDEN;
        (document.body || document.documentElement).appendChild(region);
      }
      // Cleared first, so the same message twice is read twice.
      region.textContent = "";
      clearTimeout(timer);
      const target = region;
      timer = window.setTimeout(() => {
        target.textContent = message;
      }, 50);
    },
    destroy() {
      clearTimeout(timer);
      region?.remove();
      region = null;
    },
  };
}
