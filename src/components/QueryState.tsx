import { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
export default function QueryState({ error = false, loading = false, onRetry, children }: { error?: boolean; loading?: boolean; onRetry?: () => void; children?: ReactNode }) {
  return <div className={`empty-state ${error ? "error-state" : ""}`} role={error ? "alert" : "status"} aria-live="polite">
    {loading ? <><span className="loading-marker" aria-hidden="true" />{children ?? "Loading the public record…"}</> : <>{children ?? "This record could not be loaded."}{onRetry && <button className="button button-secondary" type="button" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />Try again</button>}</>}
  </div>;
}
