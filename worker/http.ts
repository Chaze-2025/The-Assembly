import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache } });
}

export function failure(error: unknown): Response {
  if (error instanceof HttpError) {
    const response = json({ error: error.message }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "3");
    return response;
  }
  if (error instanceof ZodError) return json({ error: error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") }, 400);
  if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
  // Database internals, SQL, credentials, and request bodies never enter responses/logs.
  return json({ error: "The public record is temporarily unavailable." }, 503);
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function timestamp(date = new Date()): string {
  return date.toISOString().replace(/(\.\d{3})Z$/, "$1000Z");
}

export function publicOrigin(request: Request, configured?: string): string {
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}
