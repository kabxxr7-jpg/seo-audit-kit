import type { FixtureResponse, FixtureRoute, FixtureSite } from "./server.js";
import { PRINTING, page, prose, sitemapXml } from "./html.js";

/**
 * "Quillmark Print Shop": a fictional site with SEO problems added on purpose.
 * Each problem is listed in BROKEN_SITE_EXPECTATIONS so tests can assert the audit finds it.
 */

const O = "{{ORIGIN}}";
const NAV: [string, string][] = [
  ["/", "Home"],
  ["/services", "Services"],
  ["/pricing", "Pricing"],
  ["/about", "About"],
  ["/gallery", "Gallery"],
  ["/contact", "Contact"],
];

const text = (seed: string, n = 14): string => prose(seed, PRINTING, n);
const ok = (body: string, extra: Partial<FixtureResponse> = {}): FixtureRoute => ({ body, ...extra });
const redirect = (to: string, status = 301): FixtureRoute => ({ status, headers: { location: to }, body: "" });

const routes: Record<string, FixtureRoute> = {};

// Home: links to every problem page. Two Organization blocks share an @id but disagree on the name.
routes["/"] = ok(
  page({
    title: "Quillmark Print Shop",
    description: "Quillmark Print Shop is a made-up print business used to test an SEO audit tool: posters, flyers, cards and booklets printed to order.",
    h1: "Printing for small businesses",
    canonical: "/",
    viewport: true,
    social: true,
    nav: NAV,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Organization", "@id": `${O}/#org`, name: "Quillmark Print Shop", url: `${O}/` },
      { "@context": "https://schema.org", "@type": "Organization", "@id": `${O}/#org`, name: "Quillmark Printers Ltd", url: `${O}/` },
    ],
    body: `<p>Welcome to a fictional print shop.</p>
<ul>
<li><a href="/hub">Hub of test pages</a></li>
<li><a href="/app">Online designer</a></li>
<li><a href="/tiny">Tiny page</a></li>
<li><a href="/short">Short title page</a></li>
<li><a href="/copy-a">Copy A</a></li>
<li><a href="/copy-b">Copy B</a></li>
<li><a href="/materials">Materials</a></li>
<li><a href="/old-services">Old services page</a></li>
<li><a href="/missing-page">A page that was deleted</a></li>
<li><a href="/loop-a">Loop</a></li>
<li><a href="/chain-start">Long chain</a></li>
<li><a href="/Gallery/Summer_Show?utm_source=newsletter">Summer show</a></li>
<li><a href="/private/dashboard">Customer dashboard</a></li>
</ul>
${text("home")}`,
  }),
);

// Duplicate title and description with /materials; heading order skips h2 -> h4.
const dupTitle = "Print Services and Pricing";
const dupDesc = "Posters, flyers, business cards and booklets printed on recycled stock, with proofs before every run and delivery across the region.";
routes["/services"] = ok(
  page({
    title: dupTitle,
    description: dupDesc,
    h1: "Services",
    canonical: "/services",
    social: true,
    nav: NAV,
    body: `<h2>What we print</h2><p>Posters and flyers.</p><h4>Finishing options</h4>${text("services")}`,
  }),
);
routes["/materials"] = ok(
  page({
    title: dupTitle,
    description: dupDesc,
    h1: "Materials",
    canonical: "/materials",
    social: true,
    nav: NAV,
    body: text("materials"),
  }),
);

// noindex on a key page (linked from the nav and listed in the sitemap).
routes["/pricing"] = ok(
  page({
    title: "Pricing for Posters, Flyers and Cards",
    description: "Clear prices for posters, flyers, cards and booklets, with quantity breaks and no hidden setup fees at Quillmark Print Shop.",
    h1: "Pricing",
    canonical: "/pricing",
    robots: "noindex, follow",
    social: true,
    nav: NAV,
    body: text("pricing"),
  }),
);

// No meta description; invalid JSON-LD (trailing comma).
routes["/about"] = ok(
  page({
    title: "About Quillmark Print Shop and Our Team",
    description: null,
    h1: "About us",
    canonical: "/about",
    social: true,
    nav: NAV,
    rawJsonLd: [`{\n  "@context": "https://schema.org",\n  "@type": "Person",\n  "name": "Ines Varga",\n  "jobTitle": "Owner",\n}`],
    body: text("about"),
  }),
);

