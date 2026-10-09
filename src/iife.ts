/*
 * The one-file build, for extension content scripts and WKWebView user
 * scripts: everything, Markdown included, on window.PointAndShoot.
 */

import * as core from "./index.js";
import * as markdown from "./markdown.js";

const PointAndShoot = Object.freeze({ ...core, ...markdown });

declare global {
  interface Window {
    PointAndShoot: typeof PointAndShoot;
  }
}

if (typeof window !== "undefined" && !window.PointAndShoot) {
  Object.defineProperty(window, "PointAndShoot", {
    value: PointAndShoot,
    enumerable: false,
  });
}
