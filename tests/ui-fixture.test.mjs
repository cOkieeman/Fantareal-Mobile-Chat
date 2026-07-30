import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("MC9 UI exposes one responsive shell for chat, light apps and resources", async () => {
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
    "host.getChatContext({",
    "return host.generate(request)",
    "return host.cancelGenerate()",
    "host.pickDirectory()",
    "host.getPresentation()",
    "host.setPresentationMode(presentation)",
    "host.close()",
  ]) {
    assert.ok(script.includes(bridge), `missing Host bridge call: ${bridge}`);
  }
  assert.match(script, /include:\s*\["recentMessages"\]/);
  assert.match(script, /messageLimit:\s*12/);
  assert.match(script, /chatContext:\s*rawChatContext/);

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
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const schema = JSON.parse(
    await readFile(path.join(root, "schemas/feed-post.schema.json"), "utf8"),
  );
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
  for (const marker of [
    'class="screen feed-screen"',
    'id="feed-list-view"',
    'id="feed-detail-view"',
    'id="feed-detail-title"',
    'id="feed-detail-content"',
    'class="feed-bottom-nav"',
    'data-feed-tab="home"',
    'data-feed-tab="discover"',
    'data-feed-tab="notice"',
    'data-feed-tab="mine"',
    "<small>通知</small>",
    "<small>我的</small>",
    'id="create-feed-pivot"',
  ]) {
    assert.ok(html.includes(marker), `missing dedicated feed marker: ${marker}`);
  }
  assert.match(script, /feed-card/);
  assert.match(script, /feed-detail-view/);
  assert.match(script, /data-feed-tab/);
  assert.match(script, /function feedSocialScore\(/);
  assert.match(script, /通知\|公告\|提醒\|系统\|notice/);
  assert.match(script, /post\.source === "manual"/);
  const feedRenderer = script.match(
    /function renderFeed\(\)[\s\S]*?function renderForum\(\)/,
  )?.[0] ?? "";
  assert.doesNotMatch(feedRenderer, /light-app-card/);
  assert.match(styles, /\.feed-screen\s*\{/);
  assert.match(styles, /\.feed-card\s*\{/);
  assert.match(styles, /\.feed-bottom-nav\s*\{/);
  assert.match(styles, /\.feed-detail\s*\{/);
  for (const field of ["title", "eventType", "metadata"]) {
    assert.ok(schema.required.includes(field), `feed schema must require ${field}`);
  }
  assert.equal(schema.properties.metadata.type, "object");
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

test("MC9 cost safety removes background generation and keeps explicit manual triggers", async () => {
  const [app, html, lightApps, socialApps, mailApps, packageJson] = await Promise.all([
    readFile(path.join(root, "web/app.js"), "utf8"),
    readFile(path.join(root, "web/index.html"), "utf8"),
    readFile(path.join(root, "web/light-apps.js"), "utf8"),
    readFile(path.join(root, "web/social-apps.js"), "utf8"),
    readFile(path.join(root, "web/mail-apps.js"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);
  const foregroundSources = [app, html, lightApps, socialApps, mailApps, packageJson].join("\n");

  await assert.rejects(access(path.join(root, "web/background-jobs.js")), { code: "ENOENT" });
  for (const forbidden of [
    /background\.jobs/,
    /mobile\.background\./,
    /MobileChatBackgroundJobs/,
    /background-jobs\.js/,
    /data-open-screen="background"/,
    /id="background-screen"/,
    /auto-(feed|forum|mail|diary|calendar)/,
  ]) {
    assert.doesNotMatch(foregroundSources, forbidden);
  }

  for (const marker of [
    'id="generate-feed"',
    'id="generate-forum"',
    'id="generate-mail"',
    'id="generate-diary"',
    'id="generate-calendar"',
  ]) {
    assert.ok(html.includes(marker), `missing manual generation trigger: ${marker}`);
  }
  assert.match(socialApps, /nodes\.generateFeed\.addEventListener\("click"/);
  assert.match(socialApps, /nodes\.generateForum\.addEventListener\("click"/);
  assert.match(mailApps, /nodes\.generate\.addEventListener\("click"/);
  assert.match(lightApps, /nodes\.generateDiary\.addEventListener\("click"/);
  assert.match(lightApps, /nodes\.generateCalendar\.addEventListener\("click"/);
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

test("MC9.2 keeps the twelve-app phone desktop and dedicated light-app experiences", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  const lightApps = await readFile(path.join(root, "web/light-apps.js"), "utf8");
  const resources = await readFile(path.join(root, "web/resource-packs.js"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");

  const home = html.match(
    /<section id="home-screen"[\s\S]*?<\/section>\s*<section id="settings-screen"/,
  )?.[0] ?? "";
  assert.equal(home.match(/class="app-icon /g)?.length, 12);
  for (const label of [
    "群聊", "动态", "论坛", "设置", "表情", "邮箱",
    "日记", "日程", "通知", "电话", "直播", "人物辅助",
  ]) {
    assert.ok(home.includes(`<strong>${label}</strong>`), `missing home app: ${label}`);
  }
  assert.doesNotMatch(home, /Prompt 配置|自动行为/);
  for (const marker of [
    'id="settings-screen"',
    'id="forum-list-view"',
    'id="forum-detail-view"',
    'id="mail-search-input"',
    'id="mail-filter-all"',
    'id="mail-filter-unread"',
    'id="mail-filter-draft"',
    'id="diary-role-list"',
    'id="calendar-grid"',
    'id="calendar-day-label"',
    'id="notifications-unread-count"',
    'data-notification-filter="unread"',
    'id="live-highlights"',
    'id="live-contributors"',
    'data-resource-tab="stickers"',
    'data-resource-tab="manage"',
    'id="sticker-library-list"',
    'id="resource-management-panel"',
  ]) {
    assert.ok(html.includes(marker), `missing MC9.2 marker: ${marker}`);
  }

  assert.match(app, /openScreen:\s*showScreen/);
  assert.match(lightApps, /function notificationTarget\(/);
  assert.match(lightApps, /openScreen\(target\)/);
  assert.match(lightApps, /dataset\.action === "open-source"/);
  assert.match(resources, /function stickerAssets\(/);
  assert.match(resources, /asset\.kind === "sticker"/);
  assert.match(resources, /\["stickers", "backgrounds", "manage"\]\.includes\(tab\)/);
  assert.match(styles, /\.forum-list-view\[hidden\],\s*\n\.forum-detail-view\[hidden\]/);
  assert.match(
    styles,
    /\.screen h2\[tabindex="-1"\]:focus\s*\{\s*outline:\s*none/,
    "programmatic screen focus must not make headings look like text inputs",
  );
  const controlFocusBlock = styles.match(
    /\.icon-button:focus-visible,[\s\S]*?\n\}/,
  )?.[0] || "";
  assert.match(controlFocusBlock, /\.app-navigation button:focus-visible/);
  assert.match(
    controlFocusBlock,
    /outline:\s*2px solid #8cb4ff/,
    "interactive navigation controls must retain a visible keyboard focus",
  );
  assert.doesNotMatch(
    `${app}\n${lightApps}\n${resources}`,
    /localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/,
  );
});

test("MC9.2 keeps mail, diary, notifications, phone, assistant and settings visually distinct", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const controller = await readFile(path.join(root, "web/mc6-apps.js"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");

  for (const marker of [
    'class="mail-topbar"',
    'class="diary-book-heading"',
    'class="notification-summary"',
    'class="phone-stage"',
    'id="phone-avatar-mark"',
    'class="phone-controls"',
    'class="assistant-workflow"',
    'class="assistant-mode-grid"',
    'class="assistant-archive"',
    'class="settings-group"',
  ]) {
    assert.ok(html.includes(marker), `missing dedicated visual marker: ${marker}`);
  }

  assert.doesNotMatch(html, /class="[^"]*mc6-split/);
  assert.doesNotMatch(controller, /light-app-card assistant-card/);
  assert.match(controller, /element\("li", "assistant-draft-card"\)/);
  assert.match(controller, /nodes\.phoneAvatar\.textContent = contactName/);
  assert.match(
    styles,
    /\.settings-screen\[hidden\],[\s\S]*?\.assistant-screen\[hidden\]\s*\{\s*display:\s*none/,
  );
  assert.match(
    styles,
    /html\[data-presentation="expanded"\] \.notifications-screen:not\(\[hidden\]\)/,
    "expanded layouts must not override the native hidden state",
  );
  for (const signature of [
    "#eef3f7",
    "#fffaf0",
    "#edf3fa",
    "#edf9e8",
    "#234f52",
  ]) {
    assert.ok(styles.includes(signature), `missing app-specific palette signature: ${signature}`);
  }
});

test("common dialogs keep a compositing-safe Qt WebEngine backdrop", async () => {
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const backdrop = styles.match(
    /\.mobile-dialog::backdrop\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";

  assert.match(backdrop, /background:\s*rgba\(3,\s*8,\s*14,\s*0\.7\)/);
  assert.doesNotMatch(
    backdrop,
    /backdrop-filter\s*:/,
    "a full-window backdrop blur forces expensive repainting in Qt WebEngine",
  );
});

test("presentation and common chrome avoid repeated layout, long state motion, and live blur", async () => {
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const deviceRule = styles.match(/\.device\s*\{([\s\S]*?)\}/)?.[1] ?? "";

  assert.doesNotMatch(
    deviceRule,
    /transition\s*:[\s\S]*?\bwidth\b/,
    "Qt already resizes the native window before Web presentation changes",
  );
  assert.doesNotMatch(
    deviceRule,
    /transition\s*:[\s\S]*?\bborder-radius\b/,
    "presentation radius changes must not schedule style work for every animation frame",
  );
  assert.doesNotMatch(
    styles,
    /@keyframes\s+screen-enter\b/,
    "screen changes should complete in one render pass inside Qt WebEngine",
  );
  assert.match(
    styles,
    /\.app-navigation button\s*\{\s*transition:\s*transform var\(--motion-duration\) ease;\s*\}/,
    "navigation state colors must update immediately while hover movement stays animated",
  );
  assert.doesNotMatch(
    styles,
    /backdrop-filter\s*:/,
    "live backdrop blur repaints the full WebEngine surface when dialogs open",
  );
});

test("MC9.2 keeps live and calendar at readable 100% presentation scale", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "fantareal-extension.json"), "utf8"),
  );
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const liveController = await readFile(path.join(root, "web/mc6-apps.js"), "utf8");
  const modes = Object.fromEntries(
    manifest.contributes.pages[0].presentation.modes.map((mode) => [mode.id, mode]),
  );

  assert.deepEqual(modes.compact, {
    id: "compact",
    width: 500,
    height: 860,
    minWidth: 480,
    minHeight: 760,
    maxWidth: 600,
    maxHeight: 980,
  });
  assert.deepEqual(modes.expanded, {
    id: "expanded",
    width: 1024,
    height: 860,
    minWidth: 760,
    minHeight: 700,
    maxWidth: 1280,
    maxHeight: 1000,
  });

  for (const marker of [
    'class="live-player"',
    'class="live-player-top"',
    'class="live-player-copy"',
    'class="live-danmaku-stage"',
    'class="live-player-foot"',
    'class="live-highlight-strip"',
    'class="live-content-scroll"',
    'class="live-room-notes"',
    'id="live-inner-thought"',
    'id="live-stats"',
  ]) {
    assert.ok(html.includes(marker), `missing aligned live marker: ${marker}`);
  }
  assert.match(styles, /\.live-player\s*\{[\s\S]*?min-height:\s*320px/);
  assert.match(
    styles,
    /html\[data-presentation="expanded"\] \.live-player\s*\{[\s\S]*?min-height:\s*430px/,
  );
  assert.match(styles, /\.live-segments p\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(styles, /\.live-messages\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(
    styles,
    /\.live-current\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto[\s\S]*?overflow:\s*hidden/,
  );
  assert.match(
    styles,
    /\.live-content-scroll\s*\{[\s\S]*?overflow-y:\s*auto/,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*900px\)[\s\S]*?html\[data-presentation="expanded"\] \.live-content-scroll\s*\{[\s\S]*?grid-template-columns:/,
  );
  assert.match(liveController, /nodes\.liveInnerThought\.textContent\s*=/);
  assert.match(liveController, /nodes\.liveStats\.textContent\s*=/);
  assert.doesNotMatch(
    liveController,
    /nodes\.liveDepth\.textContent\s*=\s*`[^`]*stream\.innerThought/,
  );
  assert.match(styles, /\.calendar-screen\s*\{[\s\S]*?background:\s*#eef3f7/);
  assert.match(styles, /\.calendar-month\s*\{[\s\S]*?background:\s*#fff/);
  assert.match(styles, /\.calendar-day\s*\{[\s\S]*?min-height:\s*38px/);
  assert.match(styles, /\.calendar-day\s*\{[\s\S]*?font-size:\s*13px/);
});

test("MC9.5 restores diary detail, calendar reminders, phone reveal and live lobby", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const lightApps = await readFile(path.join(root, "web/light-apps.js"), "utf8");
  const mc6Apps = await readFile(path.join(root, "web/mc6-apps.js"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");

  for (const marker of [
    'id="diary-detail-dialog"',
    'id="diary-detail-content"',
    'id="calendar-agenda-list"',
    'id="calendar-agenda-count"',
    'id="live-lobby"',
    'id="back-to-live-lobby"',
  ]) {
    assert.ok(html.includes(marker), `missing MC9.5 interaction marker: ${marker}`);
  }
  assert.match(lightApps, /function openDiaryDetail\(/);
  assert.match(lightApps, /dataset\.action = "view"/);
  assert.match(lightApps, /function upcomingCalendarEvents\(/);
  assert.match(mc6Apps, /newPhoneLineIds/);
  assert.match(mc6Apps, /dataset\.liveStreamId/);
  assert.match(mc6Apps, /state\.activeLiveId = null/);
  assert.match(styles, /\.mc6-field select option\s*\{[\s\S]*?color:/);
  assert.match(styles, /\.phone-line\.received\.is-new/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.phone-line\.received\.is-new/);
  assert.match(styles, /\.live-lobby-card/);
  assert.match(
    await readFile(path.join(root, "web/app.js"), "utf8"),
    /code === "llm_response_invalid"[\s\S]*?detail/,
  );
});

test("MC10 consumes visual presets, backgrounds and stickers without a second shell", async () => {
  const html = await readFile(path.join(root, "web/index.html"), "utf8");
  const app = await readFile(path.join(root, "web/app.js"), "utf8");
  const resources = await readFile(path.join(root, "web/resource-packs.js"), "utf8");
  const styles = await readFile(path.join(root, "web/styles.css"), "utf8");
  const appearance = await readFile(path.join(root, "web/appearance.css"), "utf8");

  for (const marker of [
    'data-appearance-preset="modern"',
    'data-appearance-preset="social"',
    'data-appearance-preset="xianxia"',
    'data-appearance-preset="apocalypse"',
    'data-resource-tab="backgrounds"',
    'id="background-library-panel"',
    'id="open-sticker-picker"',
    'id="sticker-picker-dialog"',
    'id="sticker-picker-list"',
    'id="load-more-stickers"',
    'id="load-more-backgrounds"',
    'id="load-more-picker-stickers"',
    'id="export-mobile-data"',
    'id="restore-mobile-data"',
    'id="reset-mobile-data"',
  ]) {
    assert.ok(html.includes(marker), `missing MC10 visual/resource marker: ${marker}`);
  }
  assert.match(app, /mobile\.messages\.sticker\.create/);
  assert.match(app, /mobile\.data\.export/);
  assert.match(app, /mobile\.data\.restore\.preview/);
  assert.match(app, /mobile\.data\.restore\.apply/);
  assert.match(app, /mobile\.data\.reset/);
  assert.match(app, /host\.saveFile/);
  assert.match(app, /suggestedName:\s*"mobile-chat-backup\.json"/);
  assert.match(app, /mediaType:\s*"application\/json"/);
  assert.match(html, /id="export-mobile-data" type="button"/);
  assert.doesNotMatch(html, /id="export-mobile-data"[^>]*disabled/);
  assert.match(html, /导出备份[\s\S]*完整小手机数据/);
  assert.match(html, /重置小手机数据[\s\S]*保留已导入资源包/);
  assert.match(app, /message\.type === "sticker"/);
  assert.match(resources, /mobile\.appearance\.get/);
  assert.match(resources, /mobile\.appearance\.update/);
  assert.match(resources, /mobile\.resources\.assets\.list/);
  assert.match(resources, /mobile\.resources\.asset\.get/);
  assert.match(resources, /offset:\s*current\.length/);
  assert.match(resources, /ASSET_PAGE_SIZE\s*=\s*48/);
  for (const preset of ["modern", "social", "xianxia", "apocalypse"]) {
    assert.match(appearance, new RegExp(`data-preset="${preset}"`));
  }
  assert.match(html, /<link rel="stylesheet" href="styles\.css" \/>[\s\S]*?<link rel="stylesheet" href="appearance\.css" \/>/);
  assert.doesNotMatch(`${app}\n${resources}`, /WORLD_THEME_PROMPTS/);
  assert.equal((html.match(/id="device-shell"/g) || []).length, 1);
});

test("MC10 presets restore the old WebUI component identities", async () => {
  const appearance = await readFile(path.join(root, "web/appearance.css"), "utf8");

  for (const preset of ["modern", "social", "xianxia", "apocalypse"]) {
    assert.match(
      appearance,
      new RegExp(`html\\[data-preset="${preset}"\\] \\.device`),
      `${preset} must theme the device surface, not only accent tokens`,
    );
  }
  assert.match(appearance, /html\[data-preset="social"\] \.message\.outgoing p[\s\S]*?#62c777/);
  assert.match(appearance, /html\[data-preset="social"\] \.composer[\s\S]*?#24262a/);
  assert.match(appearance, /html\[data-preset="xianxia"\] \.home-hero[\s\S]*?255,\s*236,\s*195/);
  assert.match(appearance, /html\[data-preset="xianxia"\] \.app-icon-chat[\s\S]*?#c99a56/);
  assert.match(appearance, /html\[data-preset="apocalypse"\] \.home-hero[\s\S]*?215,\s*102,\s*82/);
  assert.match(appearance, /html\[data-preset="apocalypse"\] \.app-icon-chat[\s\S]*?#d76652/);
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

  for (const marker of [
    "390×700",
    "500×860",
    "480×760",
    "600×980",
    "1024×860",
    "760×700",
    "1280×1000",
    "1180×820",
  ]) {
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
