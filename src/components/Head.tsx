import type { ReactNode } from "react";

// React 19 hoists title and meta elements into document.head.
export function Head({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
