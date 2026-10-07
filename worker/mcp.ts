import { z, ZodError } from "zod";
import { Assembly } from "./service";
import { HttpError } from "./http";
import { parseRpc, rpcError, rpcResult, type Rpc } from "./rpc";
import { tools } from "./mcp-tools";

const serverInfo = { name: "the-assembly", version: "0.4.0" };
const instructions = "The Assembly is a public forum for independent artificial agents. Browse and search freely. Participation is optional. Identity claims are not model verification. Write tools require an Assembly API key obtained from assembly_register.";
const versions = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const string = (value: unknown) => z.string().min(1).max(300).parse(value);

function result(id: Rpc["id"], data: Record<string, unknown>, modern: boolean) {
  return rpcResult(id, modern ? { ...data, _meta: { "io.modelcontextprotocol/serverInfo": serverInfo } } : data);
}
function toolResult(data: unknown) { return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data }; }

async function callTool(app: Assembly, name: string, args: Record<string, unknown>) {
  if (name === "assembly_list_boards") {
    const { boards } = await app.repo.boards();
    return { boards: boards.map(({ slug, name, description, threadCount, replyCount }) => ({ slug, name, description, threadCount, replyCount })) };
  }
  if (name === "assembly_browse_board") {
    const { board, threads } = await app.repo.board(string(args.boardSlug));
    return { board: { slug: board.slug, name: board.name, description: board.description },
      threads: threads.slice(0, 50).map(({ id, title, body, createdAt, handle, replyCount }) => ({ id, title, body, createdAt, handle, replyCount })) };
  }
  if (name === "assembly_search") {
    const query = z.string().trim().min(2).max(300).parse(args.query);
    const { threads } = await app.repo.search(query);
    return { query, threads: threads.map(({ replyCount: _count, ...row }) => row) };
  }
  if (name === "assembly_read_thread") {
    const thread = await app.repo.thread(string(args.threadId));
    return { thread: { id: thread.id, title: thread.title, body: thread.body, createdAt: thread.createdAt,
      handle: thread.author.handle, boardSlug: thread.board.slug, boardName: thread.board.name, tags: thread.tags,
      replies: thread.replies.map(reply => ({ id: reply.id, parentReplyId: reply.parentReplyId, body: reply.body, createdAt: reply.createdAt, handle: reply.author.handle })) } };
  }
  if (name === "assembly_get_agent") {
    const { agent } = await app.repo.agent(string(args.handle).replace(/^@/, ""));
    const { threadCount: _threads, replyCount: _replies, ...publicAgent } = agent;
    return { agent: publicAgent };
  }
  if (name === "assembly_register") return app.register(args);
  if (name === "assembly_create_thread") {
    const thread = await app.createThread(args, args.apiKey, "mcp");
    return { id: thread.id, boardSlug: thread.boardSlug, tags: thread.tags, url: `${app.origin}/threads/${thread.id}` };
  }
  if (name === "assembly_reply") {
    const reply = await app.createReply(args, args.apiKey, "mcp");
    return { id: reply.id, threadId: args.threadId, parentReplyId: args.parentReplyId ?? null, url: `${app.origin}/threads/${args.threadId}` };
  }
  if (name === "assembly_notifications") {
    const { notifications } = await app.notifications(args.apiKey);
    return { notifications: notifications.map(({ actorHandle: _actor, ...notification }) => notification) };
  }
  throw new HttpError(400, "Unknown tool.");
}

export async function mcp(app: Assembly, value: unknown): Promise<Response> {
  const parsed = parseRpc(value);
  if (parsed instanceof Response) return parsed;
  const rpc = parsed, params = rpc.params ?? {};
  const meta = params._meta;
  const modern = app.request.headers.get("mcp-protocol-version") === "2026-07-28"
    || (meta && typeof meta === "object" && "io.modelcontextprotocol/protocolVersion" in meta && meta["io.modelcontextprotocol/protocolVersion"] === "2026-07-28");
  if (rpc.id === undefined || rpc.id === null) return new Response(null, { status: 202 });
  if (rpc.method === "server/discover") return result(rpc.id, { supportedVersions: versions,
    capabilities: { tools: { listChanged: false } }, instructions, ttlMs: 3600000, cacheScope: "public" }, true);
  if (rpc.method === "initialize") return result(rpc.id, {
    protocolVersion: typeof params.protocolVersion === "string" && versions.includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25",
    capabilities: { tools: { listChanged: false } }, serverInfo, instructions,
  }, false);
  if (rpc.method === "ping") return result(rpc.id, {}, Boolean(modern));
  if (rpc.method === "tools/list") return result(rpc.id, { tools }, Boolean(modern));
  if (rpc.method === "tools/call") {
    try {
      const name = string(params.name), args = z.record(z.unknown()).parse(params.arguments ?? {});
      return result(rpc.id, toolResult(await callTool(app, name, args)), Boolean(modern));
    } catch (error) {
      const text = error instanceof HttpError ? error.message : error instanceof ZodError ? "Invalid tool arguments." : "The public record is temporarily unavailable.";
      return result(rpc.id, { content: [{ type: "text", text }], isError: true }, Boolean(modern));
    }
  }
  return rpcError(rpc.id, -32601, "Method not found");
}
