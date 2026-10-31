export type Severity = "high" | "medium" | "low";

export interface CheckDef {
  severity: Severity;
  title: string;
  /** Why it matters, one sentence. */
  why: string;
  /** What to do, plain English. */
  fix: string;
}

export const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

export const CATALOG = {
  // --- status, redirects, crawl ---
  "page-error": { severity: "high", title: "Start page returns an error", why: "If the page you point crawlers at fails, there is nothing to index.", fix: "Fix the server error or the broken route, then re-run the audit." },
  "internal-link-broken": { severity: "high", title: "Internal links to missing or failing pages (4xx, 5xx, unreachable)", why: "Visitors and crawlers hit dead ends, and link value is wasted.", fix: "Update the link to a working URL, restore the page, or add a 301 redirect from the old URL to the right page." },
  "internal-link-redirect": { severity: "low", title: "Internal links that go through a redirect", why: "Every redirect adds a request and slows crawling; links should point at the final URL.", fix: "Change the link to the URL it redirects to." },
  "internal-link-blocked": { severity: "low", title: "Internal links to pages that robots.txt blocks", why: "Crawlers are told not to fetch the page you are linking to, which is usually a mistake for a page you want found.", fix: "Remove the link, or remove the matching Disallow rule if the page should be crawlable." },
  "redirect-loop": { severity: "high", title: "Redirect loops", why: "The URL never resolves, so neither visitors nor crawlers can reach the page.", fix: "Fix the redirect rules so the chain ends at a real page." },
  "redirect-chain-too-long": { severity: "high", title: "Redirect chains longer than the crawler will follow", why: "Search engines stop following long chains, so the final page may never be reached.", fix: "Redirect the first URL straight to the final URL in a single step." },
  "redirect-chain": { severity: "medium", title: "Redirect chains (more than one hop)", why: "Each extra hop slows the page and weakens signals passed to the final URL.", fix: "Point every old URL directly at the final URL with a single 301." },
  "redirect-temporary": { severity: "low", title: "Temporary redirects (302/307) on crawled URLs", why: "Search engines may keep the old URL indexed when a redirect is marked temporary.", fix: "If the move is permanent use a 301 or 308." },
  "redirect-broken": { severity: "medium", title: "Redirect without a usable Location header", why: "The redirect cannot be followed.", fix: "Make the server send a valid Location URL with the redirect." },
  "slow-response": { severity: "low", title: "Slow server response", why: "Slow responses reduce how much of the site gets crawled and hurt visitors.", fix: "Check server caching, database queries and hosting; aim for under about 800 ms to first byte." },
  "site-not-https": { severity: "high", title: "Site is served over plain HTTP", why: "Browsers warn visitors and search engines prefer HTTPS.", fix: "Install a certificate, redirect all HTTP URLs to HTTPS with 301s, and update canonicals and sitemaps to https://." },
  "mixed-content-active": { severity: "high", title: "HTTPS pages load scripts, styles or frames over HTTP", why: "Browsers block this content, so parts of the page can silently break.", fix: "Change the http:// URL to https:// (or a protocol-relative path) and make sure the resource is available over HTTPS." },
  "mixed-content-passive": { severity: "medium", title: "HTTPS pages load images or media over HTTP", why: "Browsers show a security warning or block the file.", fix: "Serve the file over HTTPS and update the URL." },
  // --- robots / sitemap ---
  "robots-missing": { severity: "low", title: "No robots.txt file", why: "Without it you cannot point crawlers at your sitemap or keep them out of private areas.", fix: "Add /robots.txt with at least a Sitemap: line." },
  "robots-blocks-audit": { severity: "high", title: "robots.txt disallows the start page for this crawler", why: "Nothing could be audited because the rules forbid it.", fix: "If this is unintended, review the Disallow rule shown; if intended, nothing to do." },
  "robots-unavailable": { severity: "high", title: "robots.txt could not be read", why: "A server error on robots.txt makes crawlers treat the whole site as off limits.", fix: "Make /robots.txt return 200 (or 404 if you have none) reliably." },
  "sitemap-missing": { severity: "medium", title: "No XML sitemap found", why: "A sitemap helps search engines discover pages that are poorly linked.", fix: "Publish /sitemap.xml listing your indexable URLs and reference it from robots.txt." },
  "sitemap-invalid": { severity: "medium", title: "Sitemap file is unreadable or invalid", why: "Search engines will ignore a sitemap they cannot parse.", fix: "Serve valid sitemap XML (`<urlset>` or `<sitemapindex>`) with HTTP 200." },
  "sitemap-url-error": { severity: "high", title: "Sitemap lists URLs that return errors", why: "Sitemaps should list only working pages; errors waste crawl budget and erode trust in the file.", fix: "Remove the URL from the sitemap or fix the page." },
  "sitemap-url-redirect": { severity: "medium", title: "Sitemap lists URLs that redirect", why: "A sitemap should list final URLs, not redirecting ones.", fix: "List the redirect target instead." },
  "sitemap-url-noindex": { severity: "medium", title: "Sitemap lists pages marked noindex", why: "The sitemap says 'index this' while the page says 'do not'.", fix: "Remove noindex if the page should rank, otherwise remove it from the sitemap." },
  "sitemap-url-noncanonical": { severity: "low", title: "Sitemap lists URLs whose canonical points elsewhere", why: "Only canonical URLs belong in a sitemap.", fix: "List the canonical URL instead." },
  "sitemap-url-offsite": { severity: "low", title: "Sitemap lists URLs on another origin", why: "Search engines only accept URLs from the site that hosts the sitemap.", fix: "Remove the URL or move it to that site's own sitemap." },
  "sitemap-url-blocked": { severity: "medium", title: "Sitemap lists URLs that robots.txt blocks", why: "The sitemap asks for indexing while robots.txt forbids crawling.", fix: "Remove the Disallow rule or remove the URL from the sitemap." },
  "page-not-in-sitemap": { severity: "low", title: "Indexable pages missing from the sitemap", why: "Pages absent from the sitemap are found more slowly.", fix: "Add the page to the sitemap if it should be indexed." },
  "orphan-page": { severity: "medium", title: "Orphan pages (in the sitemap but not linked from any crawled page)", why: "Pages with no internal links get little authority and are hard for visitors to find.", fix: "Link to the page from a relevant page or navigation, or remove it from the sitemap if it is obsolete." },
  // --- titles / descriptions / headings ---
  "title-missing": { severity: "high", title: "Pages without a title", why: "The title is the main headline in search results; without it search engines invent one.", fix: "Add a unique `<title>` that describes the page in about 15-60 characters." },
  "title-duplicate": { severity: "medium", title: "Duplicate page titles", why: "Identical titles make pages compete with each other and look the same in results.", fix: "Write a unique title for each page." },
  "title-too-long": { severity: "low", title: "Titles over 60 characters", why: "Long titles are cut off in search results.", fix: "Shorten the title to about 60 characters, key words first." },
  "title-too-short": { severity: "low", title: "Titles under 15 characters", why: "Very short titles waste space to describe the page.", fix: "Expand the title to say what the page is and who it is for." },
  "meta-description-missing": { severity: "medium", title: "Pages without a meta description", why: "Search engines then pick random text for the snippet, which lowers click-through.", fix: "Add a unique `<meta name=\"description\">` of 70-160 characters." },
  "meta-description-duplicate": { severity: "medium", title: "Duplicate meta descriptions", why: "The same snippet on several pages gives searchers no reason to choose one over another.", fix: "Write a unique description per page." },
  "meta-description-too-long": { severity: "low", title: "Meta descriptions over 160 characters", why: "The end of a long description is cut off.", fix: "Trim to 160 characters or fewer." },
  "meta-description-too-short": { severity: "low", title: "Meta descriptions under 70 characters", why: "A short description uses little of the space available in results.", fix: "Expand to 70-160 characters." },
  "h1-missing": { severity: "medium", title: "Pages without an h1", why: "The h1 tells visitors and search engines what the page is about.", fix: "Add one visible `<h1>` that matches the page topic." },
  "h1-multiple": { severity: "low", title: "Pages with more than one h1", why: "Several top-level headings blur the main topic.", fix: "Keep one `<h1>`; make the others `<h2>`." },
  "heading-order": { severity: "low", title: "Heading levels that skip (for example h2 then h4)", why: "A broken outline is harder for screen readers and crawlers to follow.", fix: "Use headings in order without skipping levels." },
  // --- canonical / indexing ---
  "canonical-missing": { severity: "medium", title: "Pages without a canonical link", why: "Without a canonical, URL variants (tracking parameters, trailing slashes) can split ranking signals.", fix: "Add `<link rel=\"canonical\" href=\"...\">` pointing at the preferred URL of the page itself." },
  "canonical-multiple": { severity: "medium", title: "Pages with conflicting canonical links", why: "Search engines ignore canonicals when a page declares more than one.", fix: "Keep a single canonical link." },
  "canonical-invalid": { severity: "medium", title: "Canonical link is not a valid URL", why: "An unusable canonical is ignored.", fix: "Use an absolute https:// URL." },
  "canonical-not-self": { severity: "low", title: "Canonical points to a different page", why: "That page will not be indexed in its own right. This is correct for deliberate duplicates and wrong otherwise.", fix: "Confirm it is intended; if not, make the canonical point at the page itself." },
  "canonical-to-redirect": { severity: "high", title: "Canonical points to a URL that redirects", why: "The preferred URL should be the final one; pointing at a redirect sends mixed signals.", fix: "Point the canonical at the final URL." },
  "canonical-to-error": { severity: "high", title: "Canonical points to a missing or failing page", why: "Search engines may ignore the canonical or drop the page.", fix: "Point the canonical at a working URL." },
  "canonical-to-noindex": { severity: "medium", title: "Canonical points to a noindex page", why: "The page tells search engines to index the target, and the target asks not to be indexed.", fix: "Remove the noindex from the target or change the canonical." },
  "canonical-chain": { severity: "medium", title: "Canonical chains (A points to B, B points to C)", why: "Search engines may not follow the chain to the end.", fix: "Point every page's canonical straight at the final preferred URL." },
  "canonical-external": { severity: "low", title: "Canonical points to another site", why: "The page will not be indexed on your domain. Correct for syndicated content only.", fix: "Confirm it is intended." },
  "canonical-http-on-https": { severity: "medium", title: "HTTPS page with an http:// canonical", why: "It asks search engines to prefer the insecure version.", fix: "Use the https:// URL in the canonical." },
  "noindex-key-page": { severity: "high", title: "Key pages marked noindex", why: "The start page or pages listed in the sitemap will not appear in search results.", fix: "Remove the noindex meta tag or X-Robots-Tag header if the page should be found." },
  "noindex-page": { severity: "low", title: "Pages marked noindex", why: "These pages will not appear in search results. Fine for thank-you or account pages.", fix: "Confirm each one is intended." },
  // --- hreflang ---
  "hreflang-no-return": { severity: "medium", title: "hreflang without a return link", why: "Search engines ignore an alternate-language link unless the other page links back.", fix: "Add the reciprocal hreflang link on the target page." },
  "hreflang-invalid-code": { severity: "medium", title: "Invalid hreflang language codes", why: "Search engines ignore codes they do not recognise.", fix: "Use codes such as en, en-GB or x-default." },
  "hreflang-missing-self": { severity: "low", title: "hreflang set without a self-reference", why: "Each page in a language group should list itself too.", fix: "Add an hreflang entry for the page's own URL." },
  "hreflang-target-error": { severity: "medium", title: "hreflang links to redirecting or failing pages", why: "Alternate URLs must work and be final.", fix: "Point hreflang at the final, working URL." },
  // --- on-page ---
  "image-alt-missing": { severity: "medium", title: "Images without alt text", why: "Alt text is how search engines and screen readers understand an image.", fix: "Add a short description in alt; use alt=\"\" for purely decorative images." },
  "og-tags-incomplete": { severity: "low", title: "Open Graph tags missing", why: "Links shared on social networks and chat apps show a poor preview.", fix: "Add og:title, og:description and og:image." },
  "twitter-card-missing": { severity: "low", title: "No Twitter/X card tag", why: "Shared links may not show a large preview.", fix: "Add `<meta name=\"twitter:card\" content=\"summary_large_image\">`." },
  "viewport-missing": { severity: "medium", title: "No mobile viewport meta tag", why: "Without width=device-width pages render as zoomed-out desktop pages on phones.", fix: "Add `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">`." },
  "lang-missing": { severity: "low", title: "No lang attribute on `<html>`", why: "It helps screen readers, translation tools and language targeting.", fix: "Add lang=\"en\" (or your language) to the `<html>` tag." },
  "thin-content": { severity: "medium", title: "Thin content (few words)", why: "Pages with very little text rarely satisfy a search query.", fix: "Add useful, original content or merge the page into a stronger one." },
  "duplicate-content": { severity: "medium", title: "Pages with identical text", why: "Search engines pick one version and the others waste crawl budget.", fix: "Merge the pages, or add a canonical link to the preferred version." },
  "client-rendered-body": { severity: "high", title: "Page body is empty until JavaScript runs", why: "A crawler that does not run JavaScript sees an empty page; some AI crawlers are reported not to run it, and search engines may render late or not at all.", fix: "Render the main content on the server (SSR or static generation) so it is in the HTML response." },
  "near-empty-body": { severity: "medium", title: "Almost no text in the raw HTML (possibly client-rendered)", why: "The HTML response has very little readable content; crawlers that skip JavaScript will see little.", fix: "Check the page with JavaScript off; if content appears only afterwards, server-render it." },
  "content-requires-javascript": { severity: "high", title: "Most of the text only appears after JavaScript runs", why: "A headless browser found far more text than the raw HTML contains.", fix: "Server-render the main content so it is present in the HTML response." },
  // --- URL hygiene ---
  "url-uppercase": { severity: "low", title: "URLs with uppercase letters", why: "URLs are case-sensitive; mixed case invites duplicates.", fix: "Use lowercase URLs and redirect the uppercase variants." },
  "url-parameters": { severity: "low", title: "URLs with query parameters", why: "Parameters can create many URLs for the same content.", fix: "Use clean paths where possible and canonicalise parameter variants." },
  "url-underscores": { severity: "low", title: "URLs with underscores", why: "Hyphens are the usual word separator in URLs.", fix: "Use hyphens; redirect the old URL." },
  "url-too-long": { severity: "low", title: "Very long URLs", why: "Long URLs are hard to share and may be truncated.", fix: "Shorten the path." },
  // --- structured data ---
  "sd-parse-error": { severity: "medium", title: "JSON-LD that is not valid JSON", why: "Search engines skip a block they cannot parse, so its rich results are lost.", fix: "Fix the syntax at the line shown (a stray comma or quote is typical) and re-test." },
  "sd-missing-context": { severity: "low", title: "JSON-LD without a schema.org @context", why: "Without @context the data is not recognised as schema.org vocabulary.", fix: "Add \"@context\": \"https://schema.org\"." },
  "sd-missing-type": { severity: "medium", title: "JSON-LD objects without @type", why: "The object cannot be interpreted.", fix: "Add an @type such as Organization or Article." },
  "sd-missing-required": { severity: "medium", title: "Structured data missing required properties", why: "Without them the entity is incomplete and likely ineligible for rich results.", fix: "Add the properties listed for each page. Verify with Google's Rich Results Test." },
  "sd-missing-recommended": { severity: "low", title: "Structured data missing recommended properties", why: "Recommended properties improve how the entity is understood.", fix: "Add the properties if you have the data." },
  "sd-duplicate-entity": { severity: "low", title: "The same structured-data entity repeated on a page", why: "Duplicate blocks add noise and can confuse parsers.", fix: "Remove the repeated block so each entity appears once on the page." },
  "sd-conflicting-entity": { severity: "medium", title: "Structured-data entities that disagree", why: "Two descriptions of the same thing (same @id, or same type and name) with different values leave search engines guessing.", fix: "Make the values identical, or merge into one entity." },
  // --- crawler / AI bot access ---
  "bot-search-blocked-home": { severity: "high", title: "A search crawler is blocked from the home page", why: "That search engine cannot crawl your site.", fix: "Remove or narrow the Disallow rule for that crawler in robots.txt." },
  "bot-search-blocked-path": { severity: "medium", title: "A search crawler is blocked from key pages", why: "Those pages cannot be crawled by that search engine.", fix: "Check the Disallow rule is intended." },
  "bot-ai-blocked": { severity: "low", title: "AI crawlers or AI-control tokens blocked in robots.txt", why: "Those crawlers may not fetch the page. Often a deliberate policy decision, sometimes an accident.", fix: "Confirm this matches your intent. To allow a bot, remove its Disallow rule or add an Allow rule." },
} as const satisfies Record<string, CheckDef>;

export type CheckId = keyof typeof CATALOG;
