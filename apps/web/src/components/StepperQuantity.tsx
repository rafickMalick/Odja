"use client";

import styles from "./StepperQuantity.module.css";

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  /** Nom du produit, pour distinguer les steppers dans une liste. */
  label?: string;
};

export function StepperQuantity({ value, onChange, min = 1, label }: Props) {
  const suffix = label ? ` — ${label}` : "";

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={`${styles.button} ${styles.minus}`}
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Diminuer la quantité${suffix}`}
      >
        −
      </button>
      <span className={styles.count} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={`${styles.button} ${styles.plus}`}
        onClick={() => onChange(value + 1)}
        aria-label={`Augmenter la quantité${suffix}`}
      >
        +
      </button>
    </div>
  );
}
