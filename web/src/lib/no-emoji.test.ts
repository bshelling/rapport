import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Icons come from lucide-react; emojis and symbol glyphs render differently on
// every platform, so the UI never uses them.
const PICTOGRAPH =
  /\p{Extended_Pictographic}|[\u2190-\u21FF\u2713\u2714]|\uFE0F/u;
const ALLOWED = new Set(["©", "®", "™"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") ? [path] : [];
  });
}

test("the UI source has no emojis or symbol glyphs", () => {
  const found: string[] = [];
  for (const file of sourceFiles(join(import.meta.dir, ".."))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const ch of line) {
          if (PICTOGRAPH.test(ch) && !ALLOWED.has(ch))
            found.push(`${file}:${i + 1} ${ch}`);
        }
      });
  }
  expect(found).toEqual([]);
});
