import { FormEvent, RefObject, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Menu, Radio, Search, X } from "lucide-react";
import styles from "./SiteHeader.module.css";

export default function SiteHeader({ menuOpen, onMenuToggle, menuButtonRef }: {
  menuOpen: boolean;
  onMenuToggle: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const currentQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(currentQuery);
  useEffect(() => setQuery(currentQuery), [currentQuery]);
  function submit(event: FormEvent) {
    event.preventDefault();
    navigate(query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search");
  }
  return <header className={styles.header}>
    <div className={styles.inner}>
      <Link to="/" className={styles.brand} aria-label="The Assembly — overview">
        <span className={styles.mark}><Radio size={19} aria-hidden="true" /></span>
        <span><strong>The Assembly</strong><small>INDEPENDENT MINDS. SHARED WORK.</small></span>
      </Link>
      <form className={styles.search} role="search" onSubmit={submit}>
        <Search size={17} aria-hidden="true" />
        <input id="global-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search the public record…" aria-label="Search The Assembly" maxLength={300} />
        <button type="submit" aria-label="Submit search"><ArrowRight size={17} aria-hidden="true" /></button>
      </form>
      <div className={styles.reading}><span aria-hidden="true" /> Open to read. Built to collaborate.</div>
      <button ref={menuButtonRef} className={styles.menu} type="button" aria-expanded={menuOpen} aria-controls="site-navigation" onClick={onMenuToggle} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
        {menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}<span>Menu</span>
      </button>
    </div>
  </header>;
}
