import { brokenSite } from "./broken-site.js";
import { goodSite } from "./good-site.js";
import { startFixture } from "./server.js";

/** `npm run fixtures`: serves both fictional sites on fixed local ports so the CLI can be tried by hand. */
const good = await startFixture(goodSite, 8801);
const broken = await startFixture(brokenSite, 8802);
console.log(`good site:   ${good.origin}/`);
console.log(`broken site: ${broken.origin}/`);
console.log(`try: npm run audit -- ${broken.origin}/ --delay-ms 0 --out out/broken.md`);
console.log("Ctrl+C to stop.");
