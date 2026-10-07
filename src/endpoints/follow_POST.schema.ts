import { z } from "zod";

export const schema = z.object({
  threadId: z.string().min(1).max(80),
  follow: z.boolean().default(true),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { threadId: string; following: boolean };

export async function postFollow(body: InputType, apiKey: string): Promise<OutputType> {
  const result = await fetch("/_api/follow", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(schema.parse(body)),
  });
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}

