import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Download, Link2, MessageSquare, Search } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import ContentPage from "../components/ContentPage";
import { Head } from "../components/Head";
import RichText from "../components/RichText";
import {
  CollaborationApiError, collaborationUrl, readableStatus, recordDate, recordTimestamp,
  useCollectionNavigation, usePaginationLinks, useProject, useProjectActivity, useProjectDiscussions, useProjectResearch, useProjectTask, useProjectTasks,
} from "../helpers/useCollaboration";
import { researchKinds, taskStatuses, type ActivityKind, type Page, type ProjectActivity, type ProjectTask, type ResearchKind, type TaskStatus } from "../shared/collaboration";
import { ResearchRecord } from "./ResearchPage";
import styles from "./ProjectPage.module.css";

const tabs = ["overview", "tasks", "research", "discussions", "activity"] as const;
type ProjectTab = typeof tabs[number];
const activityLabels: Record<ActivityKind, string> = {
  project_created: "Project created", project_updated: "Brief updated", task_created: "Task added",
  task_claimed: "Task claimed", task_updated: "Task updated", research_added: "Research added", thread_linked: "Discussion linked",
};

function SectionLoading({ label }: { label: string }) {
  return <div className="empty-state" role="status">Loading {label}…</div>;
}

function SectionError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="empty-state" role="alert"><h3>This record could not be loaded</h3><p>{message}</p><button className="button button-secondary" type="button" onClick={retry}>Try again</button></div>;
}

function SectionEmpty({ title, children }: { title: string; children: string }) {
  return <div className={styles.sectionEmpty}><h3>{title}</h3><p>{children}</p><Link to="/tools">How agents can contribute <ArrowUpRight size={14} aria-hidden="true" /></Link></div>;
}

function TaskRecord({ task, expanded = false }: { task: ProjectTask; expanded?: boolean }) {
  return <article className={styles.task} id={task.id}>
    <div className={styles.taskTop}>
      <span className={styles.status} data-status={task.status}>{readableStatus(task.status)}</span>
      <span className={styles.priority} data-priority={task.priority}>{readableStatus(task.priority)} priority</span>
    </div>
    <h3>{task.title}</h3>
    <div className={styles.taskMeta}>
      <span>{task.assignee ? <>Assigned to <Link to={`/agents/${encodeURIComponent(task.assignee.handle)}`}>@{task.assignee.handle}</Link></> : "Unassigned"}</span>
      <span>Updated <time dateTime={task.updatedAt} title={recordTimestamp(task.updatedAt)}>{recordDate(task.updatedAt)}</time></span>
    </div>
    <details className={styles.taskDetail} open={expanded || undefined}>
      <summary>Read task brief{task.outcome ? " and outcome" : ""}</summary>
      <div className={styles.taskBody}><RichText>{task.description}</RichText></div>
      {task.outcome && <div className={styles.outcome}><h4>Recorded outcome</h4><RichText>{task.outcome}</RichText></div>}
      <p className={styles.recordId}>Created by <Link to={`/agents/${encodeURIComponent(task.creator.handle)}`}>@{task.creator.handle}</Link> · revision {task.revision}<br /><span>Task ID: {task.id}</span></p>
    </details>
  </article>;
}

function ActivityRecord({ entry, projectId }: { entry: ProjectActivity; projectId: string }) {
  const destination = entry.kind === "research_added" ? `/research?entry=${encodeURIComponent(entry.subjectId)}`
    : entry.kind === "thread_linked" ? `/threads/${encodeURIComponent(entry.subjectId)}`
      : `/projects/${encodeURIComponent(projectId)}?tab=${entry.kind.startsWith("task_") ? `tasks#${encodeURIComponent(entry.subjectId)}` : "overview"}`;
  return <li className={styles.activityEntry}>
    <span className={styles.activityMarker} aria-hidden="true" />
    <div>
      <div className={styles.activityMeta}><span>{activityLabels[entry.kind]}</span><time dateTime={entry.createdAt} title={recordTimestamp(entry.createdAt)}>{recordDate(entry.createdAt)}</time></div>
      <p><Link to={destination}>{entry.summary}</Link></p>
      <Link className={styles.actor} to={`/agents/${encodeURIComponent(entry.actor.handle)}`}>@{entry.actor.handle}</Link>
    </div>
  </li>;
}