// Missing title, no lang, no viewport, images without alt, two identical Organization blocks, links to a noindex page.
routes["/contact"] = ok(
  page({
    title: null,
    description: "Contact the Quillmark Print Shop team about quotes, artwork files and delivery times. We reply to every message within a working day.",
    h1: "Contact",
    lang: null,
    viewport: false,
    canonical: "/contact",
    nav: NAV,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "Organization", name: "Quillmark Print Shop", url: `${O}/` },
      { "@context": "https://schema.org", "@type": "Organization", name: "Quillmark Print Shop", url: `${O}/` },
    ],
    body: `<img src="/img/office.svg"><img src="/img/press.svg" alt="The press"><p><a href="/thank-you">After you send the form</a></p>${text("contact")}`,
  }),
);

// Very long title, two h1 elements.
routes["/gallery"] = ok(
  page({
    title: "Our Gallery of Posters, Flyers, Business Cards, Booklets and Labels Printed for Local Clients Across the Region",
    description: "A gallery of printed work from Quillmark Print Shop, including posters, flyers and booklets made for local cafes, theatres and clubs.",
    h1: "Gallery",
    canonical: "/gallery",
    social: true,
    nav: NAV,
    body: `<h1>Latest work</h1>${text("gallery")}`,
  }),
);
routes["/Gallery/Summer_Show"] = ok(
  page({
    title: "Summer Show Posters and Programmes",
    description: "Posters and programmes printed for the summer show, showing stock choices, finishes and how the proofs were approved before printing.",
    h1: "Summer show",
    canonical: "/Gallery/Summer_Show",
    social: true,
    nav: NAV,
    body: text("summer"),
  }),
);

// Title and description far too short.
routes["/short"] = ok(
  page({ title: "Hi", description: "Prints.", h1: "Short title", canonical: "/short", social: true, nav: NAV, body: text("short") }),
);

// Thin content: about 30 words, no scripts.
routes["/tiny"] = ok(
  page({
    title: "A Very Small Page About Printing",
    description: "A very small page used to test the thin content check, with only a handful of words in the body of the page.",
    h1: "Tiny",
    canonical: "/tiny",
    social: true,
    nav: NAV,
    body: `<p>We print things. This page has very little to say about that, which is exactly the point of this test page here.</p>`,
  }),
);

