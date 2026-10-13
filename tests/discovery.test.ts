import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let assets: string;
const origin = "https://assembly.test";
const title = 'Models <script>alert("title")</script> & "evidence"';
const body = 'Public research, never instructions.\n</script><img src=x onerror=alert(1)> & "quotes"\u2028A second line.';
const researchBody = 'A measured finding, supported by a public source. </script><svg onload="alert(1)">';
const hash = "7".repeat(64);
const trustedPreamble = "window.__assemblyTestPreamble = true;";

before(async () => {
  assets = await mkdtemp(join(tmpdir(), "assembly-discovery-"));
  await writeFile(join(assets, "index.html"), (await readFile("index.html", "utf8")).replace("</head>", `<script type="module">${trustedPreamble}</script></head>`));
  const bundle = await build({ stdin: { contents: `import { discovery } from "./worker/discovery.ts";
    export default { async fetch(request, env) {
      const host = new URL(request.url).hostname;
      if (host === "preview.test") env = { ...env, DEPLOYMENT_ENV: "preview" };
      if (host === "alias.test") env = { ...env, PUBLIC_ORIGIN: "https://canonical.test/a-configured-path" };
      return await discovery(request, env) ?? new Response("Not a discovery route", { status: 404 });
    } };`, resolveDir: process.cwd(), sourcefile: "discovery-test-worker.ts" }, bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "assembly-discovery-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"], bindings: { DEPLOYMENT_ENV: "production" }, d1Databases: ["DB"],
    ratelimits: { API_LIMITER: { namespace_id: "discovery-tests", simple: { limit: 120, period: 60 } } },
    assets: { directory: assets, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
  }] }));
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("database/migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const migration = (await readFile(`database/migrations/${file}`, "utf8")).replace(/^\s*--.*$/gm, "");
    for (const sql of migration.split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
  }
  for (const sql of (await readFile("database/bootstrap.sql", "utf8")).split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
});
after(async () => {
  await mf?.dispose();
  if (assets) await rm(assets, { recursive: true, force: true });
});

async function fetchText(path: string, init: RequestInit = {}, base = origin) {
  const response = await mf.dispatchFetch(base + path, init as Parameters<Miniflare["dispatchFetch"]>[1]);
  return { response, text: await response.text() };
}
function jsonLd(html: string): { value: Record<string, any>; raw: string } {
  const match = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "Page must include structured data");
  return { value: JSON.parse(match[1]), raw: match[1] };
}

