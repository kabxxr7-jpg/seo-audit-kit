#!/usr/bin/env node
// Mutation check: break the code on purpose, one way at a time, and see whether the tests notice.
//
// For each mutant this copies the project into .mutation-work/ (inside this folder, git-ignored),
// applies one textual change to a file in src/, runs the full vitest suite there (stopping at the
// first failure) and records whether it failed ("killed") or passed ("survived").
// The working tree you are editing is never modified.
//
// Usage: node scripts/mutation-check.mjs [--only <id>] [--list]
// Exit code: 0 if every mutant was killed, 1 if any survived, 2 if the script itself is stale.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, ".mutation-work");

/** `find` must occur exactly once in `file`; `replace` is what it becomes. */
const MUTANTS = [
  { id: "robots-ignore-disallow", file: "src/robots.ts", why: "a Disallow rule no longer blocks anything",
    find: 'return { allowed: best.rule.type === "allow", rule: label };', replace: "return { allowed: true, rule: label };" },
  { id: "robots-shortest-match", file: "src/robots.ts", why: "the shortest matching rule wins instead of the longest",
    find: "if (!best || len > best.len ||", replace: "if (!best || len < best.len ||" },
  { id: "robots-ignore-own-group", file: "src/robots.ts", why: "a bot's own group is ignored in favour of *",
    find: 'const chosen = specific.length > 0 ? specific : robots.groups.filter((g) => g.agents.includes("*"));', replace: 'const chosen = robots.groups.filter((g) => g.agents.includes("*"));' },
  { id: "crawler-leaves-origin", file: "src/crawler.ts", why: "links to other origins are followed",
    find: "if (!target || !sameOrigin(target, origin)) continue;", replace: "if (!target) continue;" },
  { id: "crawler-page-cap-off-by-one", file: "src/crawler.ts", why: "one page more than the cap is fetched",
    find: "if (result.pages.length >= maxPages) {", replace: "if (result.pages.length >= maxPages + 1) {" },
  { id: "crawler-hard-cap-removed", file: "src/crawler.ts", why: "--max-pages can exceed the hard limit",
    find: "Math.min(opts.maxPages ?? 50, HARD_MAX_PAGES)", replace: "(opts.maxPages ?? 50)" },
  { id: "crawler-ignores-crawl-delay", file: "src/crawler.ts", why: "robots.txt Crawl-delay is ignored",
    find: "fetcher.throttle.minDelayMs = Math.max(delayMs, Math.round(myRules.crawlDelay * 1000));", replace: "fetcher.throttle.minDelayMs = delayMs;" },
  { id: "crawler-depth-cap-removed", file: "src/crawler.ts", why: "link depth is not limited",
    find: "if (item.depth + 1 > maxDepth) {", replace: "if (item.depth + 1 > maxDepth + 1000) {" },
  { id: "crawler-robots-check-removed", file: "src/crawler.ts", why: "robots.txt is never consulted for page URLs",
    find: 'return v.allowed ? null : (v.rule ?? "Disallow");', replace: "return null;" },
  { id: "crawler-ignores-blocked-start", file: "src/crawler.ts", why: "a disallowed start URL is crawled anyway",
    find: "if (startRule !== null) {", replace: "if (startRule !== null && false) {" },
  { id: "http-redirect-limit-removed", file: "src/http.ts", why: "redirect chains are followed without a limit",
    find: "if (hops.length > opts.maxRedirects) {", replace: "if (hops.length > opts.maxRedirects + 1000) {" },
  { id: "http-no-rate-limit", file: "src/http.ts", why: "requests are no longer spaced out",
    find: "if (wait > 0) await this.sleep(wait);", replace: "if (wait > 0) await this.sleep(0);" },
  { id: "http-no-user-agent", file: "src/http.ts", why: "requests do not identify the tool",
    find: 'headers: { "user-agent": this.userAgent,', replace: 'headers: { "x-ua": this.userAgent,' },
  { id: "check-title-length-limit", file: "src/checks.ts", why: "long titles are never flagged",
    find: "title.length > th.titleMax", replace: "title.length > th.titleMax + 1000" },
  { id: "check-title-short-boundary", file: "src/checks.ts", why: "title minimum off by one",
    find: "title.length < th.titleMin", replace: "title.length <= th.titleMin" },
  { id: "check-multiple-h1", file: "src/checks.ts", why: "two h1 elements are tolerated",
    find: "else if (nonEmpty.length > 1)", replace: "else if (nonEmpty.length > 2)" },
  { id: "check-canonical-to-redirect", file: "src/checks.ts", why: "a canonical pointing at a redirect is not reported",
    find: 'if (t.redirectChain.length > 0) add("canonical-to-redirect"', replace: 'if (t.redirectChain.length > 999) add("canonical-to-redirect"' },
  { id: "check-meta-noindex", file: "src/checks.ts", why: "meta robots noindex is not recognised",
    find: 'if (meta.includes("noindex") || meta.includes("none")) return true;', replace: 'if (meta.includes("none")) return true;' },
  { id: "check-hreflang-reciprocity", file: "src/checks.ts", why: "hreflang return links are judged the wrong way round",
    find: 'if (!back) add("hreflang-no-return"', replace: 'if (back) add("hreflang-no-return"' },
  { id: "check-orphan-inverted", file: "src/checks.ts", why: "linked pages are called orphans",
    find: 'if (rec.inlinks.length === 0) add("orphan-page"', replace: 'if (rec.inlinks.length > 0) add("orphan-page"' },
  { id: "check-thin-boundary", file: "src/checks.ts", why: "a page at exactly the word minimum is called thin",
    find: "page.wordCount < th.minWords", replace: "page.wordCount <= th.minWords" },
  { id: "check-client-rendered-signal", file: "src/checks.ts", why: "an empty app container no longer counts as client-rendered",
    find: "if (s.emptyAppRoot || s.noscriptNeedsJs) {", replace: "if (s.emptyAppRoot && s.noscriptNeedsJs && s.scriptCount > 99) {" },
  { id: "check-duplicate-hash-case", file: "src/checks.ts", why: "text hash becomes case-sensitive",
    find: "const norm = text.toLowerCase().replace(", replace: "const norm = text.replace(" },
  { id: "catalog-noindex-key-not-high", file: "src/catalog.ts", why: "noindex on a key page is demoted to low",
    find: '"noindex-key-page": { severity: "high"', replace: '"noindex-key-page": { severity: "low"' },
  { id: "jsonld-organization-name-optional", file: "src/jsonld.ts", why: "Organization no longer needs a name",
    find: 'Organization: { required: ["name"],', replace: "Organization: { required: []," },
  { id: "jsonld-error-line-offset", file: "src/jsonld.ts", why: "JSON-LD error line ignores where the block starts in the page",
    find: "line = s.line + nl.length - 1;", replace: "line = nl.length;" },
  { id: "sitemap-index-children-skipped", file: "src/sitemap.ts", why: "sitemap index files are not followed",
    find: "for (const child of file.children) {", replace: "for (const child of []) {" },
  { id: "check-heading-skip-tolerance", file: "src/checks.ts", why: "skipping two heading levels is tolerated",
    find: "cur.level > prev.level + 1", replace: "cur.level > prev.level + 2" },
  { id: "crawler-follows-nofollow", file: "src/crawler.ts", why: "rel=nofollow links are followed",
    find: 'if (nofollowPage || link.rel.includes("nofollow")) continue;', replace: "if (nofollowPage) continue;" },
  { id: "check-empty-alt-flagged", file: "src/checks.ts", why: "alt=\"\" (decorative image) is reported as missing",
    find: "page.images.filter((i) => i.alt === null)", replace: "page.images.filter((i) => !i.alt)" },
  { id: "check-og-image-not-required", file: "src/checks.ts", why: "og:image is no longer required",
    find: '["og:title", "og:description", "og:image"]', replace: '["og:title", "og:description"]' },
  { id: "check-307-not-temporary", file: "src/checks.ts", why: "307 redirects are not called temporary",
    find: "h.status === 302 || h.status === 307", replace: "h.status === 302" },
  { id: "check-client-rendered-also-thin", file: "src/checks.ts", why: "client-rendered pages are also reported as thin",
    find: "if (!page || clientRendered.has(rec.url)) continue;", replace: "if (!page) continue;" },
  { id: "check-cross-page-entity-conflict", file: "src/checks.ts", why: "same-@id entities that disagree across pages are not compared",
    find: "if (pages.size < 2) continue;", replace: "continue;" },
  { id: "check-passive-mixed-content-active", file: "src/checks.ts", why: "images over http are reported as active mixed content",
    find: 'else add("mixed-content-passive", rec.url, `${r.kind}: ${abs}`);', replace: 'else add("mixed-content-active", rec.url, `${r.kind}: ${abs}`);' },
  { id: "check-canonical-self-flagged", file: "src/checks.ts", why: "a self-referencing canonical is treated as pointing elsewhere",
    find: "if (target === rec.url) continue;", replace: "if (target === rec.url + '#') continue;" },
];

