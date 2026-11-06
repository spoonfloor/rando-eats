// Renders design/die.svg to the PNG icons in icons/, using headless Chrome.
// Usage: node dev/make-icons.mjs
// (Chrome's --screenshot can't go below its minimum window size, so this sets
// the exact viewport through the DevTools protocol instead.)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "design/die.svg");
// The browser-tab favicon gets slightly rounded corners. Home Screen and
// manifest icons stay square: iOS and Android apply their own rounding.
const FAVICON_RADIUS = 80; // of 512
const ICONS = [
  [180, "apple-touch-icon.png", false], // iOS Home Screen
  [32, "favicon-32.png", true],         // browsers without SVG favicons
  [192, "icon-192.png", false],         // web app manifest
  [512, "icon-512.png", false],
];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const square = fs.readFileSync(SRC, "utf8").replace(/^<\?xml[^>]*>\s*/, "");
const rounded = square.replace(/<rect id="bg"/, `<rect id="bg" rx="${FAVICON_RADIUS}"`);
if (rounded === square) throw new Error('die.svg has no <rect id="bg"> to round');
fs.writeFileSync(path.join(ROOT, "icons/favicon.svg"), rounded);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
try {
  let tabs;
  for (let i = 0; i < 50 && !tabs; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); pending.delete(d.id); };
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

  // Transparent page, so the rounded corners come out transparent.
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [size, name, round] of ICONS) {
    const html = `<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${round ? rounded : square}`;
    await send("Page.navigate", { url: "data:text/html;base64," + Buffer.from(html).toString("base64") });
    await sleep(300);
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await sleep(100);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(ROOT, "icons", name), Buffer.from(data, "base64"));
    console.log(`icons/${name} ${size}×${size}`);
  }
  ws.close();
} finally {
  // Let Chrome finish writing its profile before deleting it.
  const exited = new Promise(r => chrome.once("exit", r));
  chrome.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
