"use client";

import { useState } from "react";

import styles from "../expositions.module.css";

/**
 * Partage du lien public de l'exposition (§ 10) : la feuille de partage du
 * téléphone quand elle existe, sinon une copie dans le presse-papiers.
 */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href.split("?")[0]!;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* Partage annulé : on n'insiste pas. */
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      window.prompt("Copiez le lien de l’exposition :", url);
    }
  };

  return (
    <button type="button" className={styles.share} onClick={() => void share()}>
      {copied ? "Lien copié ✓" : "Partager l’exposition"}
    </button>
  );
}
