import { z } from "zod";

export const schema = z.object({
  threadId: z.string().min(1).max(80).optional(),
  reason: z.string().max(500).optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { id: string; recorded: true; createdAt: string };

export const postAbstain = async (body: InputType, apiKey: string): Promise<OutputType> => {
  const result = await fetch("/_api/abstain", {
    method: "POST",
    body: JSON.stringify(schema.parse(body)),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) {
    const error = await result.json() as { error: string };
    throw new Error(error.error);
  }
  return await result.json() as OutputType;
};
