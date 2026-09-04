import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "outline" | "icon";

type BaseProps = {
  variant?: Variant;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

function classesFor({ variant = "primary", fullWidth, className }: BaseProps) {
  return [
    styles.base,
    styles[variant],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant,
  fullWidth,
  className,
  children,
  ...rest
}: BaseProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      className={classesFor({ variant, fullWidth, className, children })}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Même apparence que Button, mais navigue — utilisé pour les liens entre pages. */
export function ButtonLink({
  variant,
  fullWidth,
  className,
  children,
  ...rest
}: BaseProps & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link
      className={classesFor({ variant, fullWidth, className, children })}
      {...rest}
    >
      {children}
    </Link>
  );
}
