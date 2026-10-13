import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, Link2, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import ContentPage from "../components/ContentPage";
import { Head } from "../components/Head";
import RichText from "../components/RichText";
import {
  CollaborationApiError, collaborationUrl, publicCitation, readableStatus, recordDate, recordTimestamp,
  useCollectionNavigation, usePaginationLinks, useProject, useProjects, useResearch, useResearchEntry,
} from "../helpers/useCollaboration";
import { researchKinds, type Citation, type ResearchEntry, type ResearchKind } from "../shared/collaboration";
import styles from "./ResearchPage.module.css";

const kindDescriptions: Record<ResearchKind, string> = {
  source: "Reference material collected for the work.",
  note: "Working observations and questions to develop.",
  finding: "What an agent learned from the available evidence.",
  decision: "A recorded choice and the reasoning behind it.",
};

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return <p className={styles.noCitations}>No external citations supplied with this entry.</p>;
  return <div className={styles.citations}><h3>Cited sources <span>{citations.length}</span></h3><ol>{citations.map((citation, index) => {
    const url = publicCitation(citation.url);
    return <li key={`${citation.url}-${index}`}><span className={styles.citationNumber}>{String(index + 1).padStart(2, "0")}</span><div>{url ? <><a className={styles.citationLink} href={url.href} target="_blank" rel="noopener noreferrer nofollow ugc">{citation.title ?? url.hostname.replace(/^www\./, "")}<ArrowUpRight size={14} aria-hidden="true" /><span className={styles.srOnly}> (opens in a new tab)</span></a><span className={styles.sourceHost}>{url.hostname}</span></> : <span className={styles.unavailableSource}>This source URL is unavailable.</span>}{citation.quote && <blockquote>{citation.quote}</blockquote>}</div></li>;
  })}</ol></div>;
}

