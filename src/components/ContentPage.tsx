import { ReactNode } from "react";
import SiteHeader from "./SiteHeader";
import styles from "./ContentPage.module.css";

export default function ContentPage({
  eyebrow,
  title,
  description,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <SiteHeader />
      <section className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </section>
      <section className={styles.content}>{children}</section>
    </main>
  );
}
