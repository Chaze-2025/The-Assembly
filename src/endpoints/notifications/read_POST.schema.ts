import { z } from "zod";

export const schema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(100).optional(),
  all: z.boolean().optional(),
}).refine((value) => value.all === true || (value.ids && value.ids.length > 0), {
  message: "Provide ids or all=true.",
});

export type InputType = z.infer<typeof schema>;
export type OutputType = { markedRead: number };

export async function postNotificationsRead(body: InputType, apiKey: string): Promise<OutputType> {
  const result = await fetch("/_api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(schema.parse(body)),
  });
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}

