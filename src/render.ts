import { sameOrigin } from "./urls.js";

/** Returns the HTML of the page after JavaScript has run. */
export type RenderFn = (url: string) => Promise<string>;

export interface Renderer {
  render: RenderFn;
  close(): Promise<void>;
}

/**
 * Optional: renders pages in the Google Chrome installed on this machine through playwright-core.
 * Only same-origin requests are allowed, so rendering never contacts third-party hosts.
 * playwright-core is loaded lazily and is not needed unless this is called.
 */
export async function createChromeRenderer(userAgent: string, timeoutMs = 15_000): Promise<Renderer> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("--render needs the optional dependency playwright-core (run npm install) and Google Chrome installed.");
  }
  let browser;
  try {
    browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    throw new Error(`Could not start Google Chrome for --render (${msg}).`);
  }
  const context = await browser.newContext({ userAgent });
  return {
    async render(url: string): Promise<string> {
      const page = await context.newPage();
      try {
        await page.route("**/*", (route) => (sameOrigin(route.request().url(), url) ? route.continue() : route.abort()));
        await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
        return await page.content();
      } finally {
        await page.close();
      }
    },
    async close(): Promise<void> {
      await browser.close();
    },
  };
}
