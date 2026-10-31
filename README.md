# seo-audit-kit

> **Status:** a proof project (285 tests, run locally on Node v25.2.1 only, against two fictional fixture sites that this repo serves on localhost). Not used in production or by any client.

A small, tested technical SEO audit crawler for the jobs that say "audit my site", "fix my on-page SEO" or "make my site readable by search engines and AI crawlers". Point it at a site, get a prioritised list of what is wrong, why it matters and how to fix it, plus a plain list of what it did **not** check.

**Tested on local fixture sites only.** No search-engine tool was used or compared: Google Search Console, Google's Rich Results Test, the Schema Markup Validator, Lighthouse and PageSpeed Insights were never run, and this kit's findings were never compared with theirs. The structured-data rules are written from the public schema.org and Google documentation as understood by the author. The kit has never been pointed at a real third-party site, and it has not been used for any client.

## What it does

| Area | What it checks |
|---|---|
| **Crawl** | Starts from one URL, stays on the same origin, obeys `robots.txt` (Disallow, Allow, `*`, `$`, Crawl-delay), has a page cap (default 50, hard limit 500) and a link-depth cap, follows redirects up to a chain limit and records every hop, records status, response time and content type, finds `sitemap.xml` (and sitemap indexes, and sitemaps named in robots.txt) and compares sitemap URLs with what was crawled |
| **Titles and descriptions** | missing, duplicate, too long, too short (`title-*`, `meta-description-*`) |
| **Headings** | exactly one h1, skipped heading levels (`h1-missing`, `h1-multiple`, `heading-order`) |
| **Canonical and indexing** | missing, multiple, invalid, not self-referencing, pointing to a redirect, a 404, a noindex page, another site, an http URL from an https page, canonical chains; `noindex` in meta robots or `X-Robots-Tag`, ranked higher on the start page or sitemap pages (`canonical-*`, `noindex-*`) |
| **hreflang** | missing return link, invalid language codes, no self-reference, targets that redirect or fail (`hreflang-*`) |
| **Links and redirects** | internal links to 3xx / 4xx / 5xx / blocked pages, redirect chains, loops, chains too long, temporary redirects, slow responses (`internal-link-*`, `redirect-*`, `slow-response`) |
| **Sitemap** | missing or invalid, URLs that error, redirect, are noindex, are non-canonical, blocked by robots.txt or on another origin, pages missing from the sitemap, **orphan pages** (in the sitemap, linked from nowhere) (`sitemap-*`, `orphan-page`, `page-not-in-sitemap`) |
| **Page basics** | images without alt (an empty `alt=""` is accepted), Open Graph tags, Twitter card, viewport meta, `lang` attribute (`image-alt-missing`, `og-tags-incomplete`, `twitter-card-missing`, `viewport-missing`, `lang-missing`) |
| **Content** | thin content (word count), duplicate content (hash of the normalised main text) (`thin-content`, `duplicate-content`) |
| **https** | mixed content (active and passive), http canonical on an https page, site served over http (`mixed-content-*`, `site-not-https`) |
| **URL hygiene** | uppercase, query parameters, underscores, very long URLs (`url-*`) |
| **Structured data (JSON-LD)** | extracts every block, reports parse errors with the line and column in the page, checks required and recommended properties for Person, Organization, Article / NewsArticle / BlogPosting, Product, BreadcrumbList, FAQPage, PodcastEpisode and Book, flags duplicate and conflicting entities (including the same `@id` described differently on different pages) (`sd-*`) |
| **Crawler and AI-bot access** | for Googlebot, Bingbot, GPTBot, PerplexityBot, CCBot, Google-Extended and Applebot-Extended: may the bot fetch the home page, the sitemap and the best-linked pages, according to robots.txt, and which rule decided (`bot-*`) |
| **Content without JavaScript** | reports the word count of the raw HTML response and flags near-empty bodies as likely client-rendered (`client-rendered-body`, `near-empty-body`). With `--render` the thinnest pages are also opened in Chrome and raw and rendered text are compared (`content-requires-javascript`) |