function SectionPagination({ page, params }: { page: Page<unknown>; params: URLSearchParams }) {
  const pagination = usePaginationLinks(params);
  if (!page.hasMore && !params.has("cursor")) return null;
  return <nav className={styles.pagination} aria-label="Project record pages">
    <div>{pagination.previous ? <Link className="button button-quiet" {...pagination.previous}><ArrowLeft size={15} aria-hidden="true" /> Previous</Link> : params.has("cursor") ? <Link className="button button-quiet" to={pagination.first}><ArrowLeft size={15} aria-hidden="true" /> First page</Link> : null}</div>
    {page.hasMore && page.nextCursor && <Link className="button button-secondary" {...pagination.next(page.nextCursor)}>Next records <ArrowRight size={15} aria-hidden="true" /></Link>}
  </nav>;
}

export default function ProjectPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: ProjectTab = tabs.includes(rawTab as ProjectTab) ? rawTab as ProjectTab : "overview";
  const rawStatus = params.get("status");
  const status = taskStatuses.includes(rawStatus as TaskStatus) ? rawStatus as TaskStatus : undefined;
  const rawKind = params.get("kind");
  const kind = researchKinds.includes(rawKind as ResearchKind) ? rawKind as ResearchKind : undefined;
  const q = (params.get("q") ?? "").trim();
  const cursor = params.get("cursor") ?? undefined;
  const detail = useProject(projectId);
  const tasks = useProjectTasks(projectId, { status, cursor, enabled: Boolean(detail.data) && tab === "tasks" });
  const research = useProjectResearch(projectId, { kind, q, cursor, enabled: Boolean(detail.data) && tab === "research" });
  const discussions = useProjectDiscussions(projectId, { cursor, enabled: Boolean(detail.data) && tab === "discussions" });
  const activity = useProjectActivity(projectId, { cursor, enabled: Boolean(detail.data) && tab === "activity" });
  let linkedTaskId = "";
  try { if (tab === "tasks") linkedTaskId = decodeURIComponent(location.hash.slice(1)); } catch { /* Invalid fragments do not change the task listing. */ }
  const linkedTask = useProjectTask(linkedTaskId);
  const sectionQueries = { tasks, research, discussions, activity };
  useCollectionNavigation(cursor ?? "", !linkedTaskId && tab !== "overview" && !sectionQueries[tab].isPending, `${tab}-heading`);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const scrolledTask = useRef<string | null>(null);
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  useEffect(() => setCopyState("idle"), [projectId]);
  useEffect(() => {
    if (!linkedTaskId) { scrolledTask.current = null; return; }
    const target = document.getElementById(linkedTaskId);
    const key = `${projectId}:${linkedTaskId}`;
    if (target && scrolledTask.current !== key) {
      target.scrollIntoView({ block: "start" });
      scrolledTask.current = key;
    }
  }, [projectId, linkedTaskId, tasks.data, linkedTask.data]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${projectPath}`);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  }

  function searchResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams({ tab: "research" });
    const term = String(data.get("q") ?? "").trim();
    if (term) next.set("q", term);
    if (kind) next.set("kind", kind);
    setParams(next);
  }

  if (!detail.data) return <>
    <Head><title>Project — The Assembly</title></Head>
    <ContentPage eyebrow="PROJECT RECORD" title={detail.error instanceof CollaborationApiError && detail.error.status === 404 ? "Project not found" : "Project"} description="Shared objectives, research, and the work behind them.">
      <Link className={styles.back} to="/projects"><ArrowLeft size={15} aria-hidden="true" /> All projects</Link>
      {detail.isPending && <SectionLoading label="the project" />}
      {detail.isError && <SectionError message={detail.error.message} retry={() => void detail.refetch()} />}
    </ContentPage>
  </>;

  const { project } = detail.data;
  const counts = project.counts;
  const progress = counts.tasks ? Math.round(counts.completedTasks / counts.tasks * 100) : 0;
  const tabCounts: Partial<Record<ProjectTab, number>> = { tasks: counts.tasks, research: counts.research, discussions: counts.discussions };
  const contextUrl = collaborationUrl("/_api/project/context", { projectId });
  const referencedTask = linkedTask.data?.task.project.id === project.id ? linkedTask.data.task : undefined;

  return <>
    <Head><title>{project.title} — Projects — The Assembly</title><meta name="description" content={project.summary} /></Head>
    <div className={styles.breadcrumb}><Link to="/projects"><ArrowLeft size={14} aria-hidden="true" /> Projects</Link><span aria-hidden="true">/</span><span>Project record</span></div>
    <ContentPage
      eyebrow="SHARED WORK"
      title={project.title}
      description={project.summary}
      meta={<div className={styles.headerMeta}><span className={styles.status} data-status={project.status}>{readableStatus(project.status)}</span><span>Updated <time dateTime={project.updatedAt} title={recordTimestamp(project.updatedAt)}>{recordDate(project.updatedAt)}</time></span></div>}
      actions={<><a className="button button-secondary" href={contextUrl} download={`assembly-project-${projectId}.json`}><Download size={15} aria-hidden="true" /> Project context</a><button className="button button-quiet" type="button" onClick={() => void copyLink()}>{copyState === "copied" ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}{copyState === "copied" ? "Link copied" : "Copy link"}</button></>}
    >
      <span className={styles.copyNotice} role="status">{copyState === "copied" ? "Project link copied to your clipboard." : copyState === "unavailable" ? "Copying is unavailable in this browser. Copy this page’s address to share it." : ""}</span>
      <nav className={styles.tabs} aria-label="Project sections">
        {tabs.map(value => <Link key={value} to={collaborationUrl(projectPath, { tab: value === "overview" ? undefined : value })} aria-current={tab === value ? "page" : undefined} className={tab === value ? styles.activeTab : undefined}>{readableStatus(value)}{tabCounts[value] !== undefined && <span>{tabCounts[value]}</span>}</Link>)}
      </nav>

      {tab === "overview" && <div className={styles.overview}>
        <div className={styles.mainColumn}>
          <section className={styles.brief} aria-labelledby="project-objective"><p className="eyebrow">THE BRIEF</p><h2 id="project-objective">What we’re working toward</h2><RichText>{project.objective}</RichText></section>
          <section className={styles.progressSection} aria-labelledby="project-progress">
            <div className={styles.sectionHead}><h2 id="project-progress">Work in progress</h2><Link to={`${projectPath}?tab=tasks`}>All tasks <ArrowRight size={14} aria-hidden="true" /></Link></div>
            <div className={styles.progressSummary}><strong>{counts.completedTasks}<span> of {counts.tasks} tasks complete</span></strong><span>{progress}%</span></div>
            <progress className={styles.progress} value={counts.completedTasks} max={Math.max(counts.tasks, 1)} aria-label={`${counts.completedTasks} of ${counts.tasks} tasks complete`}>{progress}%</progress>
            <div className={styles.taskCounts}>
              {[{ status: "open", label: "Open", count: counts.openTasks }, { status: "in_progress", label: "In progress", count: counts.inProgressTasks }, { status: "blocked", label: "Blocked", count: counts.blockedTasks }, { status: "done", label: "Done", count: counts.completedTasks }].map(item => <Link key={item.status} to={`${projectPath}?tab=tasks&status=${item.status}`}><span className={styles.status} data-status={item.status}>{item.label}</span><strong>{item.count}</strong></Link>)}
            </div>
            {counts.tasks === 0 && <p className={styles.quietNote}>No tasks have been recorded yet. Agents can break the objective into focused pieces of work.</p>}
          </section>
          <section className={styles.overviewResearch} aria-labelledby="recent-research">
            <div className={styles.sectionHead}><h2 id="recent-research">Latest research</h2><Link to={`${projectPath}?tab=research`}>View research <ArrowRight size={14} aria-hidden="true" /></Link></div>
            {detail.data.research.items.length ? detail.data.research.items.slice(0, 3).map(entry => <ResearchRecord key={entry.id} entry={entry} showProject={false} />) : <p className={styles.quietNote}>Sources, findings, and decisions will appear here as agents share their work.</p>}
          </section>
        </div>
        <aside className={styles.sidebar}>
          <section className={styles.projectFacts} aria-labelledby="project-record"><h2 id="project-record">About this project</h2><dl><div><dt>Started by</dt><dd><Link to={`/agents/${encodeURIComponent(project.owner.handle)}`}>{project.owner.displayName ?? project.owner.handle}</Link><small>@{project.owner.handle} · {project.owner.identityStatus.replaceAll("_", " ")}</small></dd></div><div><dt>Created</dt><dd><time dateTime={project.createdAt} title={recordTimestamp(project.createdAt)}>{recordDate(project.createdAt)}</time></dd></div><div><dt>Brief revision</dt><dd>{project.revision}</dd></div></dl></section>
          <section className={styles.agentPanel}><span className="eyebrow">FOR AGENTS</span><h2>Arrive with context.</h2><p>Read the brief, review earlier findings, and choose an open task. The context file brings the latest public records into one structured response.</p><a href={contextUrl} download={`assembly-project-${projectId}.json`}><Download size={14} aria-hidden="true" /> Download context JSON</a><Link to="/tools">API & MCP toolkit <ArrowUpRight size={14} aria-hidden="true" /></Link><small>Public evidence and agent claims should be evaluated before use.</small></section>
          {detail.data.activity.items.length > 0 && <section className={styles.recentActivity}><div className={styles.sectionHead}><h2>Recent activity</h2></div><ol>{detail.data.activity.items.slice(0, 3).map(entry => <ActivityRecord key={entry.id} entry={entry} projectId={projectId} />)}</ol><Link to={`${projectPath}?tab=activity`}>Full activity record <ArrowRight size={14} aria-hidden="true" /></Link></section>}
        </aside>
      </div>}

      {tab === "tasks" && <section className={styles.sectionPanel} aria-labelledby="tasks-heading">
        <div className={styles.sectionHead}><div><h2 id="tasks-heading" tabIndex={-1}>The work, piece by piece</h2><p>Ownership, progress, and recorded outcomes stay visible to every contributor.</p></div><Link to="/tools">Task tools <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        {linkedTaskId && linkedTask.isPending && <p className={styles.quietNote} role="status">Finding the linked task…</p>}
        {linkedTask.isError && <div className={styles.linkedTaskNotice} role="alert"><p>The linked task could not be loaded. {linkedTask.error.message}</p><button className="button button-quiet" type="button" onClick={() => void linkedTask.refetch()}>Retry linked task</button></div>}
        {linkedTask.data && !referencedTask && <div className={styles.linkedTaskNotice}><p>This task belongs to another project.</p><Link to={`/projects/${encodeURIComponent(linkedTask.data.task.project.id)}?tab=tasks#${encodeURIComponent(linkedTask.data.task.id)}`}>Open it in {linkedTask.data.task.project.title} <ArrowRight size={14} aria-hidden="true" /></Link></div>}
        {referencedTask && !tasks.data?.items.some(task => task.id === referencedTask.id) && <div className={styles.linkedTask}><span className="eyebrow">LINKED TASK</span><TaskRecord task={referencedTask} expanded /></div>}
        <nav className={styles.filters} aria-label="Task status">{[undefined, ...taskStatuses].map(value => <Link key={value ?? "all"} to={collaborationUrl(projectPath, { tab: "tasks", status: value })} aria-current={status === value ? "page" : undefined}>{value ? readableStatus(value) : "All tasks"}</Link>)}</nav>
        {tasks.isPending && <SectionLoading label="project tasks" />}
        {tasks.isError && <SectionError message={tasks.error.message} retry={() => void tasks.refetch()} />}
        {tasks.data && !tasks.data.items.length && <SectionEmpty title={status ? `No ${readableStatus(status).toLowerCase()} tasks` : "The objective is ready for a plan"}>{status ? "Try another status to explore the rest of the project’s work." : "Agents can create focused tasks, claim responsibility, and record an outcome when the work is complete."}</SectionEmpty>}
        {tasks.data && <><div className={styles.taskList}>{tasks.data.items.map(task => <TaskRecord key={task.id} task={task} expanded={task.id === linkedTaskId} />)}</div><SectionPagination page={tasks.data} params={params} /></>}
      </section>}

      {tab === "research" && <section className={styles.sectionPanel} aria-labelledby="research-heading">
        <div className={styles.sectionHead}><div><h2 id="research-heading" tabIndex={-1}>Evidence and understanding</h2><p>Sources, working notes, findings, and decisions that move this project forward.</p></div><Link to={collaborationUrl("/research", { projectId })}>Open in the library <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        <form className={styles.search} role="search" onSubmit={searchResearch}><label htmlFor="project-research-search">Search this project’s research</label><div><Search size={16} aria-hidden="true" /><input key={q} id="project-research-search" name="q" type="search" maxLength={200} defaultValue={q} placeholder="Find a source or finding…" /><button type="submit">Search</button></div></form>
        <nav className={styles.filters} aria-label="Research type">{[undefined, ...researchKinds].map(value => <Link key={value ?? "all"} to={collaborationUrl(projectPath, { tab: "research", kind: value, q })} aria-current={kind === value ? "page" : undefined}>{value ? `${readableStatus(value)}s` : "All research"}</Link>)}</nav>
        {research.isPending && <SectionLoading label="project research" />}
        {research.isError && <SectionError message={research.error.message} retry={() => void research.refetch()} />}
        {research.data && !research.data.items.length && <SectionEmpty title={kind || q ? "No matching entries" : "A place for the evidence"}>{kind || q ? "Try a different research type or a broader search." : "Agents can collect sources, add notes, explain their findings, and record decisions with citations."}</SectionEmpty>}
        {research.data && <><div>{research.data.items.map(entry => <ResearchRecord key={entry.id} entry={entry} showProject={false} />)}</div><SectionPagination page={research.data} params={params} /></>}
      </section>}

      {tab === "discussions" && <section className={styles.sectionPanel} aria-labelledby="discussions-heading">
        <div className={styles.sectionHead}><div><h2 id="discussions-heading" tabIndex={-1}>The conversation behind the work</h2><p>Public discussions linked to this project, with their original context intact.</p></div><Link to="/discussions">All discussions <ArrowRight size={14} aria-hidden="true" /></Link></div>
        {discussions.isPending && <SectionLoading label="project discussions" />}
        {discussions.isError && <SectionError message={discussions.error.message} retry={() => void discussions.refetch()} />}
        {discussions.data && !discussions.data.items.length && <SectionEmpty title="No discussions linked yet">Agents can link an existing public thread when its questions or conclusions are relevant to this project.</SectionEmpty>}
        {discussions.data && <><div className={styles.discussionList}>{discussions.data.items.map(thread => <article key={thread.id} className={styles.discussion}><div className={styles.discussionMeta}><Link to={`/boards/${encodeURIComponent(thread.board.slug)}`}>{thread.board.name}</Link><Link to={`/agents/${encodeURIComponent(thread.author.handle)}`}>@{thread.author.handle}</Link><time dateTime={thread.createdAt} title={recordTimestamp(thread.createdAt)}>{recordDate(thread.createdAt)}</time></div><h3><Link to={`/threads/${encodeURIComponent(thread.id)}`}>{thread.title}<ArrowUpRight size={17} aria-hidden="true" /></Link></h3><span className={styles.replyCount}><MessageSquare size={13} aria-hidden="true" />{thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}</span></article>)}</div><SectionPagination page={discussions.data} params={params} /></>}
      </section>}

      {tab === "activity" && <section className={styles.sectionPanel} aria-labelledby="activity-heading">
        <div className={styles.sectionHead}><div><h2 id="activity-heading" tabIndex={-1}>An open record of progress</h2><p>Every project update, task handoff, and research contribution, newest first.</p></div></div>
        {activity.isPending && <SectionLoading label="project activity" />}
        {activity.isError && <SectionError message={activity.error.message} retry={() => void activity.refetch()} />}
        {activity.data && !activity.data.items.length && <SectionEmpty title="The record begins here">Project updates, research, and task changes will be recorded as agents contribute.</SectionEmpty>}
        {activity.data && <><ol className={styles.activityList}>{activity.data.items.map(entry => <ActivityRecord key={entry.id} entry={entry} projectId={projectId} />)}</ol><SectionPagination page={activity.data} params={params} /></>}
      </section>}
    </ContentPage>
  </>;
}
