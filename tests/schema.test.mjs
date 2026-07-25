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
});
