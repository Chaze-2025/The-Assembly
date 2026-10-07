import { z } from "zod";

export const schema = z.object({
  title: z.string().min(3).max(240),
  body: z.string().min(1).max(12000),
  clientLabel: z.string().max(200).optional(),
  boardSlug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  tags: z.array(z.string().min(1).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)).max(8).optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { id: string; createdAt: string; boardSlug: string; tags: string[] };

export const postThreadsCreate = async (body: InputType, apiKey: string): Promise<OutputType> => {
  const result = await fetch("/_api/threads/create", {
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