Every finding has an id, a priority (high, medium or low), a reason in one sentence and a plain-English fix. There is **no score**; the report is a prioritised list with counts, example URLs and a "What was not checked" section.

## Try it

```bash
npm install
npm test                 # vitest run (285 tests)
npm run typecheck        # tsc --noEmit
npm run fixtures         # serves the two fictional sites on 127.0.0.1:8801 (good) and :8802 (broken)
```

In a second terminal:

```bash
npm run audit -- http://127.0.0.1:8802/ --delay-ms 0 --max-pages 100 --out out/broken.md --json out/broken.json
npm run audit -- http://127.0.0.1:8801/ --delay-ms 0 --out out/good.md
```

Usage: `npm run audit -- <url> [--max-pages N] [--out report.md]` plus:

| Option | Meaning |
|---|---|
| `--max-pages N` | pages to fetch at most (default 50, hard limit 500; a larger value is cut to 500 with a message) |
| `--max-depth N` | link depth from the start URL (default 5) |
| `--delay-ms N` | minimum pause between requests (default 500). A robots.txt `Crawl-delay` can only make it longer |
| `--out FILE` | write the markdown report here (a `.json` name writes JSON); without it the report is printed |
| `--json FILE` | also write the JSON report |
| `--key-path PATH` | extra path for the bot-access table (repeatable) |
| `--contact TEXT` | appended to the User-Agent so a site owner can reach you |
| `--min-words N` | thin-content threshold (default 120) |
| `--render` | also render the few thinnest pages in Google Chrome (needs `playwright-core`, installed by `npm install` as an optional dependency, and Chrome already installed; no browser download) |
| `--fail-on LEVEL` | exit 1 if any issue of that priority or higher exists, handy in CI |

Exit codes: 0 done, 1 `--fail-on` tripped, 2 bad usage or robots.txt forbids the start page, 3 unexpected error.

## How it stays polite

- **Read-only.** GET requests only. Nothing is submitted, no cookies, no logins.
- **Identifies itself.** `User-Agent: seo-audit-kit/0.1 (read-only site audit)`, with `--contact` appended if you give one. It does not pretend to be a browser.
- **robots.txt first.** Fetched before anything else. If it forbids the start page, or answers with a server error, nothing else is requested and the report says so. Disallowed URLs are never requested, including redirect targets. There is no switch to turn this off. (robots.txt is a courtesy signal, not legal permission: audit sites you own or have permission to audit.)
- **Rate limit.** At least `--delay-ms` between any two requests, longer if robots.txt asks for a Crawl-delay.
- **Hard caps.** Pages (500 at most), link depth, redirect chain length (5), body size (2 MB), per-request timeout (15 s). Each URL is requested once.
- **Same origin only.** Links to other origins (including the same host on another port or scheme) are not requested. `--render` blocks every request to another origin too.
- **No external sites in development or tests.** All tests run against servers on `127.0.0.1`.

## Sample report (fictional)

This is an excerpt from the real output for the fictional "Quillmark Print Shop" fixture, which has problems planted on purpose (`npm run fixtures`, then the second command above). Nothing here describes a real site.

