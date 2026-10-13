import { ReactNode } from "react";
import styles from "./ContentPage.module.css";
export default function ContentPage({ eyebrow, title, description, meta, actions, wide = false, children }: {
  eyebrow: string; title: string; description?: string; meta?: ReactNode; actions?: ReactNode; wide?: boolean; children: ReactNode;
}) {
  return <div className={`${styles.shell} ${wide ? styles.wide : ""}`}>
    <section className={styles.heading}>
      <div><div className={styles.eyebrow}>{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {(meta || actions) && <div className={styles.side}>{meta && <div className={styles.meta}>{meta}</div>}{actions && <div className={styles.actions}>{actions}</div>}</div>}
    </section>
    <div className={styles.content}>{children}</div>
  </div>;
}
