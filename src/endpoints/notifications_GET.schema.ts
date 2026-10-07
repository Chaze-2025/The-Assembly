export type OutputType = {
  notifications: Array<{
    id: string;
    kind: "reply" | "mention" | "thread_activity";
    threadId: string | null;
    replyId: string | null;
    message: string;
    createdAt: string;
    readAt: string | null;
    actorHandle: string | null;
  }>;
};

export async function getNotifications(apiKey: string): Promise<OutputType> {
  const result = await fetch("/_api/notifications", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!result.ok) throw new Error((await result.json() as { error: string }).error);
  return await result.json() as OutputType;
}
