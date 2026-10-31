import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { brokenSite } from "../fixtures/broken-site.js";
import { goodSite } from "../fixtures/good-site.js";
import { startFixture, type RunningFixture } from "../fixtures/server.js";
import { html, simplePage, withServer } from "./helpers.js";

let good: RunningFixture;
let broken: RunningFixture;
let dir: string;

beforeAll(async () => {
  good = await startFixture(goodSite);
  broken = await startFixture(brokenSite);
  dir = await mkdtemp(join(tmpdir(), "seo-audit-kit-cli-"));
});
afterAll(async () => {
  await good.close();
  await broken.close();
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[], deps?: Parameters<typeof main>[2]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  return main(args, { out: (s) => (out += s), err: (s) => (err += s) }, deps).then((code) => ({ code, out, err }));
}

describe("usage", () => {
  it("prints help and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--max-pages");
    expect(r.out).toContain("--out");
  });
  it("needs exactly one URL", async () => {
    expect((await run([])).code).toBe(2);
    const two = await run(["http://a.test", "http://b.test"]);
    expect(two.code).toBe(2);
    expect(two.err).toContain("exactly one URL");
  });
  it("rejects a non-http URL", async () => {
    const r = await run(["ftp://example.test"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not an http(s) URL");
  });
  it("rejects bad numbers and unknown options", async () => {
    expect((await run(["http://127.0.0.1:1", "--max-pages", "abc"])).code).toBe(2);
    expect((await run(["http://127.0.0.1:1", "--max-pages", "0"])).code).toBe(2);
    expect((await run(["http://127.0.0.1:1", "--delay-ms", "-5"])).code).toBe(2);
    expect((await run(["http://127.0.0.1:1", "--bogus"])).code).toBe(2);
    expect((await run(["http://127.0.0.1:1", "--fail-on", "urgent"])).code).toBe(2);
  });
});

describe("running an audit", () => {
  it("prints the markdown report when --out is not given", async () => {
    const r = await run([good.origin + "/", "--delay-ms", "0"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`# SEO audit: ${good.origin}/`);
    expect(r.out).toContain("## What was not checked");
    expect(r.err).toContain("Done: 13 pages");
  });

  it("writes markdown to --out and JSON to --json, creating folders", async () => {
    const md = join(dir, "nested", "report.md");
    const js = join(dir, "nested", "report.json");
    const r = await run([broken.origin + "/", "--delay-ms", "0", "--max-pages", "100", "--out", md, "--json", js]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(""); // report went to the file
    const text = await readFile(md, "utf8");
    expect(text).toContain("### High priority");
    const parsed = JSON.parse(await readFile(js, "utf8")) as { counts: { high: number }; issues: { id: string }[] };
    expect(parsed.counts.high).toBeGreaterThan(0);
    expect(parsed.issues.map((i) => i.id)).toContain("noindex-key-page");
  });

  it("writes JSON when --out ends in .json", async () => {
    const js = join(dir, "only.json");
    await run([good.origin + "/", "--delay-ms", "0", "--out", js]);
    expect(JSON.parse(await readFile(js, "utf8"))).toHaveProperty("issues");
  });

  it("respects --max-pages", async () => {
    const js = join(dir, "cap.json");
    await run([broken.origin + "/", "--delay-ms", "0", "--max-pages", "4", "--out", js]);
    const parsed = JSON.parse(await readFile(js, "utf8")) as { crawl: { pagesFetched: number; capReached: boolean } };
    expect(parsed.crawl.pagesFetched).toBe(4);
    expect(parsed.crawl.capReached).toBe(true);
  });

  it("tells you when --max-pages is above the hard limit", async () => {
    const r = await run([good.origin + "/", "--delay-ms", "0", "--max-pages", "9999", "--out", join(dir, "big.md")]);
    expect(r.err).toContain("above the hard limit; using 500");
  });

  it("adds --contact to the User-Agent and sends --key-path to the bot table", async () => {
    const js = join(dir, "contact.json");
    await run([good.origin + "/", "--delay-ms", "0", "--contact", "https://example.test/about-this-crawler", "--key-path", "/checkout", "--out", js]);
    const parsed = JSON.parse(await readFile(js, "utf8")) as { settings: { userAgent: string }; bots: { paths: string[] } };
    expect(parsed.settings.userAgent).toContain("https://example.test/about-this-crawler");
    expect(parsed.bots.paths).toContain("/checkout");
    expect(good.requests.at(-1)?.userAgent).toContain("about-this-crawler");
  });

  it("--min-words changes the thin-content threshold", async () => {
    const js = join(dir, "minwords.json");
    await run([good.origin + "/", "--delay-ms", "0", "--min-words", "100000", "--out", js]);
    const parsed = JSON.parse(await readFile(js, "utf8")) as { issues: { id: string }[] };
    expect(parsed.issues.map((i) => i.id)).toContain("thin-content");
  });
});

describe("exit codes", () => {
  it("--fail-on high exits 1 for the broken site and 0 for the good one", async () => {
    expect((await run([broken.origin + "/", "--delay-ms", "0", "--fail-on", "high", "--out", join(dir, "a.md")])).code).toBe(1);
    expect((await run([good.origin + "/", "--delay-ms", "0", "--fail-on", "low", "--out", join(dir, "b.md")])).code).toBe(0);
  });
  it("--fail-on medium ignores low-only findings", async () => {
    await withServer({ "/": html(simplePage({ title: "A page with only low issues", head: '<meta name="description" content="' + "Good description text. ".repeat(5) + '"><link rel="canonical" href="{{ORIGIN}}/">', body: `<h1>H</h1><p>${"word ".repeat(200)}</p>` })), "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow:\nSitemap: {{ORIGIN}}/s.xml\n" }, "/s.xml": { type: "application/xml", body: "<urlset><url><loc>{{ORIGIN}}/</loc></url></urlset>" } }, async (f) => {
      const r = await run([f.origin + "/", "--delay-ms", "0", "--fail-on", "medium", "--out", join(dir, "c.json")]);
      const parsed = JSON.parse(await readFile(join(dir, "c.json"), "utf8")) as { counts: { high: number; medium: number; low: number } };
      expect(parsed.counts.high + parsed.counts.medium).toBe(0);
      expect(parsed.counts.low).toBeGreaterThan(0); // og/twitter tags are missing
      expect(r.code).toBe(0);
    });
  });
  it("exits 2 when robots.txt forbids the start page", async () => {
    await withServer({ "/robots.txt": { type: "text/plain", body: "User-agent: seo-audit-kit\nDisallow: /\n" }, "/": html(simplePage()) }, async (f) => {
      const r = await run([f.origin + "/", "--delay-ms", "0", "--out", join(dir, "d.md")]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("Disallow: /");
      expect(f.requests.map((x) => x.path)).toEqual(["/robots.txt"]);
    });
  });
});

describe("--render", () => {
  it("uses the renderer it is given and closes it", async () => {
    let closed = false;
    const calls: string[] = [];
    const r = await run([broken.origin + "/app", "--delay-ms", "0", "--render", "--out", join(dir, "render.json")], {
      createRenderer: async () => ({ render: async (u) => (calls.push(u), "<main><p>rendered words</p></main>"), close: async () => void (closed = true) }),
    });
    expect(r.code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(closed).toBe(true);
    const parsed = JSON.parse(await readFile(join(dir, "render.json"), "utf8")) as { settings: { renderEnabled: boolean } };
    expect(parsed.settings.renderEnabled).toBe(true);
  });
  it("exits 3 with a clear message when the browser cannot start", async () => {
    const r = await run([good.origin + "/", "--render"], { createRenderer: async () => { throw new Error("Could not start Google Chrome"); } });
    expect(r.code).toBe(3);
    expect(r.err).toContain("Could not start Google Chrome");
  });
});

describe("as a real process (npm run audit)", () => {
  it("runs through tsx, prints a report, and exits 0", async () => {
    // Must be async: the fixture server lives in this process, so the event loop cannot be blocked.
    const p = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = execFile("npx", ["tsx", "src/cli.ts", good.origin + "/", "--delay-ms", "0", "--max-pages", "3"], { cwd: join(import.meta.dirname, "..") }, (_e, stdout, stderr) =>
        resolve({ code: child.exitCode, stdout, stderr }),
      );
    });
    expect(p.code).toBe(0);
    expect(p.stdout).toContain("# SEO audit:");
    expect(p.stderr).toContain("Auditing");
  }, 30_000);
});