function runTests(cwd) {
  const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
  const started = Date.now();
  const outFile = join(cwd, "vitest-result.json");
  rmSync(outFile, { force: true });
  // No --bail: the JSON result lists every failing test, so the report names real failures only.
  const r = spawnSync(process.execPath, [vitest, "run", "--reporter=json", `--outputFile=${outFile}`], { cwd, encoding: "utf8", timeout: 240_000, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const timedOut = r.error?.code === "ETIMEDOUT";
  let json = null;
  try {
    json = JSON.parse(readFileSync(outFile, "utf8"));
  } catch {
    // no result file: handled below
  }
  if (!json) return { code: r.status ?? 1, timedOut, failures: [], suiteErrors: [], passed: null, seconds, tail: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").slice(-25).join("\n") };
  const failures = [];
  const suiteErrors = [];
  for (const f of json.testResults ?? []) {
    const file = String(f.name).replace(`${cwd}/`, "");
    const failed = (f.assertionResults ?? []).filter((a) => a.status === "failed");
    for (const a of failed) failures.push(`${file} > ${a.fullName}`);
    if (f.status === "failed" && failed.length === 0) suiteErrors.push(file);
  }
  return { code: r.status ?? 1, timedOut, failures, suiteErrors, passed: json.numPassedTests ?? null, seconds, tail: "" };
}

function prepare() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const p of ["src", "fixtures", "tests"]) cpSync(join(root, p), join(work, p), { recursive: true });
  for (const f of ["package.json", "tsconfig.json", "vitest.config.ts"]) cpSync(join(root, f), join(work, f));
  symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir");
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const m of MUTANTS) console.log(`${m.id.padEnd(34)} ${m.file.padEnd(16)} ${m.why}`);
  process.exit(0);
}
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const selected = only ? MUTANTS.filter((m) => m.id === only) : MUTANTS;
if (selected.length === 0) {
  console.error(`No mutant called "${only}". Use --list.`);
  process.exit(2);
}

