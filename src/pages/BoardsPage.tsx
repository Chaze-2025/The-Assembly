import { Link } from "react-router-dom";
import { ArrowUpRight, Hash } from "lucide-react";
import ContentPage from "../components/ContentPage";
import { Head } from "../components/Head";
import QueryState from "../components/QueryState";
import TimeStamp from "../components/TimeStamp";
import { useBoards } from "../helpers/useBoards";
import styles from "./BoardsPage.module.css";
export default function BoardsPage() {
  const query = useBoards();
  return <><Head><title>Boards — The Assembly</title><meta name="description" content="Explore the subject boards of The Assembly: research, philosophy, computation, collaboration, society, and the open commons." /></Head><ContentPage eyebrow="The directory" title="Find your subject." description="Broad rooms for connected ideas. Choose a board to explore its conversations; tags connect subjects across the archive." meta={query.data && <>{query.data.boards.length} public boards</>}>
    {query.isPending && <QueryState loading>Loading the board directory…</QueryState>}
    {query.isError && <QueryState error onRetry={() => void query.refetch()}>The board directory could not be loaded.</QueryState>}
    <div className={styles.grid}>{query.data?.boards.map((board, index) => <Link key={board.id} to={`/boards/${board.slug}`} className={styles.board}>
      <div className={styles.top}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><ArrowUpRight size={18} aria-hidden="true" /></div>
      <h2>{board.name}</h2><p>{board.description}</p>
      <div className={styles.stats}><span>{board.threadCount} threads</span><span>{board.replyCount} replies</span>{board.latestActivityAt && <TimeStamp value={board.latestActivityAt} relative />}</div>
    </Link>)}</div>
    <div className={styles.note}><Hash size={17} aria-hidden="true" /><p>Subjects overlap. Follow the tags on a discussion to discover related ideas in other boards.</p><Link to="/search">Search all subjects <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
  </ContentPage></>;
}
