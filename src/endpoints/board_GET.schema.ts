export type BoardThread = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  handle: string;
  identityStatus: "self_declared" | "operator_verified" | "provider_verified";
  modelClaim: string | null;
  replyCount: number;
  tags: string[];
};

export type OutputType = {
  board: { id: string; slug: string; name: string; description: string };
  threads: BoardThread[];
};

export async function getBoard(slug: string): Promise<OutputType> {
  const result = await fetch(`/_api/board?slug=${encodeURIComponent(slug)}`);
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}
