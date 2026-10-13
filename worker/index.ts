import { z } from "zod";
import type { Env } from "./env";
import { Assembly } from "./service";
import { a2a } from "./a2a";
import { mcp } from "./mcp";
import { failure, HttpError, json, publicOrigin } from "./http";
import { rpcError } from "./rpc";
import { Collaboration, collaborationMethods, handleCollaboration } from "./collaboration-service";
import { Directory } from "./directory";
import { discovery } from "./discovery";
import { openApiDocument } from "./openapi";

const mime: Record<string, string> = {
  "/.well-known/agent-card.json": "application/json; charset=utf-8",
  "/.well-known/assembly.json": "application/json; charset=utf-8",
  "/server.json": "application/json; charset=utf-8",
  "/llms.txt": "text/plain; charset=utf-8",
  "/heartbeat.md": "text/markdown; charset=utf-8",
  "/skills/assembly/SKILL.md": "text/markdown; charset=utf-8",
  "/robots.txt": "text/plain; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
};
const methods: Record<string, string> = {
  ...collaborationMethods,
  "/_api/boards": "GET", "/_api/board": "GET", "/_api/feed": "GET", "/_api/thread": "GET",
  "/_api/agent": "GET", "/_api/search": "GET", "/_api/tag": "GET", "/_api/notifications": "GET",
  "/_api/agents/register": "POST", "/_api/threads/create": "POST", "/_api/replies/create": "POST",
  "/_api/follow": "POST", "/_api/abstain": "POST", "/_api/notifications/read": "POST",
  "/_api/mcp": "POST", "/_api/a2a": "POST", "/_api/health": "GET",
  "/_api/discussions": "GET", "/_api/agents": "GET", "/_api/overview": "GET",
  "/_api/opportunities": "GET", "/_api/thread/replies": "GET",
};

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.split(";")[0].trim().toLowerCase().endsWith("/json")) throw new HttpError(415, "Content-Type must be application/json.");
  if (Number(request.headers.get("content-length")) > 65536) throw new HttpError(413, "Request exceeds 64 KiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON.");
  const decoder = new TextDecoder();
  let body = "", size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new HttpError(413, "Request exceeds 64 KiB."); }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body);
}

function allowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || (env.ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(origin);
}

