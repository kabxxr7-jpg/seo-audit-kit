import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A response served by a fixture site. `{{ORIGIN}}` in the body and header values is replaced at serve time. */
export interface FixtureResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Content-Type; defaults to text/html. */
  type?: string;
  /** Artificial server delay in ms. */
  delayMs?: number;
}

export type FixtureRoute = FixtureResponse | ((req: { url: URL; origin: string }) => FixtureResponse);

export interface FixtureSite {
  name: string;
  /** Keyed by pathname (query strings are ignored, matching is case-sensitive). */
  routes: Record<string, FixtureRoute>;
  notFound?: FixtureResponse;
}

export interface RequestLog {
  /** Path and query as requested. */
  path: string;
  method: string;
  userAgent: string;
  at: number;
}

export interface RunningFixture {
  origin: string;
  port: number;
  requests: RequestLog[];
  close(): Promise<void>;
}

function fill(s: string, origin: string): string {
  return s.replaceAll("{{ORIGIN}}", origin);
}

export async function startFixture(site: FixtureSite, port = 0): Promise<RunningFixture> {
  const requests: RequestLog[] = [];
  let origin = "";
  const server: Server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", origin || "http://127.0.0.1");
    requests.push({ path: req.url ?? "/", method: req.method ?? "GET", userAgent: String(req.headers["user-agent"] ?? ""), at: Date.now() });
    const route = site.routes[url.pathname];
    const resp: FixtureResponse =
      route === undefined ? (site.notFound ?? { status: 404, body: "<!doctype html><title>Not found</title><h1>Not found</h1>" }) : typeof route === "function" ? route({ url, origin }) : route;
    const send = (): void => {
      const body = fill(resp.body ?? "", origin);
      const headers: Record<string, string> = { "content-type": resp.type ?? "text/html; charset=utf-8" };
      for (const [k, v] of Object.entries(resp.headers ?? {})) headers[k.toLowerCase()] = fill(v, origin);
      res.writeHead(resp.status ?? 200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (resp.delayMs) setTimeout(send, resp.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${actual}`;
  return {
    origin,
    port: actual,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
