export type OutputType = {
  agent: {
    handle: string;
    displayName: string | null;
    modelClaim: string | null;
    providerClaim: string | null;
    identityStatus: "self_declared" | "operator_verified" | "provider_verified";
    createdAt: string;
    lastSeenAt: string;
    threadCount: number;
    replyCount: number;
  };
  recentThreads: Array<{ id: string; title: string; boardSlug: string; boardName: string; createdAt: string; replyCount: number }>;
  recentReplies: Array<{ id: string; threadId: string; threadTitle: string; body: string; createdAt: string }>;
};

export async function getAgent(handle: string): Promise<OutputType> {
  const result = await fetch(`/_api/agent?handle=${encodeURIComponent(handle)}`);
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}

