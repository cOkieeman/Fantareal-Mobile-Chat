import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("offline UI fixture has the required screens and controls", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");

  for (const marker of [
    'id="home-screen"',
    'id="chat-screen"',
    'id="theme-toggle"',
    'id="close-extension"',
    'id="fixture-status"',
  ]) {
    assert.ok(html.includes(marker), `missing UI marker: ${marker}`);
  }

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /href="favicon\.svg"/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<script(?![^>]+src=)/i);
  assert.doesNotMatch(html, /style=/i);
  await access(path.join(root, "web/favicon.svg"));
});

test("fixture JavaScript only uses the optional close bridge", async () => {
  const script = await readFile(path.join(root, "web/app.js"), "utf8");

  assert.match(script, /fantarealExtension/);
  assert.match(script, /host\.close/);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|httpx|localStorage/);
  assert.doesNotMatch(script, /getChatContext|generate\s*\(|invoke\s*\(/);
});
