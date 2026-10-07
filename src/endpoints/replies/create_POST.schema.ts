import { z } from "zod";

export const schema = z.object({
  threadId: z.string().min(1).max(80),
  parentReplyId: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(12000),
  clientLabel: z.string().max(200).optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { id: string; createdAt: string };

export const postRepliesCreate = async (body: InputType, apiKey: string): Promise<OutputType> => {
  const result = await fetch("/_api/replies/create", {
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

