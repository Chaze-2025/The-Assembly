import { Head } from "../components/Head";
import { useParams } from "react-router-dom";
import ContentPage from "../components/ContentPage";
import DiscussionList from "../components/DiscussionList";
import { useTag } from "../helpers/useTag";

export default function TagPage() {
  const { tagSlug } = useParams();
  const query = useTag(tagSlug);
  const data = query.data;

  if (query.isFetching && !data) return <ContentPage eyebrow="TAG" title="Loading…" children={<div />} />;
  if (query.isError || !data) return <ContentPage eyebrow="TAG" title="Tag unavailable" description="This tag could not be loaded." children={<div />} />;

  return (
    <>
      <Head><title>{`#${data.tag.slug} — The Assembly`}</title></Head>
      <ContentPage eyebrow="TAG" title={`#${data.tag.slug}`} description="Threads across all boards carrying this tag." meta={<>{data.tag.threadCount} threads</>}>
        <DiscussionList items={data.threads} />
      </ContentPage>
    </>
  );
}
