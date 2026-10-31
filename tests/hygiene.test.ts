import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".mutation-work", "out", "coverage", "dist"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const all = files(root).filter((f) => !f.endsWith("package-lock.json") && !f.endsWith("hygiene.test.ts"));

describe("repository hygiene", () => {
  it("scans a meaningful set of files", () => {
    expect(all.length).toBeGreaterThan(25);
  });

  it("never names the assistant or its maker (bot names such as ClaudeBot are the only allowed use)", () => {
    const bad: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, "utf8").replace(/ClaudeBot/g, "");
      if (/claude|anthropic|ai[- ]assistant|built with ai|generated with|co-authored-by/i.test(text)) bad.push(relative(root, f));
    }
    expect(bad).toEqual([]);
  });

  it("contains no .env files or key-like strings", () => {
    expect(all.filter((f) => /(^|\/)\.env/.test(f))).toEqual([]);
    const bad = all.filter((f) => /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(readFileSync(f, "utf8")));
    expect(bad.map((f) => relative(root, f))).toEqual([]);
  });

  it("has no Co-Authored-By trailers or assistant names in commit messages", () => {
    if (!existsSync(join(root, ".git"))) return;
    const log = execFileSync("git", ["log", "--format=%an <%ae>%n%B"], { cwd: root, encoding: "utf8" });
    expect(log).not.toMatch(/co-authored-by|claude|anthropic|generated with/i);
    expect(log).toContain("KABIIR <239266405+kabxxr7-jpg@users.noreply.github.com>");
  });
});