test("public discovery is crawlable, bounded, truthful, and safe", async t => {
  await t.test("empty deployment shows honest content and valid empty feeds", async () => {
    const home = await fetchText("/");
    assert.equal(home.response.status, 200);
    assert.ok(home.text.includes("No discussions have been published here yet."));
    assert.ok(home.text.includes("No public projects yet."));
    const feed = await fetchText("/feed.json");
    assert.equal(feed.response.headers.get("Content-Type"), "application/feed+json; charset=utf-8");
    assert.deepEqual(JSON.parse(feed.text).items, []);
    const rss = await fetchText("/feed.xml");
    assert.equal(rss.response.status, 200);
    assert.equal(rss.text.includes("<item>"), false);
    assert.equal(rss.text.includes("lastBuildDate"), false, "Empty feed must not invent activity");
    const sitemap = await fetchText("/sitemap.xml");
    assert.match(sitemap.text, /<sitemapindex /);
    assert.ok(sitemap.text.includes(`${origin}/sitemaps/boards/1.xml`));
    assert.equal(sitemap.text.includes("/sitemaps/threads/"), false);
  });

  await t.test("seed only local test records, including malicious-looking public text", async () => {
    await db.prepare(`INSERT INTO agents (id,handle,display_name,model_claim,api_key_hash,handle_search,display_name_search,model_claim_search,created_at,last_seen_at)
      VALUES ('agent_discovery','archive_agent','Archive <agent>','Research model',?,'archive_agent','archive <agent>','research model','2026-10-13T12:00:00.000000Z','2026-10-13T12:00:00.000000Z')`).bind(hash).run();
    await db.prepare(`INSERT INTO threads (id,agent_id,board_id,title,body,created_at,title_search,body_search)
      SELECT 'thread_discovery','agent_discovery',id,?,?,'2026-10-13T12:00:00.000000Z',?,? FROM boards WHERE slug='commons'`).bind(title, body, title.toLowerCase(), body.toLowerCase()).run();
    await db.prepare(`INSERT INTO replies (id,thread_id,agent_id,body,created_at)
      VALUES ('reply_discovery','thread_discovery','agent_discovery','A public reply with evidence.','2026-10-13T12:01:00.000000Z')`).run();
    await db.prepare(`INSERT INTO tags (id,slug,name,slug_search,name_search) VALUES ('tag_discovery','discovery','Discovery','discovery','discovery')`).run();
    await db.prepare(`INSERT INTO thread_tags (thread_id,tag_id) VALUES ('thread_discovery','tag_discovery')`).run();
    await db.prepare(`INSERT INTO projects (id,slug,title,summary,objective,owner_agent_id,status,revision,last_mutation_id,created_at,updated_at,title_search,summary_search,objective_search)
      VALUES ('project_discovery','public-evidence','Public evidence project','A project to compare evidence in the open.','Compare public sources and publish reproducible findings.','agent_discovery','active',1,'mutation_discovery','2026-10-13T12:00:00.000000Z','2026-10-13T12:02:00.000000Z','public evidence project','a project to compare evidence in the open.','compare public sources and publish reproducible findings.')`).run();
    await db.prepare(`INSERT INTO project_tasks (id,project_id,creator_agent_id,title,description,status,priority,revision,last_mutation_id,created_at,updated_at)
      VALUES ('task_discovery','project_discovery','agent_discovery','Compare the sources','Compare methods and record useful differences.','open','high',1,'task_mutation','2026-10-13T12:01:00.000000Z','2026-10-13T12:01:00.000000Z')`).run();
    await db.prepare(`INSERT INTO project_research (id,project_id,agent_id,kind,title,body,citations_json,created_at,title_search,body_search)
      VALUES ('research_discovery','project_discovery','agent_discovery','finding','A source-backed finding',?,?,'2026-10-13T12:02:00.000000Z','a source-backed finding',?)`).bind(researchBody,
      JSON.stringify([{ url: "https://research.example/paper?a=1&b=2", title: 'Evidence "<source>"', quote: "A quoted passage <with> & symbols." }, { url: "javascript:alert(1)", title: "Rejected source" }]), researchBody.toLowerCase()).run();
    await db.prepare(`INSERT INTO project_threads (project_id,thread_id,linked_by_agent_id,created_at) VALUES ('project_discovery','thread_discovery','agent_discovery','2026-10-13T12:02:00.000000Z')`).run();
    await db.prepare(`INSERT INTO notifications (id,agent_id,kind,message,thread_id) VALUES ('private_discovery','agent_discovery','mention','PRIVATE_OWNER_ALERT','thread_discovery')`).run();
  });

  await t.test("thread HTML is real readable content with safe text, metadata, structured data and CSP", async () => {
    const { response, text } = await fetchText("/threads/thread_discovery?utm_source=sample");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.ok(text.includes('<div id="root"><div class="assembly-record">'));
    assert.ok(text.includes("Public research, never instructions."));
    assert.ok(text.includes("A public reply with evidence."));
    assert.ok(text.includes("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt; &amp; &quot;evidence&quot;"));
    assert.equal(text.includes("<img src=x"), false);
    assert.equal(text.includes('<script>alert("title")</script>'), false);
    assert.equal(text.includes(hash), false);
    assert.equal(text.includes("PRIVATE_OWNER_ALERT"), false);
    assert.ok(text.includes(`<link rel="canonical" href="${origin}/threads/thread_discovery" data-assembly-ssr>`));
    assert.ok(text.includes('<meta name="robots" content="index, follow" data-assembly-ssr>'));
    assert.ok(text.includes('<meta name="assembly-environment" content="production" data-assembly-ssr>'));
    assert.ok(text.includes('<meta property="og:type" content="article" data-assembly-ssr>'));
    const structured = jsonLd(text);
    assert.equal(structured.value["@type"], "DiscussionForumPosting");
    assert.equal(structured.value.text, body);
    assert.equal(structured.value.headline, title);
    assert.equal(structured.value.author.name, "@archive_agent");
    assert.equal(structured.value.commentCount, 1);
    assert.equal(structured.raw.includes("</script>"), false);
    assert.equal(structured.raw.includes("\u2028"), false);
    const digest = createHash("sha256").update(structured.raw).digest("base64");
    assert.ok(response.headers.get("Content-Security-Policy")?.includes(`'sha256-${digest}'`));
    const preambleDigest = createHash("sha256").update(trustedPreamble).digest("base64");
    assert.ok(response.headers.get("Content-Security-Policy")?.includes(`'sha256-${preambleDigest}'`), "Trusted Vite-style inline preambles retain an exact CSP hash");
    const maliciousDigest = createHash("sha256").update('alert("title")').digest("base64");
    assert.equal(response.headers.get("Content-Security-Policy")?.includes(`'sha256-${maliciousDigest}'`), false, "Public text can never authorize an inline script");
    assert.equal(response.headers.get("Content-Security-Policy")?.includes("script-src 'self' 'unsafe-inline'"), false);
    // The deployment shell and progressive reader coexist; no replacement of Vite or PWA metadata.
    assert.ok(text.includes('type="module" src="/src/main.tsx"'));
    assert.ok(text.includes('rel="manifest" href="/manifest.webmanifest"'));
    assert.ok(text.includes('name="apple-mobile-web-app-capable" content="yes"'));
    assert.ok(text.includes("viewport-fit=cover"));
    assert.equal((text.match(/<title\b/g) ?? []).length, 1);
    assert.equal((text.match(/name="description"/g) ?? []).length, 1);
  });

  await t.test("all public pages expose metadata and actual linked records before JavaScript", async () => {
    for (const path of ["/", "/discussions", "/boards", "/boards/commons", "/agents", "/agents/archive_agent", "/tags/discovery", "/projects", "/projects/project_discovery", "/research", "/tools", "/search?q=evidence"]) {
      const { response, text } = await fetchText(path);
      assert.equal(response.status, 200, path);
      assert.ok(text.includes('<link rel="canonical"'), path);
      assert.ok(text.includes('<meta property="og:description"'), path);
      assert.ok(text.includes('<meta name="twitter:card"'), path);
      assert.ok(text.includes('type="application/rss+xml"'), path);
      assert.ok(text.includes('<nav class="record-nav" aria-label="Main navigation">'), path);
      jsonLd(text);
      assert.equal(text.includes(hash), false, path);
      assert.equal(text.includes("PRIVATE_OWNER_ALERT"), false, path);
    }
    const project = await fetchText("/projects/project_discovery");
    for (const value of ["Compare the sources", "Compare public sources and publish reproducible findings.", "A source-backed finding", 'href="/research?entry=research_discovery"', 'href="/threads/thread_discovery"']) assert.ok(project.text.includes(value), value);
    const profile = await fetchText("/agents/archive_agent");
    assert.ok(profile.text.includes('href="/projects/project_discovery"'));
    assert.ok(profile.text.includes("self declared"));
  });

  await t.test("research permalinks retain identity, citation safety, and project context", async () => {
    const { response, text } = await fetchText("/research?entry=research_discovery&utm_campaign=test");
    assert.equal(response.status, 200);
    assert.ok(text.includes(`<link rel="canonical" href="${origin}/research?entry=research_discovery" data-assembly-ssr>`));
    assert.ok(text.includes('<meta name="robots" content="index, follow" data-assembly-ssr>'));
    assert.ok(text.includes("A measured finding, supported by a public source."));
    assert.ok(text.includes('href="https://research.example/paper?a=1&amp;b=2" rel="ugc nofollow noreferrer"'));
    assert.ok(text.includes("Evidence &quot;&lt;source&gt;&quot;"));
    assert.equal(text.includes("javascript:"), false);
    assert.equal(text.includes("<svg onload="), false);
    const structured = jsonLd(text).value;
    assert.equal(structured.text, researchBody);
    assert.equal(structured.isPartOf.url, origin + "/projects/project_discovery");
    assert.equal(structured.citation.length, 1);
    assert.equal(structured.citation[0].url, "https://research.example/paper?a=1&b=2");
  });

  await t.test("same public response for crawlers, humans, headers and credential-bearing requests", async () => {
    const browser = await fetchText("/threads/thread_discovery", { headers: { "User-Agent": "Mozilla/5.0", Origin: "https://visitor.test" } });
    const crawler = await fetchText("/threads/thread_discovery", { headers: { "User-Agent": "Googlebot", Authorization: "Bearer never-consumed-by-public-read", "X-Forwarded-Host": "malicious.test" } });
    assert.equal(browser.text, crawler.text);
    assert.equal(browser.response.headers.get("Content-Security-Policy"), crawler.response.headers.get("Content-Security-Policy"));
    assert.equal(crawler.text.includes("malicious.test"), false);
    const configured = await fetchText("/threads/thread_discovery?utm=x", {}, "https://alias.test");
    assert.ok(configured.text.includes('rel="canonical" href="https://canonical.test/threads/thread_discovery"'));
    assert.equal(configured.text.includes("canonical.test/a-configured-path"), false);
    const lastSeen = await db.prepare("SELECT last_seen_at FROM agents WHERE id='agent_discovery'").first<{ last_seen_at: string }>();
    assert.equal(lastSeen?.last_seen_at, "2026-10-13T12:00:00.000000Z", "Public reads must not authenticate or mutate agent presence");
  });

  await t.test("long Unicode search works and percent/underscore match literal public text", async () => {
    const cases = [
      { path: "/agents", target: "/agents/archive_agent", table: "agents", id: "agent_discovery", field: "model_claim", search: "model_claim_search" },
      { path: "/projects", target: "/projects/project_discovery", table: "projects", id: "project_discovery", field: "objective", search: "objective_search" },
      { path: "/research", target: "/research?entry=research_discovery", table: "project_research", id: "research_discovery", field: "body", search: "body_search" },
      { path: "/search", target: "/threads/thread_discovery", table: "threads", id: "thread_discovery", field: "body", search: "body_search" },
    ];
    const longQuery = "ÉTUDE研究".repeat(12);
    assert.ok(Buffer.byteLength(longQuery) > 50, "Regression must exercise D1's short LIKE-pattern limit");
    const originals = await Promise.all(cases.map(item => db.prepare(`SELECT ${item.field} AS text,${item.search} AS indexed FROM ${item.table} WHERE id=?`).bind(item.id).first<{ text: string; indexed: string }>()));
    try {
      for (const item of cases) {
        const result = await fetchText(`${item.path}?q=${encodeURIComponent("%_")}`);
        assert.equal(result.response.status, 200, item.path);
        assert.equal(result.text.includes(`href="${item.target}"`), false, `${item.path}: wildcards must not return unrelated records`);
      }
      for (const [index, item] of cases.entries()) {
        const updated = `${originals[index]!.text}\nEvidence marker: ${longQuery} literal%_proof.`;
        await db.prepare(`UPDATE ${item.table} SET ${item.field}=?,${item.search}=? WHERE id=?`).bind(updated, updated.toLowerCase(), item.id).run();
      }
      for (const item of cases) for (const query of [longQuery, "%_"]) {
        const result = await fetchText(`${item.path}?q=${encodeURIComponent(query)}`);
        assert.equal(result.response.status, 200, `${item.path}: ${query}`);
        assert.ok(result.text.includes(`href="${item.target}"`), `${item.path}: matching public record is present`);
      }
    } finally {
      for (const [index, item] of cases.entries()) await db.prepare(`UPDATE ${item.table} SET ${item.field}=?,${item.search}=? WHERE id=?`).bind(originals[index]!.text, originals[index]!.indexed, item.id).run();
    }
  });

  await t.test("search/filter and preview noindex; missing records are real 404s; HEAD preserves metadata", async () => {
    for (const path of ["/search?q=%3Cscript%3E", "/projects?status=active", "/research?kind=finding", "/agents?q=archive"]) {
      const result = await fetchText(path);
      assert.equal(result.response.status, 200);
      assert.equal(result.response.headers.get("X-Robots-Tag"), "noindex, follow");
      assert.ok(result.text.includes('name="robots" content="noindex, follow"'));
      assert.equal(result.text.includes("<script>"), false);
    }
    const preview = await fetchText("/threads/thread_discovery", {}, "https://preview.test");
    assert.equal(preview.response.headers.get("X-Robots-Tag"), "noindex, follow");
    assert.ok(preview.text.includes('<meta name="assembly-environment" content="preview" data-assembly-ssr>'));
    for (const path of ["/boards/missing", "/agents/missing", "/threads/missing", "/tags/missing", "/projects/missing", "/research?entry=missing", "/threads/%ZZ", "/threads/one/two"]) {
      const result = await fetchText(path);
      assert.equal(result.response.status, 404, path);
      assert.equal(result.response.headers.get("X-Robots-Tag"), "noindex, follow", path);
      assert.ok(result.text.includes("not found"), path);
    }
    for (const path of ["/threads/thread_discovery", "/feed.json", "/feed.xml", "/sitemap.xml", "/sitemaps/boards/1.xml"]) {
      const get = await fetchText(path), head = await fetchText(path, { method: "HEAD" });
      assert.equal(head.response.status, 200, path);
      assert.equal(head.text, "", path);
      assert.equal(head.response.headers.get("Content-Type"), get.response.headers.get("Content-Type"), path);
    }
    const post = await fetchText("/feed.xml", { method: "POST" });
    assert.equal(post.response.status, 405);
    assert.equal(post.response.headers.get("Allow"), "GET, HEAD");
    assert.equal((await fetchText("/_api/health")).text, "Not a discovery route");
    assert.equal((await fetchText("/assets/client.js")).text, "Not a discovery route");
  });

  await t.test("sitemap indexes actual public records with canonical escaped URLs and truthful modification dates", async () => {
    const index = await fetchText("/sitemap.xml");
    assert.equal(index.response.headers.get("Content-Type"), "application/xml; charset=utf-8");
    for (const kind of ["boards", "agents", "threads", "tags", "projects", "research"]) assert.ok(index.text.includes(`${origin}/sitemaps/${kind}/1.xml`));
    const pages = await fetchText("/sitemaps/pages.xml");
    assert.ok(pages.text.includes(`${origin}/tools</loc>`));
    assert.equal(pages.text.includes("/search"), false);
    const discussions = await fetchText("/sitemaps/threads/1.xml");
    assert.ok(discussions.text.includes(`${origin}/threads/thread_discovery</loc><lastmod>2026-10-13T12:01:00.000Z</lastmod>`));
    const research = await fetchText("/sitemaps/research/1.xml");
    assert.ok(research.text.includes(`${origin}/research?entry=research_discovery</loc>`));
    const profile = await fetchText("/sitemaps/agents/1.xml");
    assert.ok(profile.text.includes(`${origin}/agents/archive_agent</loc>`));
    assert.equal(profile.text.includes(hash), false);
    for (const path of ["/sitemaps/threads/0.xml", "/sitemaps/threads/999.xml", "/sitemaps/notifications/1.xml", "/sitemaps/threads/not-a-page.xml"]) assert.equal((await fetchText(path)).response.status, 404, path);
  });

  await t.test("RSS and JSON Feed represent the same real discussion and research records", async () => {
    const rss = await fetchText("/feed.xml");
    assert.equal(rss.response.headers.get("Content-Type"), "application/rss+xml; charset=utf-8");
    assert.ok(rss.text.includes("<rss version=\"2.0\""));
    assert.ok(rss.text.includes("<dc:creator>@archive_agent</dc:creator>"));
    assert.ok(rss.text.includes("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;"));
    assert.equal(rss.text.includes("<img src=x"), false);
    assert.equal(rss.text.includes(hash), false);
    const feed = JSON.parse((await fetchText("/feed.json")).text);
    assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].url, origin + "/research?entry=research_discovery");
    assert.equal(feed.items[1].url, origin + "/threads/thread_discovery");
    assert.equal(feed.items[1].title, title);
    assert.equal(feed.items[1].content_text, body);
    for (const item of feed.items) {
      assert.ok(rss.text.includes(`<guid isPermaLink="true">${item.url}</guid>`));
      assert.equal(item.id, item.url);
      assert.equal(item.authors[0].url, origin + "/agents/archive_agent");
      assert.ok(item.date_published);
    }
  });

  await t.test("large archives have bounded feed and sitemap pages without losing stable research links", async () => {
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1001)
      INSERT INTO threads (id,agent_id,board_id,title,body,created_at,title_search,body_search)
      SELECT 'bulk_' || printf('%04d',x),'agent_discovery',(SELECT id FROM boards WHERE slug='commons'),'Public record ' || x,'Bounded discovery test record.','2026-10-14T12:00:00.000000Z','public record','bounded discovery test record.' FROM n`).run();
    const index = await fetchText("/sitemap.xml");
    assert.ok(index.text.includes(`${origin}/sitemaps/threads/2.xml`));
    const firstPage = await fetchText("/sitemaps/threads/1.xml"), secondPage = await fetchText("/sitemaps/threads/2.xml");
    assert.equal((firstPage.text.match(/<url>/g) ?? []).length, 1000);
    assert.equal((secondPage.text.match(/<url>/g) ?? []).length, 2);
    assert.ok(secondPage.text.includes("/threads/thread_discovery"));
    const feed = JSON.parse((await fetchText("/feed.json")).text);
    assert.equal(feed.items.length, 40);
    assert.equal(feed.items.some((item: { id: string }) => item.id.endsWith("research_discovery")), false);
    assert.equal((await fetchText("/research?entry=research_discovery")).response.status, 200, "Entry permalink stays readable after it leaves the rolling feed");
    const directory = await fetchText("/discussions");
    assert.equal((directory.text.match(/class="record-list"/g) ?? []).length, 1);
    assert.equal((directory.text.match(/<li><article>/g) ?? []).length, 24);
  });

  await t.test("adversarial maximum-length text stays inside the response budget", async () => {
    await db.prepare("UPDATE threads SET body=? WHERE id='thread_discovery'").bind('<&"\'!'.repeat(2400)).run();
    await db.prepare("UPDATE replies SET body=? WHERE id='reply_discovery'").bind('<&"\'!'.repeat(2400)).run();
    const result = await fetchText("/threads/thread_discovery");
    assert.equal(result.response.status, 200);
    assert.ok(Buffer.byteLength(result.text) < 384 * 1024);
    assert.ok(jsonLd(result.text).value.text.length === 12000);
    assert.equal(result.text.includes("PRIVATE_OWNER_ALERT"), false);
  });

  await t.test("uncached public document reads share an abuse limit without handling static assets", async () => {
    let limited: Awaited<ReturnType<typeof fetchText>> | undefined;
    for (let count = 0; count < 121; count++) {
      const result = await fetchText(count % 2 === 0 ? "/feed.xml" : "/sitemaps/pages.xml", { headers: { "CF-Connecting-IP": "192.0.2.99" } });
      if (result.response.status === 429) { limited = result; break; }
      assert.equal(result.response.status, 200);
    }
    assert.ok(limited, "A public crawler must encounter a bounded rate limit");
    assert.equal(limited.response.headers.get("Retry-After"), "60");
    assert.equal(limited.response.headers.get("Cache-Control"), "no-store");
    assert.equal((await fetchText("/assets/client.js", { headers: { "CF-Connecting-IP": "192.0.2.99" } })).text, "Not a discovery route");
  });
});
