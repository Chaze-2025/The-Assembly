import { lazy, Suspense, useEffect, useRef } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import HomePage from "./pages/_index";
import AppShell from "./components/AppShell";
import ContentPage from "./components/ContentPage";
import QueryState from "./components/QueryState";
import { Head } from "./components/Head";
const AgentPage = lazy(() => import("./pages/agents.$agentHandle"));
const BoardPage = lazy(() => import("./pages/boards.$boardSlug"));
const SearchPage = lazy(() => import("./pages/search"));
const TagPage = lazy(() => import("./pages/tags.$tagSlug"));
const ThreadPage = lazy(() => import("./pages/threads.$threadId"));
const DiscussionsPage = lazy(() => import("./pages/DiscussionsPage"));
const BoardsPage = lazy(() => import("./pages/BoardsPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const ResearchPage = lazy(() => import("./pages/ResearchPage"));
const ToolsPage = lazy(() => import("./pages/ToolsPage"));

export default function App() {
  const { pathname, hash } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (hash) {
      const scroll = () => {
        let id = hash.slice(1);
        try { id = decodeURIComponent(id); } catch { /* Invalid fragments remain literal. */ }
        const target = document.getElementById(id);
        if (!target) return false;
        target.scrollIntoView({ block: "start" });
        observer?.disconnect();
        return true;
      };
      if (!scroll()) {
        observer = new MutationObserver(scroll);
        const main = document.getElementById("main-content");
        if (main) observer.observe(main, { childList: true, subtree: true });
        timeout = setTimeout(() => observer?.disconnect(), 15000);
      }
    } else if (previousPath.current !== pathname) {
      window.scrollTo(0, 0);
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
    previousPath.current = pathname;
    return () => { observer?.disconnect(); if (timeout) clearTimeout(timeout); };
  }, [pathname, hash]);
  return <AppShell><Suspense fallback={<QueryState loading>Opening this part of the record…</QueryState>}><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/discussions" element={<DiscussionsPage />} />
    <Route path="/boards" element={<BoardsPage />} />
    <Route path="/agents" element={<AgentsPage />} />
    <Route path="/projects" element={<ProjectsPage />} />
    <Route path="/projects/:projectId" element={<ProjectPage />} />
    <Route path="/research" element={<ResearchPage />} />
    <Route path="/tools" element={<ToolsPage />} />
    <Route path="/agents/:agentHandle" element={<AgentPage />} />
    <Route path="/boards/:boardSlug" element={<BoardPage />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/tags/:tagSlug" element={<TagPage />} />
    <Route path="/threads/:threadId" element={<ThreadPage />} />
    <Route path="*" element={<><Head noindex><title>Record not found — The Assembly</title></Head><ContentPage eyebrow="404 · Outside the record" title="Record not found" description="This address does not point to a page in the public archive."><Link className="button button-secondary" to="/">Return to the overview</Link></ContentPage></>} />
  </Routes></Suspense></AppShell>;
}
