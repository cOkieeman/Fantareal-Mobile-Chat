import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([
  ".git",
  ".venv",
  ".build-audit",
  "__pycache__",
  "node_modules",
  "coverage",
  "dist",
  "build",
]);
const forbiddenNames = new Set([".env", "settings.json", "conversations.json", "current_role_card.json"]);

async function collectFiles(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      (ignoredDirectories.has(entry.name) || entry.name.startsWith(".smoke-venv-"))
    ) {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolute, result);
    } else {
      result.push(absolute);
    }
  }
  return result;
}

test("repository contains no private runtime files, generated Python files, or large assets", async () => {
  const files = await collectFiles(root);
  assert.ok(files.length > 0);

  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const name = path.basename(file);
    const info = await stat(file);

    assert.ok(!forbiddenNames.has(name), `forbidden private file: ${relative}`);
    assert.doesNotMatch(relative, /(^|\/)__pycache__(\/|$)|\.py[co]$/i);
    assert.doesNotMatch(relative, /(^|\/)(stickers?|models?|logs?)(\/|$)/i);
    assert.ok(info.size < 1024 * 1024, `unexpected file larger than 1 MiB: ${relative}`);
  }
});

test("release versions stay aligned across Extension, npm and Python surfaces", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "fantareal-extension.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const pyproject = await readFile(path.join(root, "pyproject.toml"), "utf8");
  const initSource = await readFile(
    path.join(root, "src", "fantareal_mobile_chat", "__init__.py"),
    "utf8",
  );
  const serviceSource = await readFile(
    path.join(root, "src", "fantareal_mobile_chat", "service.py"),
    "utf8",
  );
  const pythonVersion = manifest.version.replace(/-rc\.(\d+)$/, "rc$1");

  assert.equal(packageJson.version, manifest.version);
  assert.match(pyproject, new RegExp(`^version = "${pythonVersion}"$`, "m"));
  assert.match(initSource, new RegExp(`^__version__ = "${pythonVersion}"$`, "m"));
  assert.match(serviceSource, new RegExp(`"version": "${pythonVersion}"`));
  assert.match(manifest.version, /^\d+\.\d+\.\d+-rc\.\d+$/);
});
