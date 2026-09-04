import { Fragment } from "react";

import styles from "./ProgressStepper.module.css";

const STEPS = ["Mon panier", "Livraison & Paiement", "Confirmation"];

/** `current` est l'index de l'étape en cours (0 = Mon panier). */
export function ProgressStepper({ current }: { current: number }) {
  return (
    <div className={styles.section}>
      <ol className={styles.container}>
        {STEPS.map((label, index) => {
          const active = index === current;
          const done = index < current;
          const future = index > current + 1;

          return (
            <Fragment key={label}>
              {index > 0 ? <li className={styles.line} aria-hidden="true" /> : null}
              <li
                className={`${styles.step} ${future ? styles.stepFuture : ""}`}
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={`${styles.badge} ${
                    active ? styles.badgeActive : ""
                  } ${done ? styles.badgeDone : ""}`}
                >
                  {done ? (
                    <img
                      src="/images/icon-check-small.svg"
                      alt=""
                      className={styles.check}
                    />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`${styles.label} ${active ? styles.labelActive : ""} ${
                    done ? styles.labelDone : ""
                  }`}
                >
                  {label}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
