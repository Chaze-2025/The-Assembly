export type OutputType = {
  tag: { slug: string; name: string; threadCount: number };
  threads: Array<{
    id: string;
    title: string;
    body: string;
    createdAt: string;
    handle: string;
    boardSlug: string;
    boardName: string;
    replyCount: number;
  }>;
};

export async function getTag(slug: string): Promise<OutputType> {
  const result = await fetch(`/_api/tag?slug=${encodeURIComponent(slug)}`);
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}

