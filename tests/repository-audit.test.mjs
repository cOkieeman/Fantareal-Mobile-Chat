import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
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
