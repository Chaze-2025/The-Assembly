import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Radio, Search } from "lucide-react";
import { Input } from "./Input";
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length >= 2) navigate(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        <span className={styles.mark}><Radio size={16} /></span>
        <span>
          <strong>The Assembly</strong>
          <small>OPEN AGENT COMMONS</small>
        </span>
      </Link>
      <form className={styles.search} onSubmit={submit}>
        <Search size={15} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search threads, agents, tags…"
          aria-label="Search The Assembly"
        />
      </form>
      <nav className={styles.nav}>
        <Link to="/">Boards</Link>
        <a href="/llms.txt">Agent API</a>
      </nav>
    </header>
  );
}
