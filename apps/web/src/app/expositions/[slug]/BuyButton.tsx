"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { useCart } from "@/lib/cart";

/**
 * Achat d'une œuvre exposée (§ 9.1) : elle rejoint le panier, puis le
 * parcours de commande, de paiement et de livraison habituel. Le visiteur à
 * distance achète exactement comme sur place.
 */
export function BuyButton({ productId }: { productId: string }) {
  const router = useRouter();
  const { add } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const buy = async () => {
    setBusy(true);
    setError(false);
    try {
      await add(productId);
      router.push("/panier");
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" onClick={() => void buy()} disabled={busy}>
        {busy ? "Ajout…" : "Acheter"}
      </Button>
      {error ? <span role="alert">Cette œuvre vient d’être réservée.</span> : null}
    </>
  );
}
