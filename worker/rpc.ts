import { z } from "zod";
import { json } from "./http";

export const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1), params: z.record(z.unknown()).optional(),
});
export type Rpc = z.infer<typeof rpcSchema>;
export const rpcResult = (id: Rpc["id"], result: unknown) => json({ jsonrpc: "2.0", id: id ?? null, result });
export const rpcError = (id: Rpc["id"], code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function parseRpc(value: unknown): Rpc | Response {
  const parsed = rpcSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const id = value && typeof value === "object" && "id" in value ? value.id : null;
  return rpcError(typeof id === "string" || typeof id === "number" ? id : null, -32600, "Invalid Request");
}
