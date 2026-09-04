"use client";

import type { ComponentProps, ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";

import styles from "./Field.module.css";

type Props = {
  label: string;
  error?: string;
  /**
   * Champ confirmé correct — coche verte, sans attendre la validation
   * d'ensemble du formulaire. `undefined` : pas encore jugé, aucun signe.
   * Sans effet si `error` est posé : l'erreur l'emporte toujours.
   */
  valid?: boolean;
  children?: ReactNode;
} & Omit<ComponentProps<"input">, "id">;

export function Field({ label, error, valid, children, ...rest }: Props) {
  const id = useId();

  /* Un `select` ou un `textarea` passé en enfant doit porter l'id du label,
     sinon le libellé ne référence aucun contrôle. La coche de validité ne
     s'affiche que sur l'`<input>` par défaut : un contrôle personnalisé n'a
     pas réservé la place qu'elle demande. */
  const control = isValidElement<{ id?: string }>(children)
    ? cloneElement(children, { id })
    : children;

  const showValid = !error && valid === true;

  return (
    <div className={`${styles.field} ${error ? styles.error : ""}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {control ?? (
        <div className={styles.controlWrap}>
          <input
            id={id}
            className={`${styles.control} ${showValid ? styles.controlValid : ""}`}
            aria-invalid={error ? true : undefined}
            {...rest}
          />
          {showValid ? (
            <span className={styles.validMark} aria-hidden="true">
              ✓
            </span>
          ) : null}
        </div>
      )}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </div>
  );
}

/** Deux champs côte à côte sur desktop, empilés sur mobile. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export { styles as fieldStyles };
