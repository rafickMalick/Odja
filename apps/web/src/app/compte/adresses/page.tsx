"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import {
  EmptyState,
  PageHead,
  Panel,
  workspaceStyles as styles,
} from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import addresses from "./addresses.module.css";

/**
 * Carnet d'adresses.
 *
 * Le champ « point de repère » n'est pas décoratif : dans la plupart des
 * villes desservies, c'est lui qui permet au livreur de trouver, pas le
 * numéro de rue. Il est donc mis en avant, avec un exemple.
 */

interface Address {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  city: string;
  cityId: string;
  line1: string;
  landmark: string | null;
  isDefault: boolean;
}

interface City {
  id: string;
  name: string;
}

const EMPTY = {
  label: "",
  fullName: "",
  phone: "",
  cityId: "",
  line1: "",
  landmark: "",
  isDefault: false,
};

export default function AddressesPage() {
  const [list, setList] = useState<Address[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [items, cityList] = await Promise.all([
      apiFetch<Address[]>("/me/addresses").catch(() => []),
      apiFetch<City[]>("/geo/cities").catch(() => []),
    ]);
    setList(items);
    setCities(cityList);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = () => {
    setValues({ ...EMPTY, isDefault: list.length === 0 });
    setErrors({});
    setEditing("new");
  };

  const startEdit = (address: Address) => {
    setValues({
      label: address.label ?? "",
      fullName: address.fullName,
      phone: address.phone,
      cityId: address.cityId,
      line1: address.line1,
      landmark: address.landmark ?? "",
      isDefault: address.isDefault,
    });
    setErrors({});
    setEditing(address.id);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage(null);

    const payload: Record<string, unknown> = {
      fullName: values.fullName,
      phone: values.phone,
      cityId: values.cityId,
      line1: values.line1,
      isDefault: values.isDefault,
    };
    if (values.label.trim()) payload["label"] = values.label.trim();
    if (values.landmark.trim()) payload["landmark"] = values.landmark.trim();

    try {
      await apiFetch(editing === "new" ? "/me/addresses" : `/me/addresses/${editing}`, {
        method: editing === "new" ? "POST" : "PATCH",
        body: payload,
      });
      setEditing(null);
      await load();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const item of error.problem.errors ?? []) fieldErrors[item.field] = item.message;
        setErrors(fieldErrors);
        setMessage(error.problem.errors?.length ? null : error.message);
      } else {
        setMessage("Enregistrement impossible.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Supprimer cette adresse ?")) return;
    await apiFetch(`/me/addresses/${id}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  return (
    <>
      <PageHead
        title="Mes adresses"
        subtitle="Celles que vous proposerez au moment de commander."
        action={
          editing === null ? (
            <Button type="button" onClick={startNew}>
              Ajouter une adresse
            </Button>
          ) : undefined
        }
      />

      {message ? <p className={styles.error}>{message}</p> : null}

      {editing !== null ? (
        <Panel title={editing === "new" ? "Nouvelle adresse" : "Modifier l’adresse"}>
          <form onSubmit={save} className={addresses.form} noValidate>
            <Field
              label="Nom de l’adresse (facultatif)"
              value={values.label}
              onChange={(event) => setValues({ ...values, label: event.target.value })}
              placeholder="Maison, bureau…"
              error={errors["label"]}
            />

            <FieldRow>
              <Field
                label="Destinataire"
                value={values.fullName}
                onChange={(event) => setValues({ ...values, fullName: event.target.value })}
                error={errors["fullName"]}
              />
              <Field
                label="Téléphone"
                type="tel"
                value={values.phone}
                onChange={(event) => setValues({ ...values, phone: event.target.value })}
                placeholder="+225 07 00 00 00 00"
                error={errors["phone"]}
              />
            </FieldRow>

            <Field label="Ville" error={errors["cityId"]}>
              <select
                className={fieldStyles.control}
                value={values.cityId}
                onChange={(event) => setValues({ ...values, cityId: event.target.value })}
              >
                <option value="">Choisir une ville</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Adresse"
              value={values.line1}
              onChange={(event) => setValues({ ...values, line1: event.target.value })}
              error={errors["line1"]}
            />

            <Field
              label="Point de repère"
              value={values.landmark}
              onChange={(event) => setValues({ ...values, landmark: event.target.value })}
              placeholder="En face de la pharmacie Sègbeya, portail bleu"
              error={errors["landmark"]}
            />
            <p className={styles.muted}>
              C’est ce dont le livreur se sert pour trouver. Soyez précis.
            </p>

            <label className={addresses.check}>
              <input
                type="checkbox"
                checked={values.isDefault}
                onChange={(event) =>
                  setValues({ ...values, isDefault: event.target.checked })
                }
              />
              <span>Utiliser par défaut</span>
            </label>

            <div className={styles.rowActions}>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel>
        {loading ? (
          <p className={styles.muted}>Chargement…</p>
        ) : list.length === 0 ? (
          <EmptyState
            title="Aucune adresse"
            text="Ajoutez-en une : elle sera proposée au moment de commander, et servira à calculer vos frais de livraison."
            action={
              <Button type="button" onClick={startNew}>
                Ajouter une adresse
              </Button>
            }
          />
        ) : (
          <ul className={addresses.list}>
            {list.map((address) => (
              <li key={address.id}>
                <div>
                  <p className={addresses.name}>
                    {address.label ?? address.fullName}
                    {address.isDefault ? <Badge type="success">Par défaut</Badge> : null}
                  </p>
                  <p className={styles.muted}>
                    {address.line1}, {address.city}
                  </p>
                  {address.landmark ? (
                    <p className={styles.muted}>Repère : {address.landmark}</p>
                  ) : null}
                  <p className={styles.muted}>
                    {address.fullName} · {address.phone}
                  </p>
                </div>
                <div className={styles.rowActions}>
                  <Button type="button" variant="outline" onClick={() => startEdit(address)}>
                    Modifier
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void remove(address.id)}>
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
