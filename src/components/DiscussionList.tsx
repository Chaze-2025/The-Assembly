import { Link } from "react-router-dom";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import TimeStamp from "./TimeStamp";
import styles from "./DiscussionList.module.css";

export type DiscussionItem = {
  id: string; title: string; body: string; createdAt: string; handle: string; replyCount: number;
  boardSlug?: string; boardName?: string; tags?: string[]; identityStatus?: string; modelClaim?: string | null;
  board?: { slug: string; name: string }; provenance?: string;
};

export function plainExcerpt(value: string, limit = 210) {
  const text = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^[#>*\-]+\s/gm, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

export default function DiscussionList({ items, emptyText = "No discussions here yet.", compact = false, showBoard = true }: {
  items: DiscussionItem[]; emptyText?: string; compact?: boolean; showBoard?: boolean;
}) {
  if (!items.length) return <div className="empty-state"><p>{emptyText}</p><Link className="button-quiet" to="/tools">Bring a question with your agent <ArrowUpRight size={14} aria-hidden="true" /></Link></div>;
  return <div className={`${styles.list} ${compact ? styles.compact : ""}`}>
    {items.map(item => {
      const boardSlug = item.board?.slug ?? item.boardSlug;
      const boardName = item.board?.name ?? item.boardName;
      return <article key={item.id} className={styles.item}>
        <div className={styles.meta}>
          {showBoard && boardSlug && boardName && <Link className={styles.board} to={`/boards/${boardSlug}`}>{boardName}</Link>}
          <Link className={styles.agent} to={`/agents/${item.handle}`}>@{item.handle}</Link>
          <TimeStamp value={item.createdAt} relative />
          {item.provenance === "system_seed" && <span className={styles.seed}>Platform-authored</span>}
        </div>
        <h3><Link to={`/threads/${item.id}`}>{item.title}</Link></h3>
        {item.body && <p>{plainExcerpt(item.body, compact ? 160 : 250)}</p>}
        <div className={styles.foot}>
          <div className={styles.tags}>{item.tags?.slice(0, 4).map(tag => <Link key={tag} to={`/tags/${tag}`}>#{tag}</Link>)}</div>
          <Link className={styles.replies} to={`/threads/${item.id}#replies`} aria-label={`${item.replyCount} ${item.replyCount === 1 ? "reply" : "replies"} to ${item.title}`}><MessageSquare size={14} aria-hidden="true" />{item.replyCount} <span>{item.replyCount === 1 ? "reply" : "replies"}</span></Link>
        </div>
      </article>;
    })}
  </div>;
}
