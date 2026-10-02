"use client";

import type { TicketView } from "@oja/contracts";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field, FieldRow, fieldStyles } from "@/components/Field";
import { workspaceStyles as styles } from "@/components/dashboard/Workspace";
import { ApiError, apiFetch } from "@/lib/api";

import { AttachmentPicker, type PendingAttachment } from "./Attachments";
import support from "./support.module.css";

/**
 * Nouvelle demande au service client, depuis un espace connecté.
 *
 * Rien à ressaisir : l'identité vient du compte, et l'API l'attache à la
 * demande. Les types de problème viennent de l'API, selon l'espace (acheteur
 * ou créateur). La commande concernée n'est proposée qu'à l'acheteur.
 */
export function NewTicketForm({
  identity,
  orders,
  onCreated,
}: {
  identity: { name: string; email: string } | null;
  /** Commandes de l'acheteur ; absent pour un créateur. */
  orders?: { reference: string; label: string }[];
  onCreated: (ticket: TicketView) => void;
}) {
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);

  useEffect(() => {
    void apiFetch<Record<string, string>>("/support/tickets/categories")
      .then((list) => setCategories(list))
      .catch(() => setCategories({}));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ticket = await apiFetch<TicketView>("/support/tickets", {
        method: "POST",
        body: {
          category,
          subject: subject.trim(),
          message: message.trim(),
          ...(orderReference ? { orderReference } : {}),
          fileKeys: attachments.map((file) => file.fileKey),
        },
      });
      setCategory("");
      setSubject("");
      setMessage("");
      setOrderReference("");
      setAttachments([]);
      onCreated(ticket);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : "Envoi impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;
  const formError =
    error instanceof ApiError ? (error.problem.errors?.length ? null : error.message) : error;

  return (
    <form onSubmit={submit} className={support.fields}>
      {identity ? (
        <p className={support.meta}>
          <span>
            Envoyé au nom de <strong>{identity.name}</strong>
          </span>
          <span>Réponse à {identity.email}</span>
        </p>
      ) : null}

      <FieldRow>
        <Field label="Type de problème *" error={fieldError("category")}>
          <select
            className={fieldStyles.control}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
          >
            <option value="" disabled>
              Choisir…
            </option>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        {orders ? (
          <Field label="Commande concernée" error={fieldError("orderReference")}>
            <select
              className={fieldStyles.control}
              value={orderReference}
              onChange={(event) => setOrderReference(event.target.value)}
            >
              <option value="">Aucune en particulier</option>
              {orders.map((order) => (
                <option key={order.reference} value={order.reference}>
                  {order.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </FieldRow>

      <Field label="Sujet *" error={fieldError("subject")}>
        <input
          className={fieldStyles.control}
          value={subject}
          maxLength={140}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Résumez votre demande en une phrase"
          required
        />
      </Field>

      <Field label="Message *" error={fieldError("message")}>
        <textarea
          className={`${fieldStyles.control} ${fieldStyles.textarea}`}
          rows={5}
          value={message}
          minLength={10}
          maxLength={5000}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Décrivez la situation le plus précisément possible."
          required
        />
      </Field>

      <AttachmentPicker value={attachments} onChange={setAttachments} />

      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}

      <div className={styles.rowActions}>
        <Button type="submit" disabled={busy || !category}>
          {busy ? "Envoi…" : "Envoyer la demande"}
        </Button>
      </div>
    </form>
  );
}
