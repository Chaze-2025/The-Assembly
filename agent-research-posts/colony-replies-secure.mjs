import crypto from "node:crypto";
import fs from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = "Chaze-2025/The-Assembly";
const BRANCH = "agent-forum-outreach-20261013";
const SESSION = "colony-reply-session-20261014-ns-sat";
const PUBLIC_PATH = "agent-research-posts/colony-reply-public-key.json";
const HANDOFF_PATH = "agent-research-posts/colony-reply-sealed.json";
const ORIGIN = "https://thecolony.ai";
const EXPECTED_HANDLE = "assembly-frontier-research-26";
const tasks = JSON.parse(await fs.readFile("agent-research-posts/colony-replies-20261014.json","utf8")).tasks;

function log(obj) { console.log("COLONY_REPLY_RESULT:" + JSON.stringify(obj)); }
async function github(file, options = {}) {
  const url = "https://api.github.com/repos/" + REPO + "/contents/" + file + (options.method === "PUT" ? "" : "?ref=" + BRANCH);
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(18000),
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + process.env.GH_REPO_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function colony(route, options = {}) {
  const response = await fetch(ORIGIN + route, {
    ...options,
    signal: AbortSignal.timeout(18000),
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AssemblyFrontierResearch/1.0 (operator-directed)",
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
    retry: response.headers.get("retry-after")
  };
}
function commentsOf(data) {
  const j = data.data || data;
  return j.comments || j.items || j.results || [];
}
function commentBody(c) { return c.body || c.content || c.text || ""; }
function commentAuthor(c) {
  return String(c.author?.username || c.author?.name || c.user?.username || c.username || c.author_handle || c.agent?.username || c.author_name || "");
}
async function main() {
  if (!process.env.GH_REPO_TOKEN) throw Error("Missing temporary workflow token");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" }
  });
  const manifest = { session: SESSION, public_key: publicKey, notice: "Public encryption key, no account secrets." };
  const written = await github(PUBLIC_PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      branch: BRANCH,
      message: "Publish public key for one-time Colony reply session",
      content: Buffer.from(JSON.stringify(manifest)).toString("base64")
    })
  });
  if (!written.ok) { log({stage:"public_key_write_failed",http:written.status,message:written.data.message?.slice(0,120)}); return; }
  log({ stage: "public_key_ready", session: SESSION });
  let handoff = null;
  for (let tries = 0; tries < 65; tries++) {
    const r = await github(HANDOFF_PATH);
    if (r.ok) {
      try {
        const j = JSON.parse(Buffer.from(r.data.content.replace(/\s/g,""),"base64").toString("utf8"));
        if (j.session === SESSION && typeof j.encrypted_api_key === "string") { handoff = j; break; }
      } catch {}
    }
    await sleep(4300);
  }
  if (!handoff) { log({ stage: "handoff_timeout" }); return; }
  let apiKey;
  try {
    apiKey = crypto.privateDecrypt({
      key: privateKey, oaepHash: "sha256", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    }, Buffer.from(handoff.encrypted_api_key,"base64")).toString("utf8");
  } catch {
    log({ stage: "handoff_decryption_failed" }); return;
  }
  if (!apiKey.startsWith("col_") || apiKey.length < 40) { log({ stage: "invalid_key" }); return; }
  const auth = await colony("/api/v1/auth/token", {
    method: "POST", body: JSON.stringify({ api_key: apiKey })
  });
  apiKey = null;
  if (!auth.ok || !auth.data.access_token) {
    log({ stage: "auth_failed",http:auth.status,code:auth.data.code || auth.data.error || null }); return;
  }
  const jwt = auth.data.access_token;
  const who = await colony("/api/v1/users/me", { headers: { Authorization: "Bearer " + jwt } });
  const account = who.data.user || who.data.data || who.data;
  const username = account.username || account.name || "";
  if (who.ok && username && username !== EXPECTED_HANDLE) {
    log({ stage: "identity_mismatch", expected: EXPECTED_HANDLE, actual: String(username).slice(0,80) }); return;
  }
  log({ stage: "authenticated", handle: username || EXPECTED_HANDLE });
  for (const task of tasks) {
    const route = "/api/v1/posts/" + task.postId + "/comments";
    const before = await colony(route + "?limit=100");
    if (!before.ok) {
      log({ stage: "comments_lookup_failed", challenge: task.challenge, http: before.status }); continue;
    }
    const items = commentsOf(before.data);
    const candidates = items.filter(c => commentBody(c).toLowerCase().includes(task.originalNeedle.toLowerCase()));
    const match = candidates.find(c => commentAuthor(c).toLowerCase().replace(/\s/g,"").includes(task.targetAuthor.toLowerCase()))
      || (candidates.length === 1 ? candidates[0] : null);
    if (!match) {
      log({ stage: "target_comment_not_found", challenge:task.challenge,
        authors: items.map(commentAuthor).slice(0,10), comments: items.length });
      continue;
    }
    if (items.some(c => commentBody(c) === task.body)) {
      log({stage:"already_replied",challenge:task.challenge,url:ORIGIN+"/posts/"+task.postId}); continue;
    }
    const sent = await colony(route, {
      method: "POST", headers: { Authorization:"Bearer "+jwt }, body:JSON.stringify({body:task.body})
    });
    if (!sent.ok) {
      log({stage:"reply_rejected",challenge:task.challenge,http:sent.status,
        code:sent.data.code||sent.data.error||sent.data.detail||null,retry_after:sent.retry}); continue;
    }
    const id = sent.data.id || sent.data.comment?.id || sent.data.data?.id || null;
    const held = sent.data.held === true || sent.data.comment?.held === true;
    await sleep(1700);
    const after = await colony(route+"?limit=100");
    const item = commentsOf(after.data).find(c => commentBody(c) === task.body);
    log({stage:held?"reply_held":item?"reply_verified":"reply_submitted_unverified",
      challenge:task.challenge,post_id:task.postId,comment_id:item?.id||id,
      post_url:ORIGIN+"/posts/"+task.postId,reply_length:task.body.length,http:after.status});
    await sleep(7500);
  }
}
main().catch(e=>log({stage:"fatal",message:String(e).slice(0,180)}));