import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, RefreshCw } from "lucide-react";
import { useDiscussions, DiscussionSort } from "../helpers/useDirectory";
import { useBoards } from "../helpers/useBoards";
import DiscussionList from "./DiscussionList";
import QueryState from "./QueryState";
import styles from "./DiscussionBrowser.module.css";

export default function DiscussionBrowser({ boardSlug, tagSlug }: { boardSlug?: string; tagSlug?: string }) {
  const [params, setParams] = useSearchParams();
  const rawSort = params.get("sort");
  const sort: DiscussionSort = rawSort === "active" || rawSort === "unanswered" ? rawSort : "latest";
  const board = boardSlug ?? params.get("board") ?? "";
  const query = useDiscussions(sort, board, tagSlug);
  const boards = useBoards();
  const items = query.data?.pages.flatMap(page => page.threads) ?? [];
  function sortUrl(value: string) {
    const next = new URLSearchParams(params);
    if (value === "latest") next.delete("sort"); else next.set("sort", value);
    return `?${next.toString()}`;
  }
  return <div>
    <div className={styles.toolbar}>
      <nav className={`tabs ${styles.tabs}`} aria-label="Sort discussions">
        {([["latest", "Latest"], ["active", "Active"], ["unanswered", "Awaiting replies"]] as const).map(([value, label]) => <Link key={value} to={sortUrl(value)} aria-current={sort === value ? "true" : undefined}>{label}</Link>)}
      </nav>
      {!boardSlug && <label className={styles.boardFilter}><span className="sr-only">Filter by board</span><select className="field" value={board} onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set("board", event.target.value); else next.delete("board"); setParams(next); }}>
        <option value="">All boards</option>
        {boards.data?.boards.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
      </select></label>}
    </div>
    <div className={styles.context}><span>{sort === "unanswered" ? "Questions with room for another perspective." : sort === "active" ? "Conversations ordered by recent activity." : "New conversations from across the public record."}</span><button type="button" className={styles.refresh} onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh discussions"><RefreshCw size={13} aria-hidden="true" />Refresh</button></div>
    {query.isPending && <QueryState loading>Loading discussions…</QueryState>}
    {query.isError && <QueryState error onRetry={() => void query.refetch()}>Discussions could not be loaded. Your filters are preserved.</QueryState>}
    {query.data && <DiscussionList items={items} showBoard={!boardSlug} emptyText={sort === "unanswered" ? "Every discussion in this view has a reply. Browse the latest conversations or bring a new question." : "No discussions have been filed here yet. This space is open for a first contribution."} />}
    {query.hasNextPage && <div className={styles.more}><button className="button button-secondary" type="button" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}><ArrowDown size={15} aria-hidden="true" />{query.isFetchingNextPage ? "Loading more…" : "Load more discussions"}</button></div>}
    {items.length > 0 && <p className={styles.count} role="status">{items.length} discussion{items.length === 1 ? "" : "s"} shown{query.hasNextPage ? "" : " · You’re up to date"}</p>}
  </div>;
}
