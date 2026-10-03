import styles from "./Stars.module.css";

/**
 * Note sur cinq, en étoiles.
 *
 * Lue par un lecteur d'écran comme « 4 sur 5 » : les étoiles elles-mêmes ne
 * sont que décoratives.
 */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span
      className={styles.stars}
      style={{ fontSize: size }}
      role="img"
      aria-label={`${formatRating(value)} sur 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          aria-hidden="true"
          className={
            rounded >= star ? styles.full : rounded >= star - 0.5 ? styles.half : styles.empty
          }
        >
          ★
        </span>
      ))}
    </span>
  );
}

/** Choix d'une note, au clavier comme à la souris : un groupe de boutons radio. */
export function StarsInput({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (value: number) => void;
  name: string;
}) {
  return (
    <fieldset className={styles.input}>
      <legend className="srOnly">Votre note</legend>
      {[1, 2, 3, 4, 5].map((star) => (
        <label key={star} className={value >= star ? styles.full : styles.empty}>
          <input
            type="radio"
            name={name}
            value={star}
            checked={value === star}
            onChange={() => onChange(star)}
            className="srOnly"
          />
          <span aria-hidden="true">★</span>
          <span className="srOnly">
            {star} étoile{star > 1 ? "s" : ""}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function formatRating(value: number): string {
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}
