import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { createChromeRenderer } from "../src/render.js";
import { startFixture } from "../fixtures/server.js";
import { html, simplePage, withServer, words } from "./helpers.js";

const spa = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Client rendered app page</title></head><body><div id="root"></div><noscript>Enable JavaScript</noscript><script>document.getElementById("root").innerHTML = "<main><h1>App</h1><p>" + "rendered text here ".repeat(60) + "</p></main>";</script></body></html>`;
const hybrid = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Server shell with late content</title></head><body><main><h1>Shell</h1><p>${words(60)}</p><div id="more"></div></main><script>document.getElementById("more").innerHTML = "<p>" + "late words appear here ".repeat(100) + "</p>";</script></body></html>`;

describe("raw versus rendered comparison (render function injected)", () => {
  const rendered = (n: number) => `<html><body><main><p>${words(n, "r")}</p></main></body></html>`;

  it("adds the rendered word count to a client-rendered finding", async () => {
    await withServer({ "/": html(spa) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { fn: async () => rendered(180) } });
      const issue = r.issues.find((i) => i.id === "client-rendered-body");
      expect(issue?.examples[0]?.detail).toContain("After JavaScript: 180 words");
      expect(r.rawHtml.rendered).toEqual([{ url: f.origin + "/", rawWords: 0, renderedWords: 180 }]);
      expect(r.settings.renderEnabled).toBe(true);
    });
  });

  it("flags a page whose text mostly appears only after JavaScript", async () => {
    await withServer({ "/": html(hybrid) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { fn: async () => rendered(400) } });
      const d = r.issues.find((i) => i.id === "content-requires-javascript")?.examples[0]?.detail ?? "";
      expect(d).toMatch(/^\d+ words in the raw HTML, 400 after JavaScript$/);
    });
  });

  it("does not flag a page whose rendered text is about the same as the raw text", async () => {
    await withServer({ "/": html(simplePage({ title: "A steady server rendered page", body: `<h1>H</h1><p>${words(200)}</p>` })) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { fn: async () => rendered(230) } });
      expect(r.issues.map((i) => i.id)).not.toContain("content-requires-javascript");
    });
  });

  it("renders only the thinnest pages, up to the limit", async () => {
    const pages: Record<string, ReturnType<typeof html>> = { "/": html(simplePage({ title: "Home of the limit test", body: `<h1>H</h1><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><p>${words(100)}</p>` })) };
    pages["/a"] = html(simplePage({ title: "Page A is long", body: `<h1>H</h1><p>${words(300)}</p>` }));
    pages["/b"] = html(simplePage({ title: "Page B is short", body: `<h1>H</h1><p>${words(40)}</p>` }));
    pages["/c"] = html(simplePage({ title: "Page C is medium", body: `<h1>H</h1><p>${words(200)}</p>` }));
    await withServer(pages, async (f) => {
      const seen: string[] = [];
      await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { limit: 2, fn: async (u) => (seen.push(u.replace(f.origin, "")), "<p>x</p>") } });
      expect(seen).toEqual(["/b", "/"]);
      const all: string[] = [];
      await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { limit: 1000, fn: async (u) => (all.push(u), "<p>x</p>") } });
      expect(all.length).toBeLessThanOrEqual(20);
    });
  });

  it("survives a render failure and says which page failed", async () => {
    await withServer({ "/": html(spa) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { fn: async () => { throw new Error("browser crashed"); } } });
      expect(r.rawHtml.renderErrors[0]).toContain("browser crashed");
      expect(r.notChecked.join("\n")).toContain("Rendering failed for 1 page");
      expect(r.issues.map((i) => i.id)).toContain("client-rendered-body");
    });
  });

  it("without a renderer nothing is rendered and the report says JavaScript was not run", async () => {
    await withServer({ "/": html(spa) }, async (f) => {
      const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0 });
      expect(r.rawHtml.rendered).toEqual([]);
      expect(r.settings.renderEnabled).toBe(false);
      expect(r.notChecked.join("\n")).toContain("JavaScript was not run");
      expect(r.issues.find((i) => i.id === "client-rendered-body")?.examples[0]?.detail).not.toContain("After JavaScript");
    });
  });
});

const hasChrome = existsSync("/Applications/Google Chrome.app") || existsSync("/usr/bin/google-chrome");

describe.skipIf(!hasChrome)("real Chrome renderer (skipped when Chrome is not installed)", () => {
  it("runs the page's JavaScript and keeps requests on the same origin", async () => {
    const other = await startFixture({ name: "third-party", routes: { "/pixel.png": { type: "image/png", body: "x" } } });
    const page = spa.replace("<noscript>", `<img src="${other.origin}/pixel.png" alt=""><noscript>`);
    try {
      await withServer({ "/": html(page) }, async (f) => {
        const renderer = await createChromeRenderer("seo-audit-kit/0.1 (test)");
        try {
          const out = await renderer.render(f.origin + "/");
          expect(out).toContain("rendered text here");
          expect(other.requests).toEqual([]);
          expect(f.requests.every((r) => r.userAgent === "seo-audit-kit/0.1 (test)")).toBe(true);
        } finally {
          await renderer.close();
        }
      });
    } finally {
      await other.close();
    }
  }, 60_000);

  it("finds the text of a client-rendered page that the raw HTML lacks, end to end", async () => {
    await withServer({ "/": html(spa) }, async (f) => {
      const renderer = await createChromeRenderer("seo-audit-kit/0.1 (test)");
      try {
        const r = await runAudit({ startUrl: f.origin + "/", delayMs: 0, render: { fn: renderer.render } });
        const row = r.rawHtml.rendered[0];
        expect(row?.rawWords).toBe(0);
        expect(row?.renderedWords).toBeGreaterThan(150);
        expect(r.issues.find((i) => i.id === "client-rendered-body")?.examples[0]?.detail).toContain("After JavaScript:");
      } finally {
        await renderer.close();
      }
    });
  }, 60_000);
});
