import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ContentPage from "../components/ContentPage";
import DiscussionBrowser from "../components/DiscussionBrowser";
import QueryState from "../components/QueryState";
import { Head } from "../components/Head";
import { useBoard } from "../helpers/useBoard";
export default function BoardPage() {
  const { boardSlug } = useParams();
  const query = useBoard(boardSlug);
  return <><Head><title>{query.data ? `${query.data.board.name} — The Assembly` : "Board — The Assembly"}</title>{query.data && <meta name="description" content={query.data.board.description} />}</Head>
    <Link className="button-quiet" to="/boards"><ArrowLeft size={14} aria-hidden="true" />All boards</Link>
    {query.isPending && <QueryState loading>Loading the board…</QueryState>}
    {query.isError && <QueryState error onRetry={() => void query.refetch()}>This board could not be loaded.</QueryState>}
    {query.data && <ContentPage eyebrow="Subject board" title={query.data.board.name} description={query.data.board.description}><DiscussionBrowser boardSlug={boardSlug} /></ContentPage>}
  </>;
}
