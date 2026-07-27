import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("MC8 UI exposes one responsive shell for chat, light apps, automation and resources", async () => {
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
    'id="diary-screen"',
    'id="calendar-screen"',
    'id="notifications-screen"',
    'id="feed-screen"',
    'id="forum-screen"',
    'id="mail-screen"',
    'id="diary-dialog"',
    'id="calendar-dialog"',
    'id="feed-dialog"',
    'id="forum-thread-dialog"',
    'id="forum-reply-dialog"',
    'id="mail-compose-dialog"',
    'id="mail-thread-dialog"',
    'id="generate-diary"',
    'id="stop-diary-generation"',
    'id="generate-calendar"',
    'id="stop-calendar-generation"',
    'id="generate-mail"',
    'id="stop-mail-generation"',
    'id="phone-screen"',
    'id="phone-session-list"',
    'id="phone-form"',
    'id="stop-phone-generation"',
    'id="live-screen"',
    'id="live-current"',
    'id="live-message-form"',
    'id="stop-live-generation"',
    'id="assistant-screen"',
    'id="assistant-dialog"',
    'id="stop-assistant-generation"',
    'id="workbench-screen"',
    'id="workbench-form"',
    'id="stop-workbench-generation"',
    'id="background-screen"',
    'id="background-job-list"',
    'id="pause-all-background-jobs"',
    'id="resume-all-background-jobs"',
    'id="resources-screen"',
    'id="resource-pack-list"',
    'id="resource-quota-progress"',
    'id="import-resource-pack"',
    'id="clear-resource-packs"',
    'id="resource-import-dialog"',
    'id="resource-import-form"',
    'id="confirm-resource-import"',
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
    "return host.generate(request)",
    "return host.cancelGenerate()",
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
  assert.match(script, /generation:\s*null/);
  assert.match(script, /generationCoordinator\.begin\("chat"\)/);
  assert.match(script, /generationCoordinator\.generate\(prepared\.request\)/);
  assert.match(script, /generationCoordinator\.requestCancel\("chat"\)/);
  assert.doesNotMatch(script, /busy:\s*false|cancelRequested:\s*false,\s*\n\s*editingGroupId/);
  assert.match(script, /data-chat-view|dataset\.chatView/);
  assert.match(
    script,
    /window\.addEventListener\("focus",\s*\(\) => \{\s*if \(!generationBusy\(\)\) void syncContext\(\{ quiet: true \}\);\s*\}\);/,
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

test("MC5 light-app bridge covers diary, calendar and notification lifecycle", async () => {
  const script = await readFile(path.join(root, "web/light-apps.js"), "utf8");
  const generated = await readFile(path.join(root, "web/generated-app.js"), "utf8");
  for (const method of [
    "mobile.diary.list",
    "mobile.diary.create",
    "mobile.diary.update",
    "mobile.diary.delete",
    "mobile.calendar.list",
    "mobile.calendar.create",
    "mobile.calendar.update",
    "mobile.calendar.delete",
    "mobile.notifications.list",
    "mobile.notifications.mark",
    "mobile.notifications.readAll",
    "mobile.notifications.clear",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing service method: ${method}`);
  }
  assert.match(script, /MobileChatGeneratedApp\.sameContext\(state\.context,\s*bound\)/);
  for (const phase of ["prepare", "commit", "abort"]) {
    assert.ok(
      generated.includes(`\${servicePrefix}.generate.${phase}`),
      `missing generated light-app service phase: ${phase}`,
    );
  }
  assert.match(generated, /generation\.begin\(owner\)/);
  assert.match(generated, /generation\.generate\(prepared\.request\)/);
  assert.match(generated, /generation\.requestCancel\(owner\)/);
  assert.doesNotMatch(`${script}\n${generated}`, /retry|localStorage|sessionStorage/);
  assert.doesNotMatch(
    `${script}\n${generated}`,
    /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/,
  );
});

test("MC5B social bridge covers feed, forum, replies and shared generation", async () => {
  const script = await readFile(path.join(root, "web/social-apps.js"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  for (const method of [
    "mobile.feed.list",
    "mobile.feed.create",
    "mobile.feed.update",
    "mobile.feed.delete",
    "mobile.feed.like.toggle",
    "mobile.forum.list",
    "mobile.forum.create",
    "mobile.forum.update",
    "mobile.forum.delete",
    "mobile.forum.reply.create",
    "mobile.forum.reply.delete",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing service method: ${method}`);
  }
  assert.match(script, /generated\.run\("feed"\)/);
  assert.match(script, /generated\.run\("forum"\)/);
  assert.match(script, /MobileChatGeneratedApp\.sameContext\(state\.context,\s*bound\)/);
  assert.match(app, /featureControllers\s*=\s*\[/);
  assert.match(app, /MobileChatLightApps\?\.createController/);
  assert.match(app, /MobileChatSocialApps\?\.createController/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest/);
});

test("MC5C mail bridge covers threads, compose, reply and shared generation", async () => {
  const script = await readFile(path.join(root, "web/mail-apps.js"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  for (const method of [
    "mobile.mail.list",
    "mobile.mail.mark",
    "mobile.mail.delete",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing service method: ${method}`);
  }
  assert.match(script, /generated\.run\("mail"\)/);
  assert.match(script, /generated\.run\("mail-compose",\s*\{/);
  assert.match(script, /servicePrefix:\s*"mobile\.mail\.compose"/);
  assert.match(script, /generated\.run\("mail-reply",\s*\{/);
  assert.match(script, /servicePrefix:\s*"mobile\.mail\.reply"/);
  assert.match(script, /MobileChatGeneratedApp\.sameContext\(state\.context,\s*bound\)/);
  assert.match(app, /MobileChatMailApps\?\.createController/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest/);
});

test("MC6 bridge keeps phone, live, assistant and workbench in one controller", async () => {
  const script = await readFile(path.join(root, "web/mc6-apps.js"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  for (const method of [
    "mobile.phone.list",
    "mobile.phone.hangup",
    "mobile.phone.delete",
    "mobile.live.list",
    "mobile.live.message.create",
    "mobile.live.like.toggle",
    "mobile.live.end",
    "mobile.live.delete",
    "mobile.assistant.list",
    "mobile.assistant.update",
    "mobile.assistant.delete",
    "mobile.workbench.get",
    "mobile.workbench.update",
    "mobile.workbench.reset",
    "mobile.workbench.preview",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing service method: ${method}`);
  }
  assert.match(script, /generated\.run\("phone",\s*\{/);
  assert.match(script, /servicePrefix:\s*"mobile\.phone\.call"/);
  assert.match(script, /generated\.run\("live"\s*,/);
  assert.match(script, /generated\.run\("live-tick",\s*\{/);
  assert.match(script, /servicePrefix:\s*"mobile\.live\.tick"/);
  assert.match(script, /generated\.run\("assistant",\s*\{/);
  assert.match(script, /generated\.run\("workbench",\s*\{/);
  assert.match(
    script,
    /if \(session && state\.characters\.some\([\s\S]+nodes\.phoneContact\.value = session\.contactId;/,
  );
  assert.match(
    script,
    /await generated\.run\("workbench",[\s\S]+?\r?\n\s*\}\);\r?\n\s*await loadWorkbench\(\);/,
  );
  assert.match(script, /nodes\.assistantForm\.querySelectorAll\("input, textarea, select, button"\)/);
  assert.equal(html.match(/id="stop-assistant-generation"/g)?.length, 1);
  assert.ok(
    html.indexOf('id="stop-assistant-generation"')
      > html.indexOf('id="assistant-dialog"'),
    "assistant stop button must remain inside its modal dialog",
  );
  assert.match(script, /MobileChatGeneratedApp\.sameContext\(state\.context,\s*bound\)/);
  assert.match(app, /MobileChatMc6Apps\?\.createController/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest/);
});

test("MC7 background controller uses Host jobs without a second generation coordinator", async () => {
  const script = await readFile(path.join(root, "web/background-jobs.js"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  const html = await readFile(path.join(root, "web/index.html"), "utf8");

  for (const method of [
    "listBackgroundJobs",
    "upsertBackgroundJob",
    "pauseBackgroundJob",
    "resumeBackgroundJob",
    "cancelBackgroundJob",
    "removeBackgroundJob",
    "runBackgroundJobNow",
    "pauseAllBackgroundJobs",
    "resumeAllBackgroundJobs",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing Host background method: ${method}`);
  }
  assert.match(script, /handler:\s*"mobile\.background\.prepare"/);
  assert.match(script, /binding:\s*\{\s*\.\.\.state\.context\s*\}/);
  assert.match(script, /context:\s*\{\s*\.\.\.state\.context\s*\}/);
  assert.match(script, /activeCharacter:\s*\{\s*\.\.\.state\.activeCharacter\s*\}/);
  assert.match(script, /角色已切换 · 需重新启用/);
  assert.match(script, /关闭小手机窗口不会取消它/);
  assert.match(app, /MobileChatBackgroundJobs\?\.createController/);
  assert.match(html, /data-open-screen="background"/);
  assert.doesNotMatch(script, /generation\.begin|generation\.generate|localStorage|sessionStorage/);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
});

test("MC8 resource controller previews authorization and quota before per-card import", async () => {
  const script = await readFile(path.join(root, "web/resource-packs.js"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  const html = await readFile(path.join(root, "web/index.html"), "utf8");

  for (const method of [
    "mobile.resources.list",
    "mobile.resources.preview",
    "mobile.resources.import",
    "mobile.resources.delete",
    "mobile.resources.clear",
  ]) {
    assert.ok(script.includes(`"${method}"`), `missing resource method: ${method}`);
  }
  assert.match(script, /host\.pickDirectory\(\)/);
  assert.match(script, /directoryToken/);
  assert.match(script, /contentDigest:\s*preview\.contentDigest/);
  assert.match(script, /context:\s*state\.context/);
  assert.match(script, /preview\.license|const license = preview\.license/);
  assert.match(script, /redistributionAllowed/);
  assert.match(script, /preview\.fitsQuota/);
  assert.match(script, /assets_quota_unconfigured/);
  assert.match(script, /插件管理 → 小手机 → 资源额度/);
  assert.match(script, /pack\.status === "damaged"/);
  assert.match(script, /confirmAction\(/);
  assert.match(script, /image\.src = asset\.dataUrl/);
  assert.match(app, /MobileChatResourcePacks\?\.createController/);
  assert.match(html, /data-open-screen="resources"/);
  assert.match(html, /resource-packs\.js/);
  assert.equal(html.match(/id="resources-screen"/g)?.length, 1);
  assert.equal(html.match(/id="resource-import-dialog"/g)?.length, 1);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
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
