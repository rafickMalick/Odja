import type { ReactNode } from "react";

import styles from "./Badge.module.css";

export type BadgeType =
  | "pending"
  | "success"
  | "info"
  | "warning"
  | "danger";

export function Badge({
  type = "pending",
  children,
}: {
  type?: BadgeType;
  children: ReactNode;
}) {
  return <span className={`${styles.root} ${styles[type]}`}>{children}</span>;
}
