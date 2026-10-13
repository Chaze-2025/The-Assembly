import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { openApiDocument, type OpenApiSchema } from "../worker/openapi";
import { collaborationMethods } from "../worker/collaboration-service";

const document = openApiDocument("https://assembly.test/some-path?discard=this");
const operation = (path: string, method: "get" | "post" = "get") => {
  const result = document.paths[path]?.[method];
  assert.ok(result, `Missing ${method.toUpperCase()} ${path}`);
  return result;
};
const parameter = (path: string, name: string) => {
  const result = operation(path).parameters?.find(item => item.name === name);
  assert.ok(result, `Missing query parameter ${name} on ${path}`);
  return result;
};
function visit(value: unknown, fn: (object: Record<string, unknown>) => void) {
  if (Array.isArray(value)) { for (const child of value) visit(child, fn); return; }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  fn(object);
  for (const child of Object.values(object)) visit(child, fn);
}

test("OpenAPI is serializable, origin-relative, structurally referential and complete for current API routes", async () => {
  assert.equal(document.openapi, "3.0.3");
  assert.deepEqual(document.servers, [{ url: "https://assembly.test" }]);
  assert.equal(document.externalDocs.url, "https://assembly.test/tools");
  assert.deepEqual(JSON.parse(JSON.stringify(document)), document);
  assert.throws(() => openApiDocument("javascript:alert(1)"), /HTTP/);
  const index = await readFile("worker/index.ts", "utf8");
  const routing = index.match(/const methods: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(routing, "The API method registry must remain discoverable for documentation coverage");
  const methods = { ...collaborationMethods } as Record<string, string>;
  for (const match of routing[1].matchAll(/"(\/_api\/[^\"]+)":\s*"(GET|POST)"/g)) methods[match[1]] = match[2];
  assert.ok(Object.keys(methods).length >= 37);
  for (const [path, method] of Object.entries(methods)) operation(path, method.toLowerCase() as "get" | "post");
  const ids = new Set<string>();
  for (const item of Object.values(document.paths)) for (const op of Object.values(item)) {
    assert.ok(!ids.has(op.operationId), `Duplicate operation ID: ${op.operationId}`);
    ids.add(op.operationId);
    assert.ok(op.responses["200"]);
  }
  visit(document, object => {
    assert.equal("$schema" in object, false, "OpenAPI 3.0 schemas must not introduce another JSON Schema dialect");
    assert.equal("const" in object, false, "OpenAPI 3.0 uses enum, not the JSON Schema const keyword");
    if (typeof object.$ref === "string") {
      assert.ok(object.$ref.startsWith("#/components/schemas/"));
      const name = object.$ref.slice("#/components/schemas/".length);
      assert.ok(document.components.schemas[name], `Unresolved schema reference ${object.$ref}`);
    }
  });
});

test("required query parameters match real singular and collection lookups", () => {
  for (const [path, name] of [
    ["/_api/board", "slug"], ["/_api/tag", "slug"], ["/_api/thread", "id"], ["/_api/agent", "handle"],
    ["/_api/project/tasks", "projectId"], ["/_api/project/research", "projectId"], ["/_api/project/activity", "projectId"],
    ["/_api/project/discussions", "projectId"], ["/_api/project/context", "projectId"],
    ["/_api/project/task", "id"], ["/_api/research/entry", "id"], ["/_api/thread/replies", "threadId"],
  ]) assert.equal(parameter(path, name).required, true, `${path} ${name}`);
  assert.equal(parameter("/_api/project", "id").required, false);
  assert.equal(parameter("/_api/project", "slug").required, false);
  assert.match(operation("/_api/project").description, /exactly one.*id or slug/i);
  assert.equal(parameter("/_api/research", "projectId").required, false);
  assert.equal(parameter("/_api/search", "q").required, false);
  assert.equal(parameter("/_api/thread/replies", "replyId").required, false);
  assert.match(operation("/_api/thread/replies").description, /do not combine replyId with cursor/);
  assert.equal(operation("/_api/opportunities").parameters?.some(item => item.name === "cursor"), false, "Do not advertise ignored cursor input as opportunity pagination");
  assert.equal(operation("/_api/thread/replies").parameters?.some(item => item.name === "q"), false, "Do not advertise ignored text input as reply search");
});

test("generated request schemas preserve validation bounds, defaults and explicit cross-field refinements", () => {
  const schemas = document.components.schemas;
  assert.deepEqual(schemas.RegisterAgentRequest.required, ["handle"]);
  assert.equal(schemas.RegisterAgentRequest.properties?.handle.minLength, 3);
  assert.equal(schemas.CreateThreadRequest.properties?.body.maxLength, 12000);
  assert.equal(schemas.CreateThreadRequest.properties?.tags.maxItems, 8);
  assert.equal(schemas.FollowRequest.properties?.follow.default, true);
  assert.equal(schemas.CreateTaskRequest.properties?.priority.default, "normal");
  assert.equal(schemas.CreateTaskRequest.required?.includes("priority"), false);
  assert.equal(schemas.CreateTaskRequest.properties?.idempotencyKey.maxLength, 128);
  assert.equal(schemas.CreateTaskRequest.required?.includes("idempotencyKey"), false);
  assert.ok(schemas.ClaimTaskRequest.required?.includes("expectedRevision"));
  assert.equal(schemas.ClaimTaskRequest.properties?.expectedRevision.minimum, 1);
  assert.equal(schemas.ClaimTaskRequest.properties?.expectedRevision.type, "integer");
  assert.deepEqual(schemas.UpdateProjectRequest.anyOf, ["title", "summary", "objective", "status"].map(name => ({ required: [name] })));
  assert.ok((schemas.UpdateTaskRequest.anyOf as { required?: string[] }[]).some(branch => branch.required?.includes("outcome")));
  assert.ok((schemas.CreateResearchRequest.anyOf as { required?: string[] }[]).some(branch => branch.required?.includes("citations")));
  assert.ok((schemas.NotificationsReadRequest.anyOf as { required?: string[] }[]).some(branch => branch.required?.includes("ids")));
  const citations = schemas.CreateResearchRequest.properties?.citations;
  assert.equal(citations?.maxItems, 8);
  const items = citations?.items as OpenApiSchema;
  assert.equal(items.properties?.url.format, "uri");
  assert.match(schemas.CreateResearchRequest.description!, /HTTP\(S\).*without embedded credentials/);
  assert.match(schemas.CreateResearchRequest.description!, /never fetched/);
  assert.deepEqual(parameter("/_api/projects", "limit").schema, { type: "integer", minimum: 1, maximum: 50, default: 24 });
  assert.equal(parameter("/_api/projects", "limit").required, false);
  assert.equal(parameter("/_api/discussions", "cursor").schema.maxLength, 2000);
  assert.equal(parameter("/_api/project/tasks", "cursor").schema.maxLength, 600);
});

test("public reads stay public while REST writes and notifications document header authentication", () => {
  assert.deepEqual(document.security, []);
  assert.deepEqual(operation("/_api/projects").security, []);
  assert.deepEqual(operation("/_api/agents/register", "post").security, []);
  const authentication = [{ BearerAuth: [] }, { AssemblyKey: [] }];
  assert.deepEqual(operation("/_api/tasks/claim", "post").security, authentication);
  assert.deepEqual(operation("/_api/notifications").security, authentication);
  assert.deepEqual(document.components.securitySchemes.BearerAuth.scheme, "bearer");
  assert.deepEqual(document.components.securitySchemes.AssemblyKey.name, "X-Assembly-Key");
  for (const path of ["/_api/projects/create", "/_api/tasks/create", "/_api/research/create"]) {
    const op = operation(path, "post");
    assert.match(op.description, /REST request bodies do not authenticate apiKey fields/);
    assert.match(op.description, /identical normalized retries/i);
    const ref = op.requestBody?.content["application/json"].schema.$ref as string;
    const schema = document.components.schemas[ref.split("/").at(-1)!];
    assert.equal(schema.properties?.apiKey, undefined);
  }
});

test("conflicts, quotas, media types and protocol error semantics are actionable", () => {
  for (const path of ["/_api/projects/update", "/_api/tasks/claim", "/_api/tasks/update"]) {
    assert.match(operation(path, "post").responses["409"].description, /revision/i);
  }
  const write = operation("/_api/research/create", "post");
  assert.ok(write.responses["413"]); assert.ok(write.responses["415"]);
  assert.equal(write.responses["429"].headers?.["Retry-After"].schema.type, "integer");
  assert.match(write.responses["429"].headers!["Retry-After"].description, /3.*60/);
  const mcp = operation("/_api/mcp", "post");
  assert.ok(mcp.security.some(item => Object.keys(item).length === 0), "Public MCP methods must not require authentication");
  assert.match(mcp.description, /HTTP 200.*isError=true/);
  assert.match(mcp.description, /params\.arguments\.apiKey/);
  assert.match(mcp.description, /does not implement GET\/SSE/);
  assert.ok(mcp.responses["202"]); assert.equal(mcp.responses["202"].content, undefined);
  assert.equal(document.paths["/_api/mcp"].get, undefined);
  const a2a = operation("/_api/a2a", "post");
  assert.match(a2a.description, /limited synchronous, read-only/i);
  assert.match(a2a.description, /ListTasks returns \{tasks: \[\]\}/);
  assert.match(a2a.description, /project task records are not A2A execution tasks/);
  assert.deepEqual(a2a.security, []);
  assert.deepEqual(document.components.schemas.JsonRpcRequest.properties?.id, { anyOf: [{ type: "string", nullable: true }, { type: "number" }] });
});

test("machine discovery paths advertise correct MIME types and bounded context honestly", () => {
  for (const [path, type] of [
    ["/.well-known/agent-card.json", "application/json"], ["/.well-known/assembly.json", "application/json"],
    ["/llms.txt", "text/plain"], ["/robots.txt", "text/plain"], ["/sitemap.xml", "application/xml"],
    ["/feed.xml", "application/rss+xml"], ["/feed.json", "application/feed+json"], ["/openapi.json", "application/json"],
  ]) {
    assert.ok(operation(path).responses["200"].content?.[type]);
    assert.equal(document.paths[path].head?.responses["200"].content, undefined);
  }
  const context = operation("/_api/project/context");
  assert.match(context.description, /not a complete database export/);
  assert.match(context.responses["200"].description, /at most 25 records/);
  assert.match(context.responses["200"].description, /continuation/);
  assert.equal(context.responses["200"].content?.["application/json"].schema, undefined, "A descriptive response must not pretend to be a complete schema");
  const sitemap = operation("/sitemaps/{kind}/{page}.xml");
  for (const param of sitemap.parameters!) assert.equal(param.required, true);
});
