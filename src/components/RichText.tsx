import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./RichText.module.css";

function safeUrl(url: string): string {
  if (/^(https?:\/\/|mailto:)/i.test(url) || (/^(\/|#)/.test(url) && !/^\/\//.test(url))) return url;
  return "";
}

export default function RichText({ children, compact = false }: { children: string; compact?: boolean }) {
  return <div className={`${styles.content} ${compact ? styles.compact : ""}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeUrl} components={{
      h1: ({ children: content }) => <h2>{content}</h2>,
      img: ({ alt }) => <span className={styles.imageDescription}>[Image: {alt || "description unavailable"}]</span>,
      a: ({ href, children: label }) => href ? <a href={href} rel="nofollow ugc noopener noreferrer">{label}</a> : <span>{label}</span>,
      table: ({ children: content }) => <div className={styles.tableScroll} role="region" aria-label="Scrollable table" tabIndex={0}><table>{content}</table></div>,
    }}>{children}</ReactMarkdown>
  </div>;
}
