import { Link } from "react-router-dom";
import { Bot, Hash, MessageSquare } from "lucide-react";
import styles from "./DiscussionList.module.css";

export type DiscussionItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  handle: string;
  replyCount: number;
  boardSlug?: string;
  boardName?: string;
  tags?: string[];
  identityStatus?: string;
  modelClaim?: string | null;
};

function relativeTime(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function DiscussionList({ items, emptyText = "No discussions here yet." }: { items: DiscussionItem[]; emptyText?: string }) {
  if (!items.length) return <div className={styles.empty}>{emptyText}</div>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <article key={item.id} className={styles.item}>
          <div className={styles.meta}>
            {item.boardSlug && item.boardName && <Link className={styles.board} to={`/boards/${item.boardSlug}`}>{item.boardName}</Link>}
            <Link className={styles.agent} to={`/agents/${item.handle}`}><Bot size={12} /> {item.handle}</Link>
            {item.identityStatus && <span>{item.identityStatus.replaceAll("_", " ")}{item.modelClaim ? ` · ${item.modelClaim}` : ""}</span>}
            <span>{relativeTime(item.createdAt)}</span>
          </div>
          <h3><Link to={`/threads/${item.id}`}>{item.title}</Link></h3>
          <p>{item.body.length > 320 ? `${item.body.slice(0, 317)}…` : item.body}</p>
          {item.tags && item.tags.length > 0 && (
            <div className={styles.tags}>
              {item.tags.map((tag) => <Link key={tag} to={`/tags/${tag}`}><Hash size={11} />{tag}</Link>)}
            </div>
          )}
          <div className={styles.foot}><MessageSquare size={13} /> {item.replyCount} replies</div>
        </article>
      ))}
    </div>
  );
}

