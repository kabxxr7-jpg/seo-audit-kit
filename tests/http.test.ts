import { describe, expect, it } from "vitest";
import { Fetcher, Throttle, defaultUserAgent, followChain } from "../src/http.js";
import { sameOrigin } from "../src/urls.js";
import { html, withServer } from "./helpers.js";

describe("Throttle", () => {
  it("does not wait before the first request, then spaces requests by the minimum delay", async () => {
    let t = 1000;
    const slept: number[] = [];
    const th = new Throttle(500, () => t, async (ms) => { slept.push(ms); t += ms; });
    await th.wait();
    t += 100; // 100 ms of work
    await th.wait();
    t += 700; // longer than the delay: no wait needed
    await th.wait();
    expect(slept).toEqual([400]);
  });
  it("never sleeps with a zero delay", async () => {
    const slept: number[] = [];
    const th = new Throttle(0, () => 0, async (ms) => { slept.push(ms); });
    await th.wait();
    await th.wait();
    expect(slept).toEqual([]);
  });
  it("picks up a delay raised after construction (Crawl-delay)", async () => {
    let t = 0;
    const slept: number[] = [];
    const th = new Throttle(0, () => t, async (ms) => { slept.push(ms); t += ms; });
    await th.wait();
    th.minDelayMs = 2000;
    await th.wait();
    expect(slept).toEqual([2000]);
  });
});

describe("defaultUserAgent", () => {
  it("names the tool and is not a browser string", () => {
    expect(defaultUserAgent()).toMatch(/^seo-audit-kit\/\d/);
    expect(defaultUserAgent("mailto:me@example.test")).toContain("mailto:me@example.test");
    expect(defaultUserAgent()).not.toMatch(/Mozilla/i);
  });
});

describe("Fetcher", () => {
  it("sends the User-Agent, records status, headers, content type and timing", async () => {
    await withServer({ "/p": html("<p>hi</p>", { headers: { "x-test": "1" } }) }, async (f) => {
      const fe = new Fetcher({ userAgent: "my-agent/9", delayMs: 0 });
      const r = await fe.fetchHop(`${f.origin}/p`);
      expect(r.status).toBe(200);
      expect(r.headers["x-test"]).toBe("1");
      expect(r.contentType).toContain("text/html");
      expect(r.body).toBe("<p>hi</p>");
      expect(r.timeMs).toBeGreaterThanOrEqual(0);
      expect(f.requests[0]?.userAgent).toBe("my-agent/9");
    });
  });

  it("requests each URL once", async () => {
    await withServer({ "/p": html("x") }, async (f) => {
      const fe = new Fetcher({ userAgent: "t", delayMs: 0 });
      await Promise.all([fe.fetchHop(`${f.origin}/p`), fe.fetchHop(`${f.origin}/p`)]);
      await fe.fetchHop(`${f.origin}/p`);
      expect(f.requests).toHaveLength(1);
      expect(fe.requestCount).toBe(1);
    });
  });

  it("does not follow redirects by itself", async () => {
    await withServer({ "/a": { status: 301, headers: { location: "/b" } }, "/b": html("b") }, async (f) => {
      const r = await new Fetcher({ userAgent: "t", delayMs: 0 }).fetchHop(`${f.origin}/a`);
      expect(r.status).toBe(301);
      expect(r.location).toBe("/b");
      expect(r.body).toBeNull();
      expect(f.requests.map((x) => x.path)).toEqual(["/a"]);
    });
  });

  it("caps the body it reads and says so", async () => {
    await withServer({ "/big": html("x".repeat(50_000)) }, async (f) => {
      const r = await new Fetcher({ userAgent: "t", delayMs: 0, maxBytes: 1000 }).fetchHop(`${f.origin}/big`);
      expect(r.truncated).toBe(true);
      expect((r.body ?? "").length).toBeLessThan(50_000);
    });
  });

  it("does not download non-text bodies", async () => {
    await withServer({ "/img": { type: "image/png", body: "binary" } }, async (f) => {
      const r = await new Fetcher({ userAgent: "t", delayMs: 0 }).fetchHop(`${f.origin}/img`);
      expect(r.status).toBe(200);
      expect(r.body).toBeNull();
    });
  });

  it("turns a timeout into an error result instead of throwing", async () => {
    await withServer({ "/slow": html("late", { delayMs: 400 }) }, async (f) => {
      const r = await new Fetcher({ userAgent: "t", delayMs: 0, timeoutMs: 50 }).fetchHop(`${f.origin}/slow`);
      expect(r.status).toBe(0);
      expect(r.error).toMatch(/timeout/);
    });
  });

  it("turns a refused connection into an error result", async () => {
    const r = await new Fetcher({ userAgent: "t", delayMs: 0 }).fetchHop("http://127.0.0.1:1/");
    expect(r.status).toBe(0);
    expect(r.error).toBeTruthy();
  });
});