```
# SEO audit: http://127.0.0.1:8802/

## Summary
- Pages fetched: 37 (limit 100), 46 HTTP requests, no pause between requests (--delay-ms 0).
- Issues found: 9 high, 20 medium, 22 low (51 kinds, 82 occurrences).

| Priority | Issue                                                     | URLs affected |
| high     | Canonical points to a URL that redirects (canonical-to-redirect) | 1 |
| high     | Page body is empty until JavaScript runs (client-rendered-body)  | 1 |
| high     | Key pages marked noindex (noindex-key-page)                       | 1 |
| high     | Pages without a title (title-missing)                             | 1 |
| medium   | Orphan pages (in the sitemap but not linked from any crawled page) | 1 |
| ...      |                                                                   |   |

#### Key pages marked noindex (`noindex-key-page`): 1 URL
Why it matters: The start page or pages listed in the sitemap will not appear in search results.
How to fix: Remove the noindex meta tag or X-Robots-Tag header if the page should be found.
Examples:
- http://127.0.0.1:8802/pricing - listed in the sitemap

## Crawler and AI-bot access (robots.txt)
| Path      | Googlebot | Bingbot                        | GPTBot                    | PerplexityBot | ...
| /         | allowed   | allowed                        | **blocked** (Disallow: /) | allowed       | ...
| /services | allowed   | **blocked** (Disallow: /services) | **blocked** (Disallow: /) | allowed    | ...
```

The good fixture ("Fernwood Pottery") comes back with no issues at all. Both full reports are produced by the commands above and written to `out/` (git-ignored).

## Structured data: what "checked" means here

The required and recommended property lists live in `src/jsonld.ts` (`TYPE_RULES`) and were written from the schema.org type definitions and Google's structured data documentation. Notes on a few of them:

- Google lists no *required* properties for Article; this kit treats `headline`, `author` and `datePublished` as the practical minimum.
- Person and PodcastEpisode have no Google rich result; the lists are schema.org-level sanity checks (a name, and for episodes the media and series as recommended).
- Product requires a name plus one of `offers`, `review` or `aggregateRating`, and an Offer needs a price and currency.

**Google's Rich Results Test was not run.** A clean result here does not mean a page is eligible for rich results; a finding here may be stricter or looser than Google's.

## What the 285 tests show

| File | Tests | Covers |
|---|---|---|
| `urls.test.ts` | 10 | URL normalisation, same-origin rule, file-extension skip, URL hygiene |
| `robots.test.ts` | 15 | groups, merged groups, Allow/Disallow, longest match, `*`, `$`, Crawl-delay, Sitemap, fallbacks |
| `html.test.ts` | 14 | head data, headings, images, links, JSON-LD line numbers, main-text extraction, app-shell signals |
| `jsonld.test.ts` | 20 | parse-error location, required properties for each of the ten supported types (Article, NewsArticle and BlogPosting share one rule set), duplicate and conflicting entities |
| `sitemap.test.ts` | 8 | urlset, index, CDATA, off-origin and invalid URLs, caps, gzip and cross-origin notes |
| `bots.test.ts` | 6 | the seven bots, own-group versus `*`, key-path selection |
| `http.test.ts` | 20 | rate limit (fake clock), User-Agent, body cap, timeouts, redirect chains, loops, chain limit, robots refusal of a hop |
| `crawler.test.ts` | 28 | recorded fields, same-origin only (a second server proves nothing is requested), robots.txt including Crawl-delay timing, page cap, hard cap, depth cap, redirect limit, sitemap discovery and comparison |
| `checks.test.ts` | 61 | every check in isolation, on hand-built crawl results (this is also how https-only checks such as mixed content are tested) |
| `fixtures.test.ts` | 62 | the good site: zero issues; the broken site: each planted problem found on the right URL |
| `report.test.ts` | 16 | section order, severity grouping, example truncation, JSON, no score, partial-audit warning, escaping |
| `render.test.ts` | 8 | raw versus rendered comparison with an injected renderer; 2 tests drive real Chrome (skipped if Chrome is absent) |
| `cli.test.ts` | 17 | usage errors, output files, exit codes, `--render` wiring, a real `tsx` process |

### Mutation check

`node scripts/mutation-check.mjs` (or `npm run mutation`) copies the project into `.mutation-work/` (git-ignored), applies one deliberate breakage at a time to `src/` and runs the whole suite. 36 breakages are defined, for example: robots Disallow ignored, longest-match rule reversed, links to other origins followed, page cap off by one, hard cap removed, Crawl-delay ignored, redirect limit removed, no User-Agent, hreflang return check inverted, noindex not recognised. **Result of the last run: 36 of 36 killed** (see "Limits" for what that does and does not mean). The first run with all 36 had 2 survivors (307 not treated as a temporary redirect; cross-page entity conflicts not compared); tests were added for both and the script was re-run.

