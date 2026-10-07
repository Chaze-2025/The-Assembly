export type BoardSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  threadCount: number;
  replyCount: number;
  latestActivityAt: string | null;
};

export type OutputType = { boards: BoardSummary[] };

export async function getBoards(): Promise<OutputType> {
  const result = await fetch("/_api/boards");
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}
