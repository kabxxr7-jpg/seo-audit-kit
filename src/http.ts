/**
 * Polite, read-only HTTP: one identified User-Agent, a minimum gap between requests, a timeout,
 * a body size cap, and manual redirect following so the whole chain is recorded.
 */

export const TOOL_NAME = "seo-audit-kit";
export const TOOL_VERSION = "0.1";

export function defaultUserAgent(contact?: string): string {
  return `${TOOL_NAME}/${TOOL_VERSION} (read-only site audit${contact ? `; ${contact}` : ""})`;
}

export interface HopResult {
  url: string;
  /** 0 when the request failed before any response (see `error`). */
  status: number;
  headers: Record<string, string>;
  location: string | null;
  contentType: string | null;
  body: string | null;
  bytes: number;
  truncated: boolean;
  timeMs: number;
  error?: string;
}

export interface Hop {
  url: string;
  status: number;
  location: string;
}

/** Spaces requests at least `minDelayMs` apart. The clock and sleep are injectable for tests. */
export class Throttle {
  private last: number | null = null;
  constructor(
    public minDelayMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async wait(): Promise<void> {
    if (this.last !== null && this.minDelayMs > 0) {
      const wait = this.last + this.minDelayMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.last = this.now();
  }
}

export interface FetcherOptions {
  userAgent: string;
  delayMs: number;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json)|application\/[a-z.+-]*\+xml)/i;

export class Fetcher {
  readonly throttle: Throttle;
  readonly userAgent: string;
  requestCount = 0;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, Promise<HopResult>>();

  constructor(opts: FetcherOptions) {
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxBytes = opts.maxBytes ?? 2_000_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.throttle = new Throttle(opts.delayMs, opts.now, opts.sleep);
  }

  /** One GET with no redirect following. Cached per URL, so the same URL is never requested twice. */
  fetchHop(url: string): Promise<HopResult> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.doFetch(url);
      this.cache.set(url, p);
    }
    return p;
  }

  private async doFetch(url: string): Promise<HopResult> {
    await this.throttle.wait();
    this.requestCount++;
    const started = performance.now();
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": this.userAgent, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const contentType = headers["content-type"] ?? null;
      let body: string | null = null;
      let bytes = 0;
      let truncated = false;
      const isRedirect = res.status >= 300 && res.status < 400;
      if (!isRedirect && res.body && (contentType === null || TEXT_TYPES.test(contentType))) {
        const read = await readCapped(res.body, this.maxBytes);
        body = read.text;
        bytes = read.bytes;
        truncated = read.truncated;
      } else if (res.body) {
        await res.body.cancel().catch(() => undefined);
      }
      return {
        url,
        status: res.status,
        headers,
        location: headers["location"] ?? null,
        contentType,
        body,
        bytes,
        truncated,
        timeMs: Math.round(performance.now() - started),
      };
    } catch (e) {
      return {
        url,
        status: 0,
        headers: {},
        location: null,
        contentType: null,
        body: null,
        bytes: 0,
        truncated: false,
        timeMs: Math.round(performance.now() - started),
        error: e instanceof Error ? (e.name === "TimeoutError" ? `timeout after ${this.timeoutMs} ms` : e.message) : String(e),
      };
    }
  }
}

async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    chunks.push(value);
    if (bytes > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  let buf = Buffer.concat(chunks);
  if (buf.length > maxBytes) buf = buf.subarray(0, maxBytes);
  return { text: new TextDecoder("utf-8").decode(buf), bytes: Math.min(bytes, maxBytes), truncated };
}

export type ChainOutcome = "ok" | "too-many-redirects" | "redirect-loop" | "external-redirect" | "blocked-by-robots" | "bad-redirect" | "error";

export interface ChainResult {
  requestedUrl: string;
  finalUrl: string;
  /** Redirect responses only, in order. Empty when the first response was not a redirect. */
  hops: Hop[];
  /** Status of the first response, i.e. what a link-follower sees. */
  firstStatus: number;
  /** The last response received (the target of the redirects, or the first response if none). */
  final: HopResult | null;
  outcome: ChainOutcome;
  /** Sum of the response times of every request in the chain. */
  totalTimeMs: number;
  /** When outcome is blocked-by-robots: the URL and rule that stopped the chain. */
  blocked?: { url: string; rule: string };
  error?: string;
}

export interface ChainOptions {
  maxRedirects: number;
  /** Called before every request; return a rule label to refuse the URL (robots.txt) or null to allow. */
  refuse: (url: string) => string | null;
  sameOrigin: (a: string) => boolean;
}

export async function followChain(fetcher: Fetcher, startUrl: string, opts: ChainOptions): Promise<ChainResult> {
  const hops: Hop[] = [];
  const seen = new Set<string>();
  let url = startUrl;
  let firstStatus = 0;
  let total = 0;
  const base = { requestedUrl: startUrl, hops } as const;

  for (let i = 0; ; i++) {
    const rule = opts.refuse(url);
    if (rule !== null) {
      return { ...base, finalUrl: url, firstStatus, final: null, outcome: "blocked-by-robots", totalTimeMs: total, blocked: { url, rule } };
    }
    seen.add(url);
    const res = await fetcher.fetchHop(url);
    total += res.timeMs;
    if (i === 0) firstStatus = res.status;
    if (res.error) {
      return { ...base, finalUrl: url, firstStatus, final: res, outcome: "error", totalTimeMs: total, error: res.error };
    }
    const isRedirect = res.status >= 300 && res.status < 400 && res.status !== 304;
    if (!isRedirect) return { ...base, finalUrl: url, firstStatus, final: res, outcome: "ok", totalTimeMs: total };

    const next = res.location ? safeResolve(res.location, url) : null;
    hops.push({ url, status: res.status, location: next ?? res.location ?? "" });
    if (next === null) {
      return { ...base, finalUrl: url, firstStatus, final: res, outcome: "bad-redirect", totalTimeMs: total, error: "redirect without a usable Location header" };
    }
    if (seen.has(next)) {
      return { ...base, finalUrl: next, firstStatus, final: res, outcome: "redirect-loop", totalTimeMs: total };
    }
    if (hops.length > opts.maxRedirects) {
      return { ...base, finalUrl: next, firstStatus, final: res, outcome: "too-many-redirects", totalTimeMs: total };
    }
    if (!opts.sameOrigin(next)) {
      return { ...base, finalUrl: next, firstStatus, final: res, outcome: "external-redirect", totalTimeMs: total };
    }
    url = next;
  }
}

function safeResolve(location: string, base: string): string | null {
  try {
    const u = new URL(location, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
