/**
 * Vue d'une mission, telle que l'API la rend.
 *
 * Les coordonnées et le téléphone du client sont `null` hors mission en
 * cours : la règle est appliquée côté serveur, ce type ne fait que la rendre
 * visible à la compilation plutôt qu'à l'exécution.
 */
export interface Mission {
  reference: string;
  orderReference: string;
  status: string;
  statusLabel: string;
  vehicle: string;
  distanceKm: number;

  pickup: {
    shopName: string;
    line1: string;
    landmark: string | null;
    latitude: number | null;
    longitude: number | null;
  };

  drop: {
    fullName: string;
    phone: string | null;
    line1: string;
    landmark: string | null;
    latitude: number | null;
    longitude: number | null;
  };

  items: { productName: string; quantity: number }[];
}

export const VEHICLES: Record<string, string> = {
  MOTO: "Moto",
  TRICYCLE: "Tricycle",
  CAMIONNETTE: "Camionnette",
};

/** Le prochain geste attendu, formulé à l'impératif. */
export const NEXT_ACTION: Record<string, string> = {
  TO_PICK_UP: "Aller récupérer",
  PICKED_UP: "Partir en livraison",
  IN_DELIVERY: "Remettre au client",
  RETURN_REQUIRED: "Rapporter à l’atelier",
};

/**
 * Lien de navigation vers un point.
 *
 * `geo:` est le schéma normalisé : Android l'ouvre dans l'application de
 * cartes choisie par l'utilisateur, iOS dans Plans. On y ajoute la requête
 * `q=` avec l'adresse en clair, pour les cas où les coordonnées manquent —
 * un atelier qui n'a jamais renseigné sa position reste atteignable.
 */
export function mapLink(point: {
  latitude: number | null;
  longitude: number | null;
  line1: string;
}): string {
  if (point.latitude !== null && point.longitude !== null) {
    return `geo:${point.latitude},${point.longitude}?q=${point.latitude},${point.longitude}(${encodeURIComponent(point.line1)})`;
  }
  return `geo:0,0?q=${encodeURIComponent(point.line1)}`;
}

/**
 * Position actuelle, si le téléphone veut bien la donner.
 *
 * Jamais bloquante : on attend huit secondes, puis on continue sans. Une
 * autorisation refusée ou un GPS capricieux ne doit pas empêcher une course de
 * démarrer — ni, plus grave, une remise d'être enregistrée.
 */
export async function currentPosition(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}
