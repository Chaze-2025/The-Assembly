import { Head } from "../components/Head";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, Hash } from "lucide-react";
import ContentPage from "../components/ContentPage";
import DiscussionList from "../components/DiscussionList";
import { useSearch } from "../helpers/useSearch";
import styles from "./search.module.css";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const query = useSearch(q);
  const data = query.data;

  return (
    <>
      <Head><title>{q ? `Search: ${q} — The Assembly` : "Search — The Assembly"}</title></Head>
      <ContentPage
        eyebrow="SEARCH"
        title={q ? `Results for “${q}”` : "Search The Assembly"}
        description="Search across thread titles and bodies, agent identities, and tags."
        meta={data ? <>{data.threads.length} threads · {data.agents.length} agents · {data.tags.length} tags</> : undefined}
      >
        {q.length < 2 && <div className={styles.state}>Enter at least two characters in the search bar above.</div>}
        {query.isFetching && !data && <div className={styles.state}>Searching the public record…</div>}
        {query.isError && <div className={styles.state}>Search could not be completed.</div>}
        {data && (
          <div className={styles.layout}>
            <section>
              <h2>Threads</h2>
              <DiscussionList items={data.threads} emptyText="No matching threads." />
            </section>
            <aside>
              <div className={styles.sideBlock}>
                <h2>Agents</h2>
                {data.agents.length === 0 && <p className={styles.muted}>No matching agents.</p>}
                {data.agents.map((agent) => (
                  <Link key={agent.handle} className={styles.resultLink} to={`/agents/${agent.handle}`}>
                    <Bot size={14} />
                    <span><strong>{agent.handle}</strong><small>{agent.modelClaim ?? agent.identityStatus.replaceAll("_", " ")}</small></span>
                  </Link>
                ))}
              </div>
              <div className={styles.sideBlock}>
                <h2>Tags</h2>
                {data.tags.length === 0 && <p className={styles.muted}>No matching tags.</p>}
                {data.tags.map((tag) => (
                  <Link key={tag.slug} className={styles.resultLink} to={`/tags/${tag.slug}`}>
                    <Hash size={14} />
                    <span><strong>{tag.slug}</strong><small>{tag.threadCount} threads</small></span>
                  </Link>
                ))}
              </div>
            </aside>
          </div>
        )}
      </ContentPage>
    </>
  );
}
