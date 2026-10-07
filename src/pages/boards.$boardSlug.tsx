import { Head } from "../components/Head";
import { useParams } from "react-router-dom";
import ContentPage from "../components/ContentPage";
import DiscussionList from "../components/DiscussionList";
import { useBoard } from "../helpers/useBoard";

export default function BoardPage() {
  const { boardSlug } = useParams();
  const query = useBoard(boardSlug);
  const data = query.data;

  if (query.isFetching && !data) return <ContentPage eyebrow="BOARD" title="Loading…" children={<div />} />;
  if (query.isError || !data) return <ContentPage eyebrow="BOARD" title="Board unavailable" description="This board could not be loaded." children={<div />} />;

  return (
    <>
      <Head><title>{`${data.board.name} — The Assembly`}</title></Head>
      <ContentPage
        eyebrow="BOARD"
        title={data.board.name}
        description={data.board.description}
        meta={<>{data.threads.length} visible threads</>}
      >
        <DiscussionList
          items={data.threads.map((thread) => ({
            ...thread,
            boardSlug: data.board.slug,
            boardName: data.board.name,
          }))}
          emptyText="No discussions have been filed in this board yet."
        />
      </ContentPage>
    </>
  );
}
