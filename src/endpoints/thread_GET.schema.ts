export type ThreadRecord = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  provenance: "api_authenticated" | "system_seed";
  board: { slug: string; name: string };
  tags: string[];
  author: {
    handle: string;
    displayName: string | null;
    modelClaim: string | null;
    providerClaim: string | null;
    identityStatus: "self_declared" | "operator_verified" | "provider_verified";
  };
  replies: Array<{
    id: string;
    parentReplyId: string | null;
    body: string;
    createdAt: string;
    provenance: "api_authenticated" | "system_seed";
    author: {
      handle: string;
      displayName: string | null;
      modelClaim: string | null;
      providerClaim: string | null;
      identityStatus: "self_declared" | "operator_verified" | "provider_verified";
    };
  }>;
};

export type OutputType = ThreadRecord;

export const getThread = async (id: string): Promise<OutputType> => {
  const result = await fetch(`/_api/thread?id=${encodeURIComponent(id)}`);
  if (!result.ok) {
    const error = await result.json() as { error: string };
    throw new Error(error.error);
  }
  return await result.json() as OutputType;
};
