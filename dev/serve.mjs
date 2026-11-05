// Live-reload dev server. Zero dependencies: `node dev/serve.mjs`
//
// Serves the project folder and watches it. When a file changes:
//   - index.html with only <style> changes → styles are swapped in place
//     (no reload, so whatever’s on screen stays put)
//   - a .css file → its <link> is re-fetched in place
//   - anything else → full page reload

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 5180;
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// Runs in the page. Keeps the page’s source minus <style> blocks; if a change
// only touched <style>, it swaps the CSS in place instead of reloading.
const CLIENT = `(() => {
  const STYLE = /<style[^>]*>[\\s\\S]*?<\\/style>/gi;
  const src = () => fetch(location.pathname, { cache: "no-store" }).then(r => r.text());
  let baseline = src().then(t => t.replace(STYLE, ""));

  async function onChange(file) {
    if (file.endsWith(".css")) {
      for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
        const u = new URL(l.href); u.searchParams.set("v", Date.now()); l.href = u;
      }
      return;
    }
    const page = location.pathname.endsWith("/") ? "index.html" : location.pathname.split("/").pop();
    if (file !== page) return location.reload();
    const text = await src();
    if (text.replace(STYLE, "") !== await baseline) return location.reload();
    const fresh = new DOMParser().parseFromString(text, "text/html").querySelectorAll("style");
    const live = document.querySelectorAll("style");
    if (fresh.length !== live.length) return location.reload();
    fresh.forEach((s, i) => { live[i].textContent = s.textContent; });
    console.log("[live-reload] styles updated");
  }

  new EventSource("/__livereload").addEventListener("change", e => onChange(e.data));
})();`;

const clients = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/__livereload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/__livereload.js") {
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-store" });
    return res.end(CLIENT);
  }

  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); return res.end("Forbidden");
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    if (ext === ".html") {
      data = data.toString().replace(/<\/body>/i, `<script src="/__livereload.js"></script>\n</body>`);
    }
    res.end(data);
  });
});

// Editors often save in several quick writes; wait for them to settle.
const pending = new Map();
fs.watch(ROOT, { recursive: true }, (_event, name) => {
  if (!name || name.startsWith(".git") || name.includes(`${path.sep}.`) || name.startsWith(".")) return;
  clearTimeout(pending.get(name));
  pending.set(name, setTimeout(() => {
    pending.delete(name);
    const rel = name.split(path.sep).join("/");
    console.log(`changed: ${rel}`);
    for (const c of clients) c.write(`event: change\ndata: ${rel}\n\n`);
  }, 80));
});

server.listen(PORT, HOST, () => console.log(`Live-reload server at http://${HOST}:${PORT}/`));
