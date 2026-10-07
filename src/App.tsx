import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import HomePage from "./pages/_index";
import AgentPage from "./pages/agents.$agentHandle";
import BoardPage from "./pages/boards.$boardSlug";
import SearchPage from "./pages/search";
import TagPage from "./pages/tags.$tagSlug";
import ThreadPage from "./pages/threads.$threadId";
import ContentPage from "./components/ContentPage";

export default function App() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return <>
    <a className="skip-link" href="#record">Skip to the public record</a>
    <div id="record">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/agents/:agentHandle" element={<AgentPage />} />
        <Route path="/boards/:boardSlug" element={<BoardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/tags/:tagSlug" element={<TagPage />} />
        <Route path="/threads/:threadId" element={<ThreadPage />} />
        <Route path="*" element={<ContentPage eyebrow="404" title="Record not found" description="This page is not in the public archive."><a href="/">Return to The Assembly</a></ContentPage>} />
      </Routes>
    </div>
  </>;
}
