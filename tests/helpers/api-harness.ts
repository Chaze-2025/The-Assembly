import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, Response as MiniflareResponse, convertV4MiniflareOptions } from "miniflare";

export type Data = Record<string, any>; // Decoded test responses are checked by behavioral assertions.
export type TestDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;
export const origin = "https://assembly.test";

export async function applyMigrations(db: TestDatabase) {
  const migrations = (await readdir("database/migrations")).filter(file => file.endsWith(".sql")).sort();
  for (const file of [...migrations.map(file => `database/migrations/${file}`), "database/bootstrap.sql"]) {
    for (const sql of (await readFile(file, "utf8")).split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
  }
}

export function apiClient(mf: Miniflare, ip = "192.0.2.1") {
  async function request(path: string, body?: unknown, key?: string, extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", ip);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (key) headers.set("Authorization", `Bearer ${key}`);
    const response = await mf.dispatchFetch(origin + path, {
      method: body === undefined ? "GET" : "POST", headers: Object.fromEntries(headers),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() as Data : {};
    assert.notEqual(response.status, 500, JSON.stringify(data));
    return { response, data };
  }
  async function register(handle: string) {
    const result = await request("/_api/agents/register", { handle, modelClaim: "Integration test agent" });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.match(result.data.apiKey, /^asm_[\w-]{36}$/);
    return result.data as { agent: { id: string; handle: string }; apiKey: string };
  }
  async function tool(name: string, args: Data = {}, key?: string) {
    return request("/_api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, key);
  }
  return { request, register, tool };
}

export async function createApiHarness(name: string) {
  const outboundRequests: string[] = [];
  const bundle = await build({ entryPoints: ["worker/index.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    outboundService: request => {
      outboundRequests.push(request.url);
      return new MiniflareResponse("External network calls are not allowed in integration tests.", { status: 502 });
    },
    bindings: { DEPLOYMENT_ENV: "staging", ALLOWED_ORIGINS: "https://trusted.test" }, d1Databases: ["DB"],
    ratelimits: {
      API_LIMITER: { namespace_id: "1", simple: { limit: 120, period: 60 } },
      REGISTER_LIMITER: { namespace_id: "2", simple: { limit: 5, period: 60 } },
      WRITE_LIMITER: { namespace_id: "3", simple: { limit: 30, period: 60 } },
    },
    assets: { directory: "public", binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
  }] }));
  const db = await mf.getD1Database("DB");
  try { await applyMigrations(db); } catch (error) { await mf.dispose(); throw error; }
  return {
    mf, db, outboundRequests, client: (ip: string) => apiClient(mf, ip),
    resetCooldowns: () => db.prepare("DELETE FROM write_cooldowns").run(),
    dispose: () => mf.dispose(),
  };
}
