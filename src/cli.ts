import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runAudit, type AuditOptions } from "./audit.js";
import { HARD_MAX_PAGES } from "./crawler.js";
import { defaultUserAgent } from "./http.js";
import { createChromeRenderer, type Renderer } from "./render.js";
import { renderJson, renderMarkdown } from "./report.js";

export const USAGE = `Usage: npm run audit -- <url> [options]

Read-only technical SEO audit of one site (same origin only, robots.txt obeyed).

Options:
  --max-pages N     Pages to fetch at most (default 50, hard limit ${HARD_MAX_PAGES})
  --max-depth N     Link depth from the start URL (default 5)
  --delay-ms N      Minimum pause between requests (default 500; a robots.txt Crawl-delay can only raise it)
  --out FILE        Write the markdown report here (otherwise it is printed). A .json name writes JSON.
  --json FILE       Also write the JSON report here
  --key-path PATH   Extra path for the bot-access table (repeatable)
  --contact TEXT    Added to the User-Agent, for example a URL or email site owners can reach
  --min-words N     Thin-content threshold (default 120)
  --render          Also render the few thinnest pages in Google Chrome (needs playwright-core and Chrome)
  --fail-on LEVEL   Exit 1 if any issue of this priority or higher exists (high, medium or low)
  -h, --help        Show this help

Exit codes: 0 done, 1 --fail-on tripped, 2 bad usage or refused by robots.txt, 3 unexpected error.`;

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) };

function intArg(name: string, v: string | undefined, min: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min} (got "${v}")`);
  return n;
}

class UsageError extends Error {}

export async function main(argv: string[], io: Io = defaultIo, deps: { createRenderer?: typeof createChromeRenderer } = {}): Promise<number> {
  let renderer: Renderer | null = null;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "max-pages": { type: "string" },
        "max-depth": { type: "string" },
        "delay-ms": { type: "string" },
        out: { type: "string" },
        json: { type: "string" },
        "key-path": { type: "string", multiple: true },
        contact: { type: "string" },
        "min-words": { type: "string" },
        render: { type: "boolean" },
        "fail-on": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      io.out(USAGE + "\n");
      return 0;
    }
    if (positionals.length !== 1) throw new UsageError("Give exactly one URL to audit.");
    const url = positionals[0] as string;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      throw new UsageError(`"${url}" is not an http(s) URL.`);
    }
    const failOn = values["fail-on"];
    if (failOn !== undefined && !["high", "medium", "low"].includes(failOn)) throw new UsageError("--fail-on must be high, medium or low.");

    const maxPages = intArg("--max-pages", values["max-pages"], 1);
    const maxDepth = intArg("--max-depth", values["max-depth"], 0);
    const delayMs = intArg("--delay-ms", values["delay-ms"], 0);
    const minWords = intArg("--min-words", values["min-words"], 1);
    if (maxPages !== undefined && maxPages > HARD_MAX_PAGES) {
      io.err(`--max-pages ${maxPages} is above the hard limit; using ${HARD_MAX_PAGES}.\n`);
    }

    const userAgent = defaultUserAgent(values.contact);
    const opts: AuditOptions = {
      startUrl: url,
      userAgent,
      ...(maxPages !== undefined ? { maxPages } : {}),
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
      ...(minWords !== undefined ? { thresholds: { minWords } } : {}),
      ...(values["key-path"] ? { keyPaths: values["key-path"] } : {}),
    };
    if (values.render) {
      renderer = await (deps.createRenderer ?? createChromeRenderer)(userAgent);
      opts.render = { fn: renderer.render };
    }

    io.err(`Auditing ${url} (up to ${Math.min(maxPages ?? 50, HARD_MAX_PAGES)} pages, read-only)...\n`);
    const result = await runAudit(opts);

    const md = renderMarkdown(result);
    const json = renderJson(result);
    const out = values.out;
    const writes: string[] = [];
    const write = async (file: string, text: string): Promise<void> => {
      const p = resolve(file);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, text, "utf8");
      writes.push(p);
    };
    if (out) await write(out, out.toLowerCase().endsWith(".json") ? json : md);
    if (values.json) await write(values.json, json);
    if (!out) io.out(md);
    const c = result.counts;
    io.err(`Done: ${result.crawl.pagesFetched} pages, ${c.high} high / ${c.medium} medium / ${c.low} low issue kinds.${writes.length ? ` Wrote ${writes.join(", ")}.` : ""}\n`);

    if (result.crawl.refused) {
      io.err(`${result.crawl.refused.detail}\n`);
      return 2;
    }
    if (failOn) {
      const levels = failOn === "high" ? c.high : failOn === "medium" ? c.high + c.medium : c.high + c.medium + c.low;
      if (levels > 0) return 1;
    }
    return 0;
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code?: unknown }).code) : "";
    if (e instanceof UsageError || code.startsWith("ERR_PARSE_ARGS")) {
      io.err(`${(e as Error).message}\n\n${USAGE}\n`);
      return 2;
    }
    io.err(`Unexpected error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 3;
  } finally {
    if (renderer) await renderer.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
