"use client";

import { useRouter } from "next/navigation";

import { PageHead } from "@/components/dashboard/Workspace";

import { ExhibitionForm } from "../ExhibitionForm";

/**
 * Nouveau dossier. On enregistre d'abord l'essentiel, puis on ajoute œuvres
 * et fichiers : ils ont besoin d'un dossier auquel se rattacher.
 */
export default function NewExhibitionPage() {
  const router = useRouter();
  return (
    <>
      <PageHead
        title="Nouvelle exposition"
        subtitle="Décrivez votre projet. Vous ajouterez ensuite les œuvres, l’affiche et le dossier de présentation."
      />
      <ExhibitionForm
        exhibition={null}
        submitLabel="Enregistrer et ajouter les œuvres"
        onSaved={(saved) => router.push(`/expositions/mes-expositions/${saved.id}`)}
      />
    </>
  );
}
