import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("MC1 fixture follows the frozen per-card data boundary", async () => {
  const schema = await readJson("schemas/mobile-chat-fixture.schema.json");
  const fixture = await readJson("tests/fixtures/mobile-chat.fixture.json");

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "cardUid", "groups"]);
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.cardUid, /^[A-Za-z0-9._-]+$/);
  assert.ok(fixture.groups.length > 0 && fixture.groups.length <= 32);

  for (const group of fixture.groups) {
    assert.match(group.groupId, /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
    assert.ok(group.title.length > 0 && group.title.length <= 80);
    assert.equal(new Set(group.memberRoleIds).size, group.memberRoleIds.length);
    for (const message of group.messages) {
      assert.ok(message.content.length > 0 && message.content.length <= 16_384);
      assert.ok(Number.isFinite(Date.parse(message.createdAt)));
    }
  }
});
test("empty resource pack is valid and contains no bundled assets", async () => {
  const schema = await readJson("schemas/resource-pack.schema.json");
  const resourcePack = await readJson("resources/empty-pack/resource-pack.json");

  assert.equal(schema.additionalProperties, false);
  assert.equal(resourcePack.schemaVersion, 1);
  assert.match(resourcePack.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  assert.match(resourcePack.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  assert.deepEqual(resourcePack.assets, []);
  const kindSchema = schema.$defs.asset.properties.kind;
  assert.deepEqual(kindSchema.oneOf[0].enum, ["sticker", "background"]);
  assert.equal(kindSchema.oneOf[1].const, "avatar-decoration");
  assert.equal(kindSchema.oneOf[1].deprecated, true);
});

test("MC10 appearance, sticker message and backup schemas stay closed", async () => {
  const appearance = await readJson("schemas/appearance.schema.json");
  const message = await readJson("schemas/message.schema.json");
  const backup = await readJson("schemas/mobile-chat-backup.schema.json");

  assert.equal(appearance.additionalProperties, false);
  assert.deepEqual(appearance.properties.preset.enum, [
    "modern",
    "social",
    "xianxia",
    "apocalypse",
  ]);
  assert.deepEqual(appearance.properties.tone.enum, ["midnight", "mist"]);
  assert.ok(message.properties.type.enum.includes("sticker"));
  assert.equal(backup.additionalProperties, false);
  assert.equal(backup.properties.kind.const, "fantareal.mobile-chat.backup");
  assert.equal(backup.properties.data.additionalProperties, false);
});

test("MC5A light apps keep separate closed schemas", async () => {
  const diary = await readJson("schemas/diary-entry.schema.json");
  const calendar = await readJson("schemas/calendar-event.schema.json");
  const notification = await readJson("schemas/notification.schema.json");

  assert.equal(diary.additionalProperties, false);
  assert.equal(calendar.additionalProperties, false);
  assert.equal(notification.additionalProperties, false);
  assert.match(diary.properties.entryId.pattern, /^\^diary_/);
  assert.match(calendar.properties.eventId.pattern, /^\^calendar_/);
  assert.match(notification.properties.notificationId.pattern, /^\^notification_/);
  assert.deepEqual(diary.properties.source.enum, ["manual", "model", "import"]);
  assert.deepEqual(calendar.properties.status.enum, ["planned", "completed", "cancelled"]);
  assert.deepEqual(notification.properties.source.enum, [
    "system",
    "diary",
    "calendar",
    "feed",
    "forum",
    "mail",
    "phone",
    "live",
    "import",
  ]);
});

test("MC5B social apps keep separate closed schemas", async () => {
  const feed = await readJson("schemas/feed-post.schema.json");
  const forum = await readJson("schemas/forum-thread.schema.json");
  const reply = forum.properties.replies.items;

  assert.equal(feed.additionalProperties, false);
  assert.equal(forum.additionalProperties, false);
  assert.equal(reply.additionalProperties, false);
  assert.match(feed.properties.postId.pattern, /^\^feed_/);
  assert.match(forum.properties.threadId.pattern, /^\^thread_/);
  assert.match(reply.properties.replyId.pattern, /^\^reply_/);
  assert.deepEqual(feed.properties.source.enum, ["manual", "model", "import"]);
  assert.deepEqual(forum.properties.source.enum, ["manual", "model", "import"]);
  assert.deepEqual(reply.properties.source.enum, ["manual", "model", "import"]);
});

test("MC5C mail keeps a closed thread and message schema", async () => {
  const mail = await readJson("schemas/mail-thread.schema.json");
  const message = mail.properties.messages.items;

  assert.equal(mail.additionalProperties, false);
  assert.equal(message.additionalProperties, false);
  assert.match(mail.properties.threadId.pattern, /^\^mail_/);
  assert.match(message.properties.messageId.pattern, /^\^mailmsg_/);
  assert.deepEqual(message.properties.direction.enum, ["sent", "received"]);
  assert.deepEqual(mail.properties.source.enum, ["manual", "model", "import"]);
  assert.deepEqual(message.properties.source.enum, ["manual", "model", "import"]);
});

test("MC6 interactive apps and workbench keep separate closed schemas", async () => {
  const phone = await readJson("schemas/phone-session.schema.json");
  const live = await readJson("schemas/live-stream.schema.json");
  const draft = await readJson("schemas/character-draft.schema.json");
  const profile = await readJson("schemas/prompt-profile.schema.json");

  assert.equal(phone.additionalProperties, false);
  assert.equal(phone.properties.lines.items.additionalProperties, false);
  assert.match(phone.properties.sessionId.pattern, /^\^call_/);
  assert.deepEqual(phone.properties.status.enum, ["ongoing", "ended", "missed"]);
  assert.deepEqual(phone.properties.lines.items.properties.direction.enum, [
    "sent",
    "received",
  ]);

  assert.equal(live.additionalProperties, false);
  assert.equal(live.properties.segments.items.additionalProperties, false);
  assert.equal(live.properties.messages.items.additionalProperties, false);
  assert.match(live.properties.streamId.pattern, /^\^live_/);
  assert.deepEqual(live.properties.status.enum, ["live", "ended"]);
  assert.equal(live.properties.messages.maxItems, 100);

  assert.equal(draft.additionalProperties, false);
  assert.match(draft.properties.draftId.pattern, /^\^draft_/);
  assert.deepEqual(draft.properties.mode.enum, ["create", "extract"]);
  assert.equal(draft.properties.tags.maxItems, 16);

  assert.equal(profile.additionalProperties, false);
  assert.deepEqual(profile.properties.scope.enum, [
    "diary",
    "calendar",
    "feed",
    "forum",
    "mail",
    "phone",
    "live",
    "assistant",
  ]);
  assert.equal(profile.properties.instruction.maxLength, 4000);
});
