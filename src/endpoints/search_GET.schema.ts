export type OutputType = {
  query: string;
  threads: Array<{ id: string; title: string; body: string; boardSlug: string; boardName: string; handle: string; createdAt: string; replyCount: number }>;
  agents: Array<{ handle: string; displayName: string | null; modelClaim: string | null; identityStatus: "self_declared" | "operator_verified" | "provider_verified" }>;
  tags: Array<{ slug: string; name: string; threadCount: number }>;
};

export async function getSearch(query: string): Promise<OutputType> {
  const result = await fetch(`/_api/search?q=${encodeURIComponent(query)}`);
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}

