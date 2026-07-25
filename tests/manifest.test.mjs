import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "fantareal-extension.json");

test("manifest matches the Host API 1.1 page contract", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
  assert.match(manifest.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.compatibility.hostApi, ">=1.1.0 <2.0.0");
  assert.deepEqual(Object.keys(manifest.entrypoints).sort(), ["page"]);
  assert.equal(manifest.entrypoints.page.type, "web");
  assert.equal(manifest.entrypoints.page.bridge, "fantareal.extension.v1");
  assert.deepEqual(manifest.permissions, []);

  const page = manifest.contributes.pages.at(0);
  const command = manifest.contributes.commands.at(0);
  assert.equal(page.id, "mobile-chat");
  assert.deepEqual(command.handler, { type: "page.open", page: page.id });
  await access(path.join(root, manifest.entrypoints.page.path));
});
test("manifest intentionally exposes no service or MC-specific Host capability", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const serialized = JSON.stringify(manifest);

  assert.equal(manifest.entrypoints.service, undefined);
  assert.doesNotMatch(serialized, /background\.jobs|character\.context\.read/);
  assert.doesNotMatch(serialized, /FastAPI|mobile-chat-window/i);
});
