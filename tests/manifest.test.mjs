import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "fantareal-extension.json");

test("manifest matches the Host API 1.3 application-window contract", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
  assert.match(manifest.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.compatibility.hostApi, ">=1.3.0 <2.0.0");
  assert.deepEqual(Object.keys(manifest.entrypoints).sort(), ["page", "service"]);
  assert.equal(manifest.entrypoints.page.type, "web");
  assert.equal(manifest.entrypoints.page.bridge, "fantareal.extension.v1");
  assert.deepEqual(manifest.entrypoints.service, {
    type: "python",
    module: "fantareal_mobile_chat.service",
    protocol: "jsonrpc-2.0-stdio",
    lockfile: "uv.lock",
  });
  assert.deepEqual(manifest.permissions, [
    "storage.data",
    "storage.assets",
    "files.user-selected.directory-read",
    "character.context.read",
    "chat.context.read",
    "llm.generate",
  ]);

  const page = manifest.contributes.pages.at(0);
  const command = manifest.contributes.commands.at(0);
  assert.equal(page.id, "mobile-chat");
  assert.deepEqual(page.launcher, { surface: "applications", order: 100 });
  assert.equal(page.presentation.kind, "window");
  assert.equal(page.presentation.defaultMode, "compact");
  assert.deepEqual(
    page.presentation.modes.map(({ id, width, height, minWidth, minHeight, maxWidth, maxHeight }) => ({
      id,
      width,
      height,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
    })),
    [
      { id: "compact", width: 500, height: 860, minWidth: 480, minHeight: 760, maxWidth: 600, maxHeight: 980 },
      { id: "expanded", width: 1024, height: 860, minWidth: 760, minHeight: 700, maxWidth: 1280, maxHeight: 1000 },
    ],
  );
  assert.deepEqual(command.handler, { type: "page.open", page: page.id });
  await access(path.join(root, manifest.entrypoints.page.path));
  await access(path.join(root, manifest.entrypoints.service.lockfile));
});
test("manifest requests only foreground generation and storage capabilities through MC9", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const serialized = JSON.stringify(manifest);

  assert.doesNotMatch(serialized, /background\.jobs/);
  assert.match(serialized, /storage\.data/);
  assert.match(serialized, /storage\.assets/);
  assert.match(serialized, /files\.user-selected\.directory-read/);
  assert.match(serialized, /character\.context\.read/);
  assert.match(serialized, /chat\.context\.read/);
  assert.match(serialized, /llm\.generate/);
  assert.doesNotMatch(serialized, /FastAPI|mobile-chat-window/i);
});
