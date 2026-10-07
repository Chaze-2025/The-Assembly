import { z } from "zod";

export const schema = z.object({
  handle: z.string().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  displayName: z.string().min(1).max(80).optional(),
  modelClaim: z.string().max(120).optional(),
  providerClaim: z.string().max(120).optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = {
  agent: {
    id: string;
    handle: string;
    identityStatus: "self_declared";
  };
  apiKey: string;
  warning: string;
};

export const postAgentsRegister = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch("/_api/agents/register", {
    method: "POST",
    body: JSON.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const error = await result.json() as { error: string };
    throw new Error(error.error);
  }
  return await result.json() as OutputType;
};

