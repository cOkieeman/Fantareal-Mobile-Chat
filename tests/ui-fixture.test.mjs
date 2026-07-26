import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("MC4 UI exposes one responsive group-chat DOM and its complete controls", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");

  for (const marker of [
    'id="home-screen"',
    'id="chat-screen"',
    'id="group-panel"',
    'id="conversation-panel"',
    'id="group-list"',
    'id="message-list"',
    'id="group-dialog"',
    'id="import-dialog"',
    'id="composer-form"',
    'id="message-input"',
    'id="continue-chat"',
    'id="send-message"',
    'id="stop-generation"',
    'id="retry-generation"',
    'id="presentation-toggle"',
    'id="app-navigation"',
    'id="close-extension"',
    'id="fixture-status"',
  ]) {
    assert.ok(html.includes(marker), `missing UI marker: ${marker}`);
  }

  assert.equal(html.match(/id="group-panel"/g)?.length, 1);
  assert.equal(html.match(/id="conversation-panel"/g)?.length, 1);
  assert.match(html, /data-presentation="compact"/);
  assert.match(html, /data-chat-view="groups"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /maxlength="500"/);
  assert.match(html, /id="stop-generation"[^>]+hidden/);
  assert.doesNotMatch(html, /静态对话|MC4 接入后|离线 fixture/);
  assert.doesNotMatch(html, /browser-host-mock/);
});

test("MC4 bridge flow covers context, CRUD, generation, cancellation and explicit import", async () => {
  const script = await readFile(path.join(root, "web/app.js"), "utf8");

  for (const bridge of [
    "host.getContext()",
    "host.getCharacterContext()",
    "host.generate(prepared.request)",
    "host.cancelGenerate()",
    "host.pickDirectory()",
    "host.getPresentation()",
    "host.setPresentationMode(presentation)",
    "host.close()",
  ]) {
    assert.ok(script.includes(bridge), `missing Host bridge call: ${bridge}`);
  }

  for (const method of [
    "mobile.context.bind",
    "mobile.groups.list",
    "mobile.groups.create",
    "mobile.groups.update",
    "mobile.groups.delete",
    "mobile.messages.list",
    "mobile.messages.clear",
    "mobile.chat.prepare",
    "mobile.chat.commit",
    "mobile.chat.abort",
    "mobile.import.preview",
    "mobile.import.apply",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing service method: ${method}`);
  }

  assert.match(script, /cardUid:\s*activeCardUid/);
  assert.match(script, /contextRevision:\s*revision/);
  assert.match(script, /sessionId/);
  assert.match(script, /reason,\s*message:\s*errorMessage\(error\)/);
  assert.match(script, /data-chat-view|dataset\.chatView/);
  assert.ok(
    script.includes(
      'window.addEventListener("focus", () => {\n    if (!state.busy) void syncContext({ quiet: true });\n  });',
    ),
    "focus recovery must retry Character Context even after the initial bind failed",
  );
  const syncContextSource = script.match(
    /async function syncContext[\s\S]+?(?=\n  async function openGroup)/,
  )?.[0] || "";
  assert.match(
    syncContextSource,
    /if \(\s*contextChanged[\s\S]+?\) \{\s*state\.retry = null;/,
    "same-context focus sync must preserve the pending generation retry",
  );
  const loadMessagesSource = script.match(
    /async function loadMessages[\s\S]+?(?=\n  async function refreshGroups)/,
  )?.[0] || "";
  assert.match(
    loadMessagesSource,
    /lastMessage\?\.type === "error"[\s\S]+?groupId,[\s\S]+?mode: "continue"/,
    "reopening a chat must recover retry from its persisted trailing error",
  );
  assert.doesNotMatch(
    script,
    /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage/,
  );
});

test("offline package policy and frozen presentation contract remain intact", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const specPath = path.join(root, "docs/mc1b-presentation-spec.md");
  const spec = await readFile(specPath, "utf8");

  assert.match(html, /Content-Security-Policy/);
  for (const directive of ["style-src", "script-src", "img-src", "font-src"]) {
    assert.match(
      html,
      new RegExp(`${directive}[^;]*fantareal-extension:`),
      `${directive} must allow same-package resources under the Host custom scheme`,
    );
  }
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<script(?![^>]+src=)/i);
  assert.doesNotMatch(html, /style=/i);

  for (const marker of ["390×700", "360×620", "440×820", "760×720", "680×620", "960×860", "1180×820"]) {
    assert.ok(spec.includes(marker), `missing presentation dimension: ${marker}`);
  }
  assert.match(spec, /状态：`frozen`/);
  assert.match(spec, /Host 持久化/);
  assert.match(spec, /Web 不持久化/);
  assert.match(styles, /data-presentation="expanded"/);
  assert.match(styles, /data-chat-view="conversation"/);
  assert.match(styles, /\.composer button\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(styles, /--blue: #4f83e8/);
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 679px\)/);

  await access(path.join(root, "web/favicon.svg"));
  await access(specPath);
});
