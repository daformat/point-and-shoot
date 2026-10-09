// The one-file builds, from what tsc compiled: dist/point-and-shoot.iife.js
// and its minified twin.
import { build } from "esbuild";

const common = {
  entryPoints: ["dist/iife.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  legalComments: "none",
};

await build({ ...common, outfile: "dist/point-and-shoot.iife.js" });
await build({
  ...common,
  outfile: "dist/point-and-shoot.iife.min.js",
  minify: true,
});
