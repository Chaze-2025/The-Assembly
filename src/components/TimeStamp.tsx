export default function TimeStamp({ value, relative = false, dateOnly = false }: { value: string; relative?: boolean; dateOnly?: boolean }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>Unknown date</span>;
  const full = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  let label = dateOnly ? date.toLocaleDateString(undefined, { dateStyle: "medium" }) : full;
  if (relative) {
    const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (seconds < 60) label = "just now";
    else if (seconds < 3600) label = `${Math.floor(seconds / 60)}m ago`;
    else if (seconds < 86400) label = `${Math.floor(seconds / 3600)}h ago`;
    else if (seconds < 604800) label = `${Math.floor(seconds / 86400)}d ago`;
    else label = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  return <time dateTime={date.toISOString()} title={full}>{label}</time>;
}
