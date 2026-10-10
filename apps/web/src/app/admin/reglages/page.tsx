"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { PageHead, Panel, workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";
import { formatFcfa, formatNumber } from "@/lib/format";

/**
 * Paramétrage.
 *
 * Le cahier (§ 13) pose une exigence forte : **ouvrir un pays doit être un
 * réglage, pas un déploiement**. Cet écran la rend vraie  un interrupteur,
 * et le catalogue de ce pays devient visible. Les grilles tarifaires et les
 * moyens de paiement y sont affichés en lecture : les modifier touche au
 * calcul des prix, ce qui mérite une migration tracée plutôt qu'un champ
 * libre.
 */

interface Settings {
  countries: {
    id: string;
    name: string;
    code: string;
    currency: string;
    vatBps: number;
    isActive: boolean;
    cityCount: number;
  }[];
  vehicleRates: {
    id: string;
    country: string;
    vehicle: string;
    baseFeeXof: number;
    perKmXof: number;
    minFeeXof: number;
    maxWeightKg: number;
  }[];
  paymentMethods: {
    id: string;
    country: string;
    channel: string;
    operator: string;
    label: string;
    feeBps: number;
    isActive: boolean;
  }[];
}

const VEHICLES: Record<string, string> = {
  MOTO: "Moto",
  TRICYCLE: "Tricycle",
  CAMIONNETTE: "Camionnette",
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSettings(await apiFetch<Settings>("/admin/settings").catch(() => null));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCountry = async (id: string, isActive: boolean) => {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/admin/settings/countries/${id}/active`, {
        method: "POST",
        body: { isActive },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Modification impossible.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className={styles.muted}>Chargement…</p>;
  if (!settings) return <p className={styles.error}>Réglages indisponibles.</p>;

  return (
    <>
      <PageHead
        title="Réglages"
        subtitle="Ouvrir un pays est un interrupteur : aucun déploiement n’est nécessaire."
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      <Panel title="Pays desservis">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pays</th>
                <th>Devise</th>
                <th className={styles.numeric}>Villes</th>
                <th className={styles.numeric}>TVA</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.countries.map((country) => (
                <tr key={country.id}>
                  <td>
                    {country.name} <span className={styles.muted}>({country.code})</span>
                  </td>
                  <td>{country.currency}</td>
                  <td className={styles.numeric}>{country.cityCount}</td>
                  <td className={styles.numeric}>
                    {country.vatBps === 0 ? "Non définie" : `${formatNumber(country.vatBps / 100, 2)} %`}
                  </td>
                  <td>
                    {country.isActive ? (
                      <Badge type="success">Ouvert</Badge>
                    ) : (
                      <Badge type="pending">Fermé</Badge>
                    )}
                  </td>
                  <td className={styles.rowActions}>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy === country.id}
                      onClick={() => void toggleCountry(country.id, !country.isActive)}
                    >
                      {country.isActive ? "Fermer" : "Ouvrir"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted}>
          Fermer un pays retire son catalogue de la vitrine. Les commandes en cours
          poursuivent leur cycle.
        </p>
      </Panel>

      <Panel title="Grilles de livraison">
        <p className={styles.muted}>
          Ces valeurs décident du véhicule choisi et du prix affiché au client. Elles se
          modifient par migration, pour rester tracées.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pays</th>
                <th>Véhicule</th>
                <th className={styles.numeric}>Prise en charge</th>
                <th className={styles.numeric}>Au km</th>
                <th className={styles.numeric}>Minimum</th>
                <th className={styles.numeric}>Charge max</th>
              </tr>
            </thead>
            <tbody>
              {settings.vehicleRates.map((rate) => (
                <tr key={rate.id}>
                  <td>{rate.country}</td>
                  <td>{VEHICLES[rate.vehicle] ?? rate.vehicle}</td>
                  <td className={styles.numeric}>{formatFcfa(rate.baseFeeXof)}</td>
                  <td className={styles.numeric}>{formatFcfa(rate.perKmXof)}</td>
                  <td className={styles.numeric}>{formatFcfa(rate.minFeeXof)}</td>
                  <td className={styles.numeric}>{formatNumber(rate.maxWeightKg)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Moyens de paiement">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Pays</th>
                <th>Moyen</th>
                <th>Canal</th>
                <th className={styles.numeric}>Frais</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {settings.paymentMethods.map((method) => (
                <tr key={method.id}>
                  <td>{method.country}</td>
                  <td>{method.label}</td>
                  <td>{method.channel}</td>
                  <td className={styles.numeric}>{formatNumber(method.feeBps / 100, 2)} %</td>
                  <td>
                    {method.isActive ? (
                      <Badge type="success">Actif</Badge>
                    ) : (
                      <Badge type="pending">Inactif</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted}>
          Les frais sont ceux de l’agrégateur, retenus sur l’encaissement. Tant que KKiaPay
          n’est pas branché, un fournisseur simulé les reproduit.
        </p>
      </Panel>
    </>
  );
}