## Limits (read these before relying on it)

- **Fixture sites only.** Every test and example uses the two fictional sites in `fixtures/`. The kit has never crawled a real site, so real-world surprises (consent banners, odd markup, bot protection, huge pages, unusual redirects, rate limiting) are untested.
- **Mixed content, https canonicals and the http-site warning were tested on hand-built crawl results**, not on a site served over TLS. The fixtures only speak plain http on localhost.
- **No search-engine comparison.** Nothing was checked against Google Search Console, the Rich Results Test, Lighthouse or any other tool. Thresholds (title 15-60 characters, description 70-160, 120 words for "thin", 25 words for "near-empty", 2 s for "slow") are common rules of thumb, not search-engine rules.
- **robots.txt reading is partial.** Groups, Allow, Disallow, longest match, `*`, `$` and Crawl-delay are handled; percent-encoding rules and some RFC 9309 edge cases are not. A bot is matched by its exact product token (case-insensitive) or the `*` group; the kit does not model vendor-specific fallbacks such as Applebot-Extended inheriting Applebot rules. The bot table reports what robots.txt asks for, not whether a bot obeys it.
- **AI-bot notes are generic on purpose.** Vendors change what their tokens control. Check the vendor's own documentation before making a policy decision.
- **Client-side rendering is inferred**, not observed, unless you use `--render`. `--render` renders only the thinnest pages (5 by default, 20 at most), uses the Chrome already installed (macOS tested), and was run on the fixtures only. A page that is mostly server-rendered but loads its main content late may be missed without `--render`.
- **Only JSON-LD** is read for structured data (no Microdata or RDFa), and only the ten types listed above.
- **Not read:** gzip sitemaps, image/video/news sitemaps, `<base href>`, pagination (`rel=prev/next`), AMP, `rel=nofollow` links (they are not followed, so pages reachable only through them are not crawled), `X-Robots-Tag` values other than `noindex`/`none`.
- **Not measured:** page speed, Core Web Vitals, mobile rendering, accessibility beyond alt text and `lang`, security headers, external links, image file sizes. "Thin" means few words, not low quality. Duplicate detection is an exact hash of normalised main text, not near-duplicate matching.
- **The mutation result is a limited signal.** The 36 breakages were chosen by the author, are single-expression changes, and the tests were written by the same person; 36 of 36 killed means those 36 changes are noticed, not that the suite catches every bug.
- **CI:** `.github/workflows/ci.yml` (`npm ci`, typecheck, test) passed on GitHub Actions on 2026-10-31. Whether the two real-Chrome tests ran or were skipped on that runner was not checked.
- **Node:** developed and tested on Node v25.2.1 only. Other versions are untested.
- **Not production code.** No retries beyond what is described, no scheduling, no authentication, no persistent storage.

## Layout

```
src/        crawler.ts http.ts robots.ts sitemap.ts html.ts jsonld.ts checks.ts catalog.ts
            bots.ts audit.ts report.ts render.ts urls.ts cli.ts index.ts
fixtures/   good-site.ts broken-site.ts (the fictional sites), html.ts (page builder), server.ts, serve.ts
tests/      vitest suites, one file per area, helpers.ts
scripts/    mutation-check.mjs
```

`src/catalog.ts` holds the id, priority, reason and fix text of every check; `src/checks.ts` holds the logic. To add a check, add an entry to the catalog, emit a finding from `runChecks`, and add a test (plus, if it is a site-level problem, a planted case in `fixtures/broken-site.ts` and its line in `BROKEN_SITE_EXPECTATIONS`).

MIT licensed. Nothing here is published on npm; copy `src/` into a project to use it.
