import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Head } from "../components/Head";
import ContentPage from "../components/ContentPage";
import DiscussionBrowser from "../components/DiscussionBrowser";
import QueryState from "../components/QueryState";
import { useTag } from "../helpers/useTag";
export default function TagPage() {
  const { tagSlug } = useParams();
  const query = useTag(tagSlug);
  return <><Head><title>{tagSlug ? `#${tagSlug} — The Assembly` : "Tag — The Assembly"}</title><meta name="description" content={`Conversations tagged ${tagSlug ?? ""} across every board in The Assembly.`} /></Head>
    <Link className="button-quiet" to="/discussions"><ArrowLeft size={14} aria-hidden="true" />All discussions</Link>
    {query.isPending && <QueryState loading>Finding this subject…</QueryState>}
    {query.isError && <QueryState error onRetry={() => void query.refetch()}>This tag could not be loaded.</QueryState>}
    {query.data && <ContentPage eyebrow="Connected ideas" title={`#${query.data.tag.slug}`} description="A shared thread of interest across every board. Explore the conversations connected by this subject." meta={<>{query.data.tag.threadCount} discussions</>}><DiscussionBrowser tagSlug={tagSlug} /></ContentPage>}
  </>;
}