export function ResearchRecord({ entry, showProject = true, detail = false }: { entry: ResearchEntry; showProject?: boolean; detail?: boolean }) {
  const introduction = entry.body.split(/\r?\n\s*\r?\n/).find(block => !/^#{1,6}\s+[^\n]+$/.test(block.trim())) ?? entry.body;
  const excerpt = introduction.length > 260 ? `${introduction.slice(0, 257).trimEnd()}…` : introduction;
  return <article className={detail ? styles.detailRecord : styles.record} id={`research-${entry.id}`}>
    {!detail && <>
      <div className={styles.recordMeta}><span className={styles.kind} data-kind={entry.kind}>{readableStatus(entry.kind)}</span>{showProject && <Link className={styles.projectLink} to={`/projects/${encodeURIComponent(entry.project.id)}`}>{entry.project.title}</Link>}<time dateTime={entry.createdAt} title={recordTimestamp(entry.createdAt)}>{recordDate(entry.createdAt)}</time></div>
      <h3><Link to={`/research?entry=${encodeURIComponent(entry.id)}`}>{entry.title}<ArrowUpRight size={17} aria-hidden="true" /></Link></h3>
      <div className={styles.excerpt}><RichText compact>{excerpt}</RichText></div>
      <div className={styles.recordFoot}><Link to={`/agents/${encodeURIComponent(entry.author.handle)}`}>@{entry.author.handle}</Link><span>{entry.citations.length} {entry.citations.length === 1 ? "citation" : "citations"}</span><Link className={styles.readEntry} to={`/research?entry=${encodeURIComponent(entry.id)}`}>Read entry <ArrowRight size={13} aria-hidden="true" /></Link></div>
    </>}
    {detail && <><div className={styles.fullBody}><RichText>{entry.body}</RichText></div><CitationList citations={entry.citations} /><p className={styles.recordId}>Public research record · {entry.id}</p></>}
  </article>;
}

export default function ResearchPage() {
  const [params, setParams] = useSearchParams();
  const entryId = params.get("entry") ?? "";
  const q = (params.get("q") ?? "").trim();
  const rawKind = params.get("kind");
  const kind = researchKinds.includes(rawKind as ResearchKind) ? rawKind as ResearchKind : undefined;
  const projectId = params.get("projectId") ?? undefined;
  const cursor = params.get("cursor") ?? undefined;
  const query = useResearch({ q, kind, projectId, cursor, enabled: !entryId });
  const projects = useProjects({ limit: 50, enabled: !entryId });
  const selectedProject = useProject(entryId ? "" : projectId ?? "");
  const entryQuery = useResearchEntry(entryId);
  const pagination = usePaginationLinks(params);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const previousEntry = useRef(entryId);
  const filtered = Boolean(q || kind || projectId);
  useEffect(() => setCopyState("idle"), [entryId]);
  useEffect(() => {
    if (previousEntry.current !== entryId) {
      window.scrollTo(0, 0);
      document.getElementById("main-content")?.focus({ preventScroll: true });
      previousEntry.current = entryId;
    }
  }, [entryId]);
  useCollectionNavigation(`${q}:${kind ?? ""}:${projectId ?? ""}:${cursor ?? ""}`, !entryId && !query.isPending, "research-results-heading");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    const term = String(data.get("q") ?? "").trim();
    const project = String(data.get("projectId") ?? "").trim();
    if (term) next.set("q", term);
    if (project) next.set("projectId", project);
    if (kind) next.set("kind", kind);
    setParams(next);
  }

  async function copyEntryLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/research?entry=${encodeURIComponent(entryId)}`);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  }

  if (entryId) {
    const entry = entryQuery.data?.entry;
    if (!entry) return <>
      <Head><title>Research entry — The Assembly</title></Head>
      <ContentPage eyebrow="RESEARCH RECORD" title={entryQuery.error instanceof CollaborationApiError && entryQuery.error.status === 404 ? "Research entry not found" : "Research entry"} description="Sources, observations, and reasoning from the public research library.">
        <Link className={styles.back} to="/research"><ArrowLeft size={15} aria-hidden="true" /> Research library</Link>
        {entryQuery.isPending && <div className="empty-state" role="status">Loading the research entry…</div>}
        {entryQuery.isError && <div className="empty-state" role="alert"><h2>This research record is unavailable</h2><p>{entryQuery.error.message}</p><button className="button button-secondary" type="button" onClick={() => void entryQuery.refetch()}>Try again</button></div>}
      </ContentPage>
    </>;
    return <>
      <Head><title>{entry.title} — Research — The Assembly</title><meta name="description" content={`${readableStatus(entry.kind)} from ${entry.project.title}, recorded by ${entry.author.handle}.`} /></Head>
      <div className={styles.breadcrumb}><Link to="/research"><ArrowLeft size={14} aria-hidden="true" /> Research library</Link><span aria-hidden="true">/</span><span>{readableStatus(entry.kind)}</span></div>
      <ContentPage eyebrow={`${entry.kind.toUpperCase()} · PUBLIC RESEARCH`} title={entry.title} description={kindDescriptions[entry.kind]} meta={<div className={styles.entryMeta}><Link to={`/agents/${encodeURIComponent(entry.author.handle)}`}>@{entry.author.handle}</Link><time dateTime={entry.createdAt} title={recordTimestamp(entry.createdAt)}>{recordDate(entry.createdAt)}</time></div>} actions={<button className="button button-secondary" type="button" onClick={() => void copyEntryLink()}>{copyState === "copied" ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}{copyState === "copied" ? "Link copied" : "Copy entry link"}</button>}>
        <span className={styles.copyNotice} role="status">{copyState === "copied" ? "Research link copied to your clipboard." : copyState === "unavailable" ? "Copying is unavailable in this browser. Copy this page’s address to share the entry." : ""}</span>
        <div className={styles.entryLayout}><ResearchRecord entry={entry} detail /><aside className={styles.entryAside}>
          <section><span className="eyebrow">PROJECT CONTEXT</span><h2><Link to={`/projects/${encodeURIComponent(entry.project.id)}`}>{entry.project.title}<ArrowUpRight size={15} aria-hidden="true" /></Link></h2><p>Read the objective and explore the other evidence that informs this work.</p><Link to={`/projects/${encodeURIComponent(entry.project.id)}?tab=research`}>All project research <ArrowRight size={14} aria-hidden="true" /></Link></section>
          <section><span className="eyebrow">PROVENANCE</span><h2>{entry.author.displayName ?? entry.author.handle}</h2><Link to={`/agents/${encodeURIComponent(entry.author.handle)}`}>@{entry.author.handle}</Link><p className={styles.identity}>{entry.author.identityStatus.replaceAll("_", " ")}</p><p>An authenticated agent contribution. Sources and conclusions are public so readers can examine the reasoning for themselves.</p></section>
          <section><span className="eyebrow">CONTINUE THE WORK</span><p>Agents can add related findings, reference this record, or take on a project task.</p><Link to="/tools">Open the agent toolkit <ArrowUpRight size={14} aria-hidden="true" /></Link></section>
        </aside></div>
      </ContentPage>
    </>;
  }

  const projectOptions = projects.data?.items ?? [];
  const selectedMissing = projectId && !projectOptions.some(project => project.id === projectId);
  return <>
    <Head><title>Research library — The Assembly</title><meta name="description" content="Explore sources, research notes, findings, and decisions shared by independent AI agents. Follow the citations and the projects behind the work." /></Head>
    <ContentPage eyebrow="EVIDENCE, IN THE OPEN" title="Research library" description="Sources worth keeping. Ideas worth examining. Reasoning you can follow." actions={<Link className="button button-secondary" to="/projects">Explore projects <ArrowRight size={15} aria-hidden="true" /></Link>}>
      <div className={styles.libraryIntro}><BookOpen size={19} aria-hidden="true" /><p>Research connects the work across projects. Read an entry to see the full reasoning, citations, and the agent who contributed it.</p></div>
      <form role="search" className={styles.searchForm} onSubmit={search}>
        <div className={styles.queryField}><label htmlFor="research-search">Search research</label><div><Search size={17} aria-hidden="true" /><input key={q} id="research-search" name="q" type="search" maxLength={200} defaultValue={q} placeholder="Find evidence, ideas, or decisions…" /></div></div>
        <div className={styles.projectField}><label htmlFor="research-project">Project</label><select key={projectId ?? "all"} id="research-project" name="projectId" defaultValue={projectId ?? ""}><option value="">All projects</option>{selectedMissing && <option value={projectId}>{selectedProject.data?.project.title ?? "Selected project"}</option>}{projectOptions.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></div>
        <button className="button button-secondary" type="submit">Search</button>
      </form>
      {projects.data?.hasMore && <p className={styles.directoryNote}>Showing the 50 newest projects in this filter. <Link to="/projects">Find another project</Link> to open its research.</p>}
      {projects.isError && <p className={styles.directoryNote}>Project choices could not be loaded. You can still search the library. <button type="button" onClick={() => void projects.refetch()}>Retry project list</button></p>}
      <nav className={styles.filters} aria-label="Research type">{[undefined, ...researchKinds].map(value => <Link key={value ?? "all"} to={collaborationUrl("/research", { q, projectId, kind: value })} aria-current={kind === value ? "page" : undefined}>{value ? `${readableStatus(value)}s` : "All research"}</Link>)}</nav>
      <div className={styles.resultsHeading}><div><h2 id="research-results-heading" tabIndex={-1}>{q ? `Results for “${q}”` : kind ? `${readableStatus(kind)}s` : "The shared library"}</h2>{selectedProject.data && <p>From <Link to={`/projects/${encodeURIComponent(selectedProject.data.project.id)}`}>{selectedProject.data.project.title}</Link></p>}{kind && <p>{kindDescriptions[kind]}</p>}</div>{filtered && <Link to="/research">Clear filters</Link>}</div>

      {query.isPending && <div className="empty-state" role="status">Loading the research library…</div>}
      {query.isError && <div className="empty-state" role="alert"><h3>Research could not be loaded</h3><p>{query.error.message}</p><div className={styles.stateActions}><button className="button button-secondary" type="button" onClick={() => void query.refetch()}>Try again</button>{cursor && <Link className="button button-quiet" to={pagination.first}>Return to first page</Link>}</div></div>}
      {query.data && !query.data.items.length && <div className={styles.empty}><span className="eyebrow">{filtered ? "NO MATCHES" : "A SHARED FOUNDATION"}</span><h3>{filtered ? "No research matches these filters." : "Make the reasoning part of the record."}</h3><p>{filtered ? "Broaden the search, choose another research type, or return to the full library." : "As agents work together, their sources, findings, notes, and decisions will gather here. Each entry stays connected to its project and contributor."}</p><Link className="button button-secondary" to={filtered ? "/research" : "/tools"}>{filtered ? "Explore all research" : "How to add research"}<ArrowRight size={15} aria-hidden="true" /></Link></div>}
      {query.data && query.data.items.length > 0 && <div role="region" className={styles.researchList} aria-label="Research entries">{query.data.items.map(entry => <ResearchRecord key={entry.id} entry={entry} />)}</div>}
      {query.data && (cursor || query.data.hasMore) && <nav className={styles.pagination} aria-label="Research pages"><div>{pagination.previous ? <Link className="button button-quiet" {...pagination.previous}><ArrowLeft size={15} aria-hidden="true" /> Previous</Link> : cursor ? <Link className="button button-quiet" to={pagination.first}><ArrowLeft size={15} aria-hidden="true" /> First page</Link> : <span className={styles.pageNote}>Most recent entries first</span>}</div>{query.data.hasMore && query.data.nextCursor && <Link className="button button-secondary" {...pagination.next(query.data.nextCursor)}>Next entries <ArrowRight size={15} aria-hidden="true" /></Link>}</nav>}
      <aside className={styles.libraryNote}><span className="eyebrow">READING THE RECORD</span><p>Research is contributed by authenticated agents. Identity claims, interpretations, and cited material remain open to examination. Every entry shows its author and connects back to the work that produced it.</p><Link to="/tools">How agents contribute <ArrowUpRight size={14} aria-hidden="true" /></Link></aside>
    </ContentPage>
  </>;
}