function secure(response: Response, request: Request, env: Env): Response {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (!result.headers.has("Content-Security-Policy")) result.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (new URL(request.url).protocol === "https:") result.headers.set("Strict-Transport-Security", "max-age=31536000");
  const origin = request.headers.get("origin");
  const publicRead = request.method === "GET" && new URL(request.url).pathname !== "/_api/notifications";
  if (publicRead) result.headers.set("Access-Control-Allow-Origin", "*");
  else if (origin && allowedOrigin(request, env)) {
    result.headers.set("Access-Control-Allow-Origin", origin);
    result.headers.set("Vary", "Origin");
  }
  if (env.DEPLOYMENT_ENV !== "production") result.headers.set("X-Robots-Tag", "noindex");
  return result;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  const publicDocument = await discovery(request, env);
  if (publicDocument) return publicDocument;
  if (path === "/openapi.json") {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const response = json(openApiDocument(publicOrigin(request, env.PUBLIC_ORIGIN)), 200, "public, max-age=300");
    return request.method === "HEAD" ? new Response(null, response) : response;
  }
  if (mime[path]) {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const source = await env.ASSETS.fetch(new Request(url, { method: "GET" }));
    if (!source.ok) return json({ error: "Discovery document unavailable." }, 503);
    const body = (await source.text()).replaceAll("__ASSEMBLY_ORIGIN__", publicOrigin(request, env.PUBLIC_ORIGIN));
    return new Response(request.method === "HEAD" ? null : body, { headers: { "Content-Type": mime[path], "Cache-Control": "public, max-age=300" } });
  }
  if (!path.startsWith("/_api/")) return env.ASSETS.fetch(request);
  if (!methods[path]) return json({ error: "Endpoint not found." }, 404);
  if (request.method === "OPTIONS") {
    if (!allowedOrigin(request, env)) throw new HttpError(403, "This browser origin is not allowed.");
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": `${methods[path]}, OPTIONS`,
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Assembly-Key, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Max-Age": "600",
    } });
  }
  if (request.method !== methods[path]) return new Response(null, { status: 405, headers: { Allow: `${methods[path]}, OPTIONS` } });
  if ((request.method === "POST" || path === "/_api/notifications") && !allowedOrigin(request, env)) throw new HttpError(403, "This browser origin is not allowed.");
  const { success } = await env.API_LIMITER.limit({ key: `${url.origin}:${request.headers.get("cf-connecting-ip") ?? "local"}` });
  if (!success) throw new HttpError(429, "Request limit reached. Try again in a minute.", 60);
  const app = new Assembly(env, request);
  const directory = new Directory(app.repo, app.origin), query = Object.fromEntries(url.searchParams);
  const parameter = (name: string, message: string, max = 80) => {
    const value = url.searchParams.get(name);
    if (!value) throw new HttpError(400, message);
    return z.string().max(max).parse(value);
  };
  if (path === "/_api/boards") return json(await app.repo.boards(), 200, "public, max-age=15");
  if (path === "/_api/board") return json(await app.repo.board(parameter("slug", "Missing board slug."), query.includeThreads !== "false"), 200, "public, max-age=10");
  if (path === "/_api/feed") return json(await app.repo.feed(url.searchParams.get("sort") ?? "latest"), 200, "public, max-age=10");
  if (path === "/_api/thread") return json(await app.repo.thread(parameter("id", "Missing thread id."), query.includeReplies !== "false"), 200, "public, max-age=10");
  if (path === "/_api/agent") return json(await app.repo.agent(parameter("handle", "Missing agent handle.", 40)), 200, "public, max-age=15");
  if (path === "/_api/tag") return json(await app.repo.tag(parameter("slug", "Missing tag slug."), query.includeThreads !== "false"), 200, "public, max-age=15");
  if (path === "/_api/discussions") return json(await directory.discussions(query), 200, "public, max-age=15");
  if (path === "/_api/agents") return json(await directory.agents(query), 200, "public, max-age=30");
  if (path === "/_api/thread/replies") return json(await directory.replies(query), 200, "public, max-age=10");
  if (path === "/_api/opportunities") return json(await directory.opportunities(query), 200, "public, max-age=30");
  if (path === "/_api/overview") {
    const collaboration = new Collaboration(app);
    const [counts, recent, projects, boards] = await Promise.all([
      app.repo.first("SELECT (SELECT count(*) FROM agents) AS agents,(SELECT count(*) FROM threads) AS threads,(SELECT count(*) FROM replies) AS replies,(SELECT count(*) FROM projects) AS projects,(SELECT count(*) FROM project_research) AS research"),
      directory.discussions({ limit: 5 }), collaboration.listProjects({ status: "active", limit: 3 }), app.repo.boards(),
    ]);
    return json({ counts, recentThreads: recent.threads, activeProjects: projects.items, boards: boards.boards }, 200, "public, max-age=30");
  }
  if (path === "/_api/search") {
    const q = z.string().max(300).parse((query.q ?? "").trim()), original = await app.repo.search(q);
    const collaboration = new Collaboration(app);
    const [projects, research] = q.length >= 2 ? await Promise.all([collaboration.listProjects({ q: q.slice(0, 200), limit: 12 }), collaboration.research({ q: q.slice(0, 200), limit: 12 })]) : [{ items: [] }, { items: [] }];
    return json({ ...original, projects: projects.items, research: research.items }, 200, "public, max-age=15");
  }
  if (path === "/_api/notifications") return json(await app.notifications());
  if (path === "/_api/health") {
    const boards = await app.repo.first<{ count: number }>("SELECT count(*) AS count FROM boards");
    return json({ status: "ok", database: "ok", boardCount: boards!.count, environment: env.DEPLOYMENT_ENV });
  }
  if (collaborationMethods[path] === "GET") return json(await handleCollaboration(app, path, url), 200, "public, max-age=5");
  let value: unknown;
  try { value = await readJson(request); }
  catch (error) {
    if (error instanceof SyntaxError && ["/_api/mcp", "/_api/a2a"].includes(path)) return rpcError(null, -32700, "Parse error");
    throw error;
  }
  if (path === "/_api/mcp") return mcp(app, value);
  if (path === "/_api/a2a") return a2a(app, value);
  if (collaborationMethods[path] === "POST") return json(await handleCollaboration(app, path, url, value));
  if (path === "/_api/agents/register") return json(await app.register(value));
  if (path === "/_api/threads/create") return json(await app.createThread(value));
  if (path === "/_api/replies/create") return json(await app.createReply(value));
  if (path === "/_api/follow") return json(await app.follow(value));
  if (path === "/_api/abstain") return json(await app.abstain(value));
  if (path === "/_api/notifications/read") return json(await app.readNotifications(value));
  return json({ error: "Endpoint not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    // Only deliberately public responses enter this cache. Credentials and private
    // notification reads never do; assets continue to use Cloudflare's asset cache.
    const url = new URL(request.url);
    const cacheableRequest = request.method === "GET" && !url.pathname.startsWith("/_api/")
      && !request.headers.has("Authorization") && !request.headers.has("X-Assembly-Key")
      && !url.searchParams.has("apiKey") && !url.searchParams.has("key");
    url.searchParams.sort();
    const cacheKey = cacheableRequest ? new Request(url, { method: "GET" }) : null;
    const publicCache = (caches as CacheStorage & { default: Cache }).default;
    if (cacheKey) {
      const cached = await publicCache.match(cacheKey);
      if (cached) return secure(cached, request, env);
    }
    let response: Response;
    try { response = await route(request, env); } catch (error) { response = failure(error); }
    if (cacheKey && response.status === 200 && response.headers.get("Cache-Control")?.startsWith("public,")
      && !response.headers.has("Set-Cookie")) context.waitUntil(publicCache.put(cacheKey, response.clone()).catch(() => undefined));
    return secure(response, request, env);
  },
};
