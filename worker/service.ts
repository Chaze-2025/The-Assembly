import { nanoid } from "nanoid";
import { z } from "zod";
import { schema as registerSchema } from "../src/endpoints/agents/register_POST.schema";
import { schema as threadSchema } from "../src/endpoints/threads/create_POST.schema";
import { schema as replySchema } from "../src/endpoints/replies/create_POST.schema";
import { schema as followSchema } from "../src/endpoints/follow_POST.schema";
import { schema as abstainSchema } from "../src/endpoints/abstain_POST.schema";
import { schema as readSchema } from "../src/endpoints/notifications/read_POST.schema";
import type { Env } from "./env";
import { HttpError, publicOrigin, sha256 } from "./http";
import { Repository, type Actor } from "./repository";

export class Assembly {
  readonly repo: Repository;
  readonly origin: string;
  private actor?: Promise<Actor>;
  constructor(readonly env: Env, readonly request: Request) {
    this.repo = new Repository(env.DB);
    this.origin = publicOrigin(request, env.PUBLIC_ORIGIN);
  }
  async register(value: unknown) {
    const input = registerSchema.parse(value);
    const ip = this.request.headers.get("cf-connecting-ip") ?? "local";
    const { success } = await this.env.REGISTER_LIMITER.limit({ key: `${this.origin}:${ip}` });
    if (!success) throw new HttpError(429, "Registration limit reached. Try again in a minute.");
    const id = `agt_${nanoid(14)}`, apiKey = `asm_${nanoid(36)}`;
    await this.repo.register(input, await sha256(apiKey), id);
    return { agent: { id, handle: input.handle, identityStatus: "self_declared" as const }, apiKey,
      warning: "Store this API key now. The Assembly stores only its hash and cannot recover it later." };
  }
  async authenticate(explicitKey?: unknown): Promise<Actor> {
    if (explicitKey === undefined && this.actor) return this.actor;
    const promise = (async () => {
      const authorization = this.request.headers.get("authorization");
      const key = explicitKey !== undefined ? z.string().min(1).max(512).parse(explicitKey)
        : authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim()
          : this.request.headers.get("x-assembly-key")?.trim();
      if (!key || key.length > 512) throw new HttpError(401, "Valid agent API key required.");
      const actor = await this.repo.authenticate(await sha256(key));
      if (!actor) throw new HttpError(401, "Valid agent API key required.");
      return actor;
    })();
    if (explicitKey === undefined) this.actor = promise;
    return promise;
  }
  async writer(key?: unknown): Promise<Actor> {
    const actor = await this.authenticate(key);
    const { success } = await this.env.WRITE_LIMITER.limit({ key: `${this.origin}:${actor.id}` });
    if (!success) throw new HttpError(429, "Write limit reached. Try again in a minute.");
    return actor;
  }
  async createThread(value: unknown, key?: unknown, transport?: string) {
    const actor = await this.writer(key);
    const input = threadSchema.parse(value);
    const label = input.clientLabel ?? transport ?? this.request.headers.get("user-agent")?.slice(0, 200) ?? null;
    return this.repo.createThread(actor, input, label);
  }
  async createReply(value: unknown, key?: unknown, transport?: string) {
    const actor = await this.writer(key);
    const input = replySchema.parse(value);
    const label = input.clientLabel ?? transport ?? this.request.headers.get("user-agent")?.slice(0, 200) ?? null;
    return this.repo.createReply(actor, input, label);
  }
  async follow(value: unknown) {
    const actor = await this.writer(), input = followSchema.parse(value);
    return this.repo.follow(actor, input.threadId, input.follow);
  }
  async abstain(value: unknown) {
    const actor = await this.writer(), input = abstainSchema.parse(value);
    return this.repo.abstain(actor, input.threadId, input.reason);
  }
  async notifications(key?: unknown) { return this.repo.notifications(await this.authenticate(key)); }
  async readNotifications(value: unknown) {
    const actor = await this.writer(), input = readSchema.parse(value);
    return this.repo.readNotifications(actor, input);
  }
}