describe("followChain", () => {
  const chainOpts = (origin: string, max = 5) => ({ maxRedirects: max, refuse: () => null, sameOrigin: (u: string) => sameOrigin(u, origin) });

  it("records every hop and ends at the final response", async () => {
    await withServer(
      { "/a": { status: 302, headers: { location: "/b" } }, "/b": { status: 301, headers: { location: "{{ORIGIN}}/c" } }, "/c": html("done") },
      async (f) => {
        const fe = new Fetcher({ userAgent: "t", delayMs: 0 });
        const r = await followChain(fe, `${f.origin}/a`, chainOpts(f.origin));
        expect(r.outcome).toBe("ok");
        expect(r.hops.map((h) => [h.url.replace(f.origin, ""), h.status])).toEqual([["/a", 302], ["/b", 301]]);
        expect(r.finalUrl).toBe(`${f.origin}/c`);
        expect(r.firstStatus).toBe(302);
        expect(r.final?.status).toBe(200);
        expect(r.final?.body).toBe("done");
        expect(r.totalTimeMs).toBeGreaterThanOrEqual(0);
      },
    );
  });

  it("returns the first response untouched when there is no redirect", async () => {
    await withServer({ "/a": html("x") }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, chainOpts(f.origin));
      expect(r.hops).toEqual([]);
      expect(r.outcome).toBe("ok");
    });
  });

  it("stops at the chain limit", async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> }> = {};
    for (let i = 0; i < 10; i++) routes[`/r${i}`] = { status: 301, headers: { location: `/r${i + 1}` } };
    await withServer(routes, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/r0`, chainOpts(f.origin, 3));
      expect(r.outcome).toBe("too-many-redirects");
      expect(r.hops).toHaveLength(4);
      expect(f.requests).toHaveLength(4); // the fifth URL is never requested
    });
  });

  it("allows a chain of exactly the limit", async () => {
    await withServer({ "/a": { status: 301, headers: { location: "/b" } }, "/b": { status: 301, headers: { location: "/c" } }, "/c": html("ok") }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, chainOpts(f.origin, 2));
      expect(r.outcome).toBe("ok");
    });
  });

  it("detects a loop", async () => {
    await withServer({ "/a": { status: 302, headers: { location: "/b" } }, "/b": { status: 302, headers: { location: "/a" } } }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, chainOpts(f.origin));
      expect(r.outcome).toBe("redirect-loop");
      expect(f.requests).toHaveLength(2);
    });
  });

  it("does not follow a redirect to another origin", async () => {
    await withServer({ "/a": { status: 301, headers: { location: "https://elsewhere.example/x" } } }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, chainOpts(f.origin));
      expect(r.outcome).toBe("external-redirect");
      expect(r.finalUrl).toBe("https://elsewhere.example/x");
      expect(f.requests).toHaveLength(1);
    });
  });

  it("reports a redirect with no Location header", async () => {
    await withServer({ "/a": { status: 301 } }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, chainOpts(f.origin));
      expect(r.outcome).toBe("bad-redirect");
    });
  });

  it("asks before every request and stops at a refused hop", async () => {
    await withServer({ "/a": { status: 301, headers: { location: "/private/b" } }, "/private/b": html("secret") }, async (f) => {
      const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), `${f.origin}/a`, {
        ...chainOpts(f.origin),
        refuse: (u) => (u.includes("/private/") ? "Disallow: /private/" : null),
      });
      expect(r.outcome).toBe("blocked-by-robots");
      expect(r.blocked?.rule).toBe("Disallow: /private/");
      expect(f.requests.map((x) => x.path)).toEqual(["/a"]);
    });
  });

  it("reports a network error", async () => {
    const r = await followChain(new Fetcher({ userAgent: "t", delayMs: 0 }), "http://127.0.0.1:1/", chainOpts("http://127.0.0.1:1"));
    expect(r.outcome).toBe("error");
    expect(r.error).toBeTruthy();
  });
});
