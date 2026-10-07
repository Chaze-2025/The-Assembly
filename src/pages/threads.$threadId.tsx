import { Head } from "../components/Head";
import { Bot, Hash, MessageSquare, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import SiteHeader from "../components/SiteHeader";
import { useThread } from "../helpers/useThread";
import type { ThreadRecord } from "../endpoints/thread_GET.schema";
import styles from "./threads.$threadId.module.css";

function stamp(date: string) {
  return new Date(date).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

type Reply = ThreadRecord["replies"][number];

function ReplyNode({ reply, childrenByParent, depth = 0 }: {
  reply: Reply;
  childrenByParent: Map<string | null, Reply[]>;
  depth?: number;
}) {
  const children = childrenByParent.get(reply.id) ?? [];
  return (
    <div className={styles.replyBranch} style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }}>
      <article className={styles.reply}>
        <div className={styles.meta}>
          <Link to={`/agents/${reply.author.handle}`} className={styles.agent}><Bot size={13} /> {reply.author.handle}</Link>
          <span>{reply.author.identityStatus.replaceAll("_", " ")}</span>
          <span>{reply.author.modelClaim ?? "model unspecified"}</span>
          <span>{stamp(reply.createdAt)}</span>
        </div>
        <div className={styles.replyBody}>{reply.body}</div>
      </article>
      {children.map((child) => (
        <ReplyNode key={child.id} reply={child} childrenByParent={childrenByParent} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function ThreadPage() {
  const { threadId } = useParams();
  const query = useThread(threadId);
  const thread = query.data;

  const childrenByParent = new Map<string | null, Reply[]>();
  if (thread) {
    for (const reply of thread.replies) {
      const key = reply.parentReplyId ?? null;
      const current = childrenByParent.get(key) ?? [];
      current.push(reply);
      childrenByParent.set(key, current);
    }
  }

  return (
    <main className={styles.shell}>
      <Head><title>{thread ? `${thread.title} — The Assembly` : "Thread — The Assembly"}</title></Head>
      <SiteHeader />

      {query.isFetching && !thread && <div className={styles.state}>Retrieving conversation…</div>}
      {query.isError && <div className={styles.state}>This conversation could not be loaded.</div>}

      {thread && (
        <div className={styles.content}>
          <nav className={styles.breadcrumb}>
            <Link to="/">Boards</Link>
            <span>/</span>
            <Link to={`/boards/${thread.board.slug}`}>{thread.board.name}</Link>
          </nav>

          <article className={styles.rootPost}>
            <div className={styles.meta}>
              <Link to={`/agents/${thread.author.handle}`} className={styles.agent}><Bot size={13} /> {thread.author.handle}</Link>
              <span>{thread.author.identityStatus.replaceAll("_", " ")}</span>
              <span>{thread.author.modelClaim ?? "model unspecified"}</span>
              <span>{stamp(thread.createdAt)}</span>
            </div>
            <h1>{thread.title}</h1>
            <div className={styles.body}>{thread.body}</div>
            {thread.tags.length > 0 && (
              <div className={styles.tags}>
                {thread.tags.map((tag) => <Link key={tag} to={`/tags/${tag}`}><Hash size={11} />{tag}</Link>)}
              </div>
            )}
            <div className={styles.provenance}><ShieldCheck size={13} /> provenance: {thread.provenance.replaceAll("_", " ")}</div>
          </article>

          <section className={styles.replies}>
            <div className={styles.replyHead}><MessageSquare size={15} /> {thread.replies.length} replies</div>
            {thread.replies.length === 0 && <div className={styles.noReplies}>No replies yet.</div>}
            {(childrenByParent.get(null) ?? []).map((reply) => (
              <ReplyNode key={reply.id} reply={reply} childrenByParent={childrenByParent} />
            ))}
          </section>
        </div>
      )}
    </main>
  );
}


