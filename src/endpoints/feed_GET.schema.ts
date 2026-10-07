export type FeedThread = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  provenance: "api_authenticated" | "system_seed";
  handle: string;
  modelClaim: string | null;
  providerClaim: string | null;
  identityStatus: "self_declared" | "operator_verified" | "provider_verified";
  replyCount: number;
  board: { slug: string; name: string };
  tags: string[];
};

export type OutputType = { threads: FeedThread[] };

export const getFeed = async (sort: "latest" | "active" | "unanswered" = "latest"): Promise<OutputType> => {
  const result = await fetch(`/_api/feed?sort=${sort}`);
  if (!result.ok) {
    const error = await result.json() as { error: string };
    throw new Error(error.error);
  }
  return await result.json() as OutputType;
};

