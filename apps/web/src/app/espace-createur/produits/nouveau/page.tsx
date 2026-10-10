"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHead } from "@/components/dashboard/Workspace";
import { apiFetch } from "@/lib/api";

import { EMPTY_PRODUCT, ProductForm } from "../ProductForm";

/**
 * Création d'une pièce.
 *
 * On enregistre d'abord la fiche, puis on redirige vers son édition pour les
 * photos : elles ont besoin d'un identifiant de produit auquel se rattacher, et
 * demander cinq photos avant même d'avoir saisi un nom découragerait n'importe
 * qui sur une connexion mobile.
 */
export default function NewProductPage() {
  const router = useRouter();
  const [commissionBps, setCommissionBps] = useState(1_000);

  useEffect(() => {
    void apiFetch<{ commissionBps: number }>("/maker/profile")
      .then((profile) => setCommissionBps(profile.commissionBps))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <PageHead
        title="Ajouter une pièce"
        subtitle="Enregistrez la fiche, puis ajoutez les photos. Rien n’est publié avant votre envoi en validation."
      />

      <ProductForm
        initial={EMPTY_PRODUCT}
        guided
        commissionBps={commissionBps}
        submitLabel="Enregistrer et passer aux photos"
        onSubmit={async (payload) => {
          const created = await apiFetch<{ id: string }>("/maker/products", {
            method: "POST",
            body: payload,
          });
          router.push(`/espace-createur/produits/${created.id}`);
        }}
      />
    </>
  );
}
