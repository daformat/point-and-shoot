// A static server for the fixtures, from the repo root, so they load dist/.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4174);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer((req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  try {
    if (!file.startsWith(root) || !statSync(file).isFile()) {
      throw new Error("not found");
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1");