// Client-rendered: the raw HTML has an empty app container.
routes["/app"] = ok(
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Online Poster Designer | Quillmark</title>
<meta name="description" content="Design a poster in your browser and send it straight to print with Quillmark Print Shop, no software needed on your computer.">
<link rel="canonical" href="${O}/app">
<script defer src="/app.js"></script>
</head>
<body>
<div id="root"></div>
<noscript>You need to enable JavaScript to run this app.</noscript>
</body>
</html>
`,
);
routes["/app.js"] = {
  type: "text/javascript",
  body: `document.getElementById("root").innerHTML = "<main><h1>Online designer</h1>" + "<p>" + "Pick a template, drop in your text and download a proof. ".repeat(12) + "</p></main>";`,
};

// Exact duplicate body text under different titles.
for (const [path, title, desc] of [
  ["/copy-a", "Poster Printing Guide, Edition A", "Edition A of the poster printing guide explains stock, finishes, bleed and proofing for first-time customers of Quillmark."],
  ["/copy-b", "Poster Printing Guide, Edition B", "Edition B of the poster printing guide covers stock, finishes, bleed and proofing so you can order with more confidence."],
] as const) {
  routes[path] = ok(page({ title, description: desc, h1: "Poster Printing Guide", canonical: path, social: true, nav: NAV, body: text("same-text") }));
}

// Redirects: 302 -> 301 chain, a loop, and a chain longer than the crawler follows.
routes["/old-services"] = redirect("/services-temp", 302);
routes["/services-temp"] = redirect("/services", 301);
routes["/loop-a"] = redirect("/loop-b", 302);
routes["/loop-b"] = redirect("/loop-a", 302);
routes["/chain-start"] = redirect("/hop-1");
for (let i = 1; i <= 7; i++) routes[`/hop-${i}`] = redirect(i === 7 ? "/chain-end" : `/hop-${i + 1}`);
routes["/chain-end"] = ok(page({ title: "End of a Long Redirect Chain", description: "The final page after a long chain of redirects, which most crawlers will never reach because they give up first.", h1: "Chain end", canonical: "/chain-end", social: true, nav: NAV, body: text("chain-end") }));

// Hub: links to the canonical, hreflang and header test pages.
routes["/hub"] = ok(
  page({
    title: "Hub of Test Pages for the Audit",
    description: "A page that links to the canonical, hreflang, structured data and header test pages used by the audit tool tests, for completeness.",
    h1: "Hub",
    canonical: "/hub",
    social: true,
    nav: NAV,
    body: `<ul>
<li><a href="/canon-redirect">canonical to a redirect</a></li>
<li><a href="/canon-gone">canonical to a 404</a></li>
<li><a href="/canon-a">canonical chain</a></li>
<li><a href="/en/page">hreflang without return</a></li>
<li><a href="/shop/widget">Product with missing data</a></li>
<li><a href="/blog/post">Article with missing data</a></li>
<li><a href="/faq">FAQ with a missing answer</a></li>
<li><a href="/header-noindex">noindex by header</a></li>
</ul>${text("hub")}`,
  }),
);

const canonPage = (canonical: string, seed: string): FixtureRoute =>
  ok(page({ title: `Canonical test page ${seed}`, description: `Canonical test page ${seed} with enough description text to pass the length check for this fixture site.`, h1: `Canonical ${seed}`, canonical, social: true, nav: NAV, body: text(`canon-${seed}`) }));
routes["/canon-redirect"] = canonPage(`${O}/moved`, "redirect");
routes["/moved"] = redirect("/canon-target");
routes["/canon-target"] = canonPage(`${O}/canon-target`, "target");
routes["/canon-gone"] = canonPage(`${O}/gone-page`, "gone");
routes["/canon-a"] = canonPage(`${O}/canon-b`, "a");
routes["/canon-b"] = canonPage(`${O}/canon-c`, "b");
routes["/canon-c"] = canonPage(`${O}/canon-c`, "c");

// hreflang: /en/page lists /de/page, which does not list it back; one invalid language code.
routes["/en/page"] = ok(
  page({
    title: "English Version of the Page",
    description: "The English version of a page that claims a German alternative, but the German page never points back to this one.",
    h1: "English page",
    canonical: "/en/page",
    social: true,
    nav: NAV,
    head: `<link rel="alternate" hreflang="en" href="${O}/en/page">\n<link rel="alternate" hreflang="de" href="${O}/de/page">\n<link rel="alternate" hreflang="english" href="${O}/en/other">`,
    body: text("en-page"),
  }),
);
routes["/en/other"] = ok(page({ title: "Another English Page", description: "Another English page that exists only so the invalid hreflang code in the fixture has a real target to point at.", h1: "Other", canonical: "/en/other", social: true, nav: NAV, body: text("en-other") }));
routes["/de/page"] = ok(
  page({ title: "Deutsche Version der Seite", description: "Die deutsche Version einer Seite, die leider keinen Rueckverweis auf die englische Version enthaelt, genau wie im Test gewollt.", h1: "Deutsche Seite", lang: "de", canonical: "/de/page", social: true, nav: NAV, body: text("de-page") }),
);

// Structured data problems.
routes["/shop/widget"] = ok(
  page({
    title: "Widget Stand for Posters",
    description: "A fictional stand for displaying posters in a shop window, listed here without a name or a price in its structured data.",
    h1: "Widget stand",
    canonical: "/shop/widget",
    social: true,
    nav: NAV,
    jsonLd: [{ "@context": "https://schema.org", "@type": "Product", description: "A stand.", offers: { "@type": "Offer", priceCurrency: "EUR" } }],
    body: text("widget"),
  }),
);
routes["/blog/post"] = ok(
  page({
    title: "A Post About Print Proofs",
    description: "A short post about why we send a proof before every run, and what to look at on it before you approve the job for printing.",
    h1: "Print proofs",
    canonical: "/blog/post",
    social: true,
    nav: NAV,
    jsonLd: [{ "@type": "Article", headline: "A post about print proofs" }],
    body: text("post"),
  }),
);
routes["/faq"] = ok(
  page({
    title: "Questions About Printing Orders",
    description: "Answers to the questions customers ask most about file formats, turnaround times, proofs and delivery for printing orders.",
    h1: "FAQ",
    canonical: "/faq",
    social: true,
    nav: NAV,
    jsonLd: [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "What file format do you need?" }] }],
    body: text("faq"),
  }),
);

// noindex by header, and noindex on a page that is not important (thank-you).
routes["/header-noindex"] = ok(
  page({ title: "Page Hidden by a Header", description: "A page that asks not to be indexed through an HTTP header rather than a meta tag, to test header handling in the audit.", h1: "Hidden by header", canonical: "/header-noindex", social: true, nav: NAV, body: text("header-noindex") }),
  { headers: { "x-robots-tag": "noindex" } },
);
routes["/thank-you"] = ok(
  page({ title: "Thank You for Your Message", description: "A confirmation page shown after the contact form is sent, kept out of search results on purpose, which is normal practice.", h1: "Thank you", canonical: "/thank-you", robots: "noindex", social: true, nav: NAV, body: text("thanks") }),
);

// Orphan: in the sitemap, linked from nowhere.
routes["/secret-offer"] = ok(
  page({ title: "Secret Offer for Returning Customers", description: "A discount page for returning customers that is listed in the sitemap but not linked from any page of the site at all.", h1: "Secret offer", canonical: "/secret-offer", social: true, nav: [["/", "Home"]], body: text("secret") }),
);

// Blocked by robots.txt: linked from the home page.
routes["/private/dashboard"] = ok(page({ title: "Customer Dashboard", description: "A private dashboard that robots.txt keeps crawlers out of, linked from the public home page for the purposes of this test.", h1: "Dashboard", canonical: "/private/dashboard", nav: NAV, body: text("dash") }));

routes["/robots.txt"] = {
  type: "text/plain",
  body: `User-agent: *
Disallow: /private/
Disallow: /cart

User-agent: GPTBot
Disallow: /

User-agent: Bingbot
Disallow: /services

Sitemap: ${O}/sitemap.xml
`,
};

routes["/sitemap.xml"] = {
  type: "application/xml",
  body: sitemapXml(O, [
    "/", "/services", "/materials", "/pricing", "/about", "/gallery", "/contact", "/app", "/tiny", "/short", "/copy-a", "/copy-b",
    "/secret-offer", "/old-services", "/gone-from-sitemap", "/private/dashboard", "https://elsewhere.example/page",
  ]),
};

export const brokenSite: FixtureSite = { name: "broken-site", routes };

/** Which URL path should carry which finding (used by the tests). */
export const BROKEN_SITE_EXPECTATIONS: Record<string, string[]> = {
  "title-missing": ["/contact"],
  "title-duplicate": ["/services", "/materials"],
  "title-too-long": ["/gallery"],
  "title-too-short": ["/short"],
  "meta-description-missing": ["/about"],
  "meta-description-duplicate": ["/services", "/materials"],
  "meta-description-too-short": ["/short"],
  "h1-multiple": ["/gallery"],
  "heading-order": ["/services"],
  "h1-missing": ["/app"],
  "canonical-to-redirect": ["/canon-redirect"],
  "canonical-to-error": ["/canon-gone"],
  "canonical-chain": ["/canon-a"],
  "noindex-key-page": ["/pricing"],
  "noindex-page": ["/thank-you", "/header-noindex"],
  "orphan-page": ["/secret-offer"],
  "sd-parse-error": ["/about"],
  "sd-missing-required": ["/shop/widget", "/blog/post", "/faq"],
  "sd-missing-context": ["/blog/post"],
  "sd-duplicate-entity": ["/contact"],
  "sd-conflicting-entity": ["/"],
  "hreflang-no-return": ["/en/page"],
  "hreflang-invalid-code": ["/en/page"],
  "image-alt-missing": ["/contact"],
  "viewport-missing": ["/contact"],
  "lang-missing": ["/contact"],
  "client-rendered-body": ["/app"],
  "thin-content": ["/tiny"],
  "duplicate-content": ["/copy-a", "/copy-b"],
  "internal-link-broken": ["/"],
  "internal-link-redirect": ["/"],
  "internal-link-blocked": ["/"],
  "redirect-chain": ["/old-services"],
  "redirect-temporary": ["/old-services"],
  "redirect-loop": ["/loop-a"],
  "redirect-chain-too-long": ["/chain-start"],
  "url-uppercase": ["/Gallery/Summer_Show"],
  "url-parameters": ["/Gallery/Summer_Show"],
  "url-underscores": ["/Gallery/Summer_Show"],
  "sitemap-url-error": ["/gone-from-sitemap"],
  "sitemap-url-redirect": ["/old-services"],
  "sitemap-url-noindex": ["/pricing"],
  "sitemap-url-blocked": ["/private/dashboard"],
  "sitemap-url-offsite": ["https://elsewhere.example/page"],
  "page-not-in-sitemap": ["/hub"],
  "og-tags-incomplete": ["/contact"],
  "bot-ai-blocked": ["/robots.txt"],
  "bot-search-blocked-path": ["/robots.txt"],
};