// Every mutant must apply exactly once, or this script is out of date with the source.
for (const m of MUTANTS) {
  const text = readFileSync(join(root, m.file), "utf8");
  const n = text.split(m.find).length - 1;
  if (n !== 1) {
    console.error(`Mutant ${m.id}: expected the target text exactly once in ${m.file}, found ${n}. The script is stale.`);
    process.exit(2);
  }
}

prepare();
try {
  console.log("Baseline: running the unmodified suite in a scratch copy...");
  const base = runTests(work);
  if (base.code !== 0) {
    console.error(`Baseline failed, so mutation results would mean nothing.\n${base.tail}`);
    process.exit(2);
  }
  console.log(`Baseline passed (${base.passed} tests, ${base.seconds}s).\n`);

  const results = [];
  for (const m of selected) {
    const target = join(work, m.file);
    const original = readFileSync(join(root, m.file), "utf8");
    writeFileSync(target, original.replace(m.find, () => m.replace));
    const r = runTests(work);
    writeFileSync(target, original);
    const killed = r.code !== 0 || r.failures.length > 0 || r.suiteErrors.length > 0;
    const how = r.timedOut ? "timed out" : r.failures.length > 0 ? `${r.failures.length} test(s) failed, first: ${r.failures[0]}` : `suite failed to run: ${r.suiteErrors.join(", ") || "unknown"}`;
    results.push({ ...m, killed, failing: r.failures.length, crashed: r.failures.length === 0 && killed });
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${m.id.padEnd(34)} ${r.seconds.padStart(5)}s  ${killed ? how : m.why}`);
  }

  const killed = results.filter((r) => r.killed).length;
  console.log(`\nKilled ${killed} of ${results.length} mutants (${Math.round((killed / results.length) * 100)}%).`);
  const crashed = results.filter((r) => r.crashed);
  if (crashed.length > 0) console.log(`Note: ${crashed.length} mutant(s) were "killed" only because the suite crashed or timed out, not by a failing assertion: ${crashed.map((c) => c.id).join(", ")}.`);
  const survivors = results.filter((r) => !r.killed);
  if (survivors.length > 0) {
    console.log("Survivors (the tests did not notice these breakages):");
    for (const s of survivors) console.log(`  - ${s.id} in ${s.file}: ${s.why}`);
    process.exitCode = 1;
  }
} finally {
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
