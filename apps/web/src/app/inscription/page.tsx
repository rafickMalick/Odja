"use client";

import { registerSchema } from "@oja/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AuthField,
  AuthLayout,
  authStyles as styles,
} from "@/components/AuthLayout";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { ApiError, apiFetch } from "@/lib/api";
import { homeForRole } from "@/lib/home-for-role";

/**
 * Inscription.
 *
 * Le compte s'ouvre à l'e-mail et le visiteur entre immédiatement. La
 * vérification du téléphone par SMS est mise de côté : payer un SMS pour
 * chaque curieux, dont la plupart ne commanderont jamais, coûte dix fois le
 * prix de la même vérification faite à la première commande.
 *
 * Le rôle se choisit ici, une seule fois : c'est lui qui décide de tout le
 * parcours qui suit. Un créateur et un livreur devront faire valider leur
 * dossier par Ojà avant de vendre ou de livrer — on le dit dès maintenant
 * plutôt que de le leur apprendre après coup.
 *
 * Chaque champ se juge **en le quittant**, avec le même schéma que l'API :
 * `registerSchema` vient de `@oja/contracts`, les deux ne peuvent donc pas
 * diverger. Un popup au clavier serait injouable — la coche verte ou le
 * message rouge restent à côté du champ, et le popup n'annonce que l'issue
 * d'ensemble, une fois qu'on valide.
 */
const ROLES = [
  {
    id: "CUSTOMER",
    title: "J’achète",
    text: "Commander des pièces d’artisans, suivre ma livraison.",
  },
  {
    id: "MAKER",
    title: "Je fabrique",
    text: "Vendre mes pièces. Un dossier sera à faire valider par Ojà.",
  },
  {
    id: "COURIER",
    title: "Je livre",
    text: "Assurer des courses. Un dossier sera à faire valider par Ojà.",
  },
] as const;

const TERMS_VERSION = "2026-08";

type FieldName = "firstName" | "lastName" | "email" | "phone" | "password";

/** Juge un champ isolément, avec le même schéma que l'inscription complète. */
function validateField(name: FieldName, value: string): string | null {
  const result = registerSchema.shape[name].safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "Champ invalide");
}

export default function InscriptionPage() {
  const router = useRouter();
  const { notify } = useToast();

  const [role, setRole] = useState<string>("CUSTOMER");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const set = (key: FieldName) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    // Une fois qu'un champ a été jugé une première fois, on le rejuge à
    // chaque frappe : l'utilisateur qui corrige veut voir l'erreur partir
    // tout de suite, pas seulement au prochain passage.
    if (touched[key]) {
      setFieldErrors((current) => {
        const message = validateField(key, value);
        const next = { ...current };
        if (message) next[key] = message;
        else delete next[key];
        return next;
      });
    }
  };

  const blur = (key: FieldName) => () => {
    setTouched((current) => ({ ...current, [key]: true }));
    const message = validateField(key, form[key]);
    setFieldErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  };

  const isValid = (key: FieldName) => touched[key] === true && !fieldErrors[key] && form[key] !== "";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Un dernier passage sur tous les champs avant l'envoi : un champ jamais
    // quitté (rempli, puis soumis sans en sortir) ne doit pas passer entre
    // les mailles du filet.
    const fields: FieldName[] = ["firstName", "lastName", "email", "phone", "password"];
    const finalErrors: Record<string, string> = {};
    for (const field of fields) {
      const message = validateField(field, form[field]);
      if (message) finalErrors[field] = message;
    }
    setTouched(Object.fromEntries(fields.map((field) => [field, true])));
    setFieldErrors(finalErrors);

    if (Object.keys(finalErrors).length > 0) {
      notify("Certains champs ne sont pas valides.", { tone: "error" });
      return;
    }

    setPending(true);
    setError(null);

    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: { role, ...form, acceptedTermsVersion: TERMS_VERSION },
      });

      notify("Compte créé.", { tone: "success" });

      /* Le compte est ouvert et la session posée : on entre directement. Un
         e-mail de confirmation part, mais il n'arrête personne — demander un
         détour par la boîte aux lettres perd le visiteur au moment précis où
         il vient d'arriver. Un créateur ou un livreur enchaîne aussitôt sur
         son dossier : c'est `homeForRole` qui l'y conduit. */
      router.refresh();
      router.push(role === "CUSTOMER" ? "/catalogue" : homeForRole(role));
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.errors) {
        const fromApi = Object.fromEntries(
          cause.problem.errors.map((issue) => [issue.field, issue.message]),
        );
        setFieldErrors(fromApi);
        setTouched(Object.fromEntries(Object.keys(fromApi).map((key) => [key, true])));
        setError("Certains champs doivent être corrigés.");
        notify("Certains champs doivent être corrigés.", { tone: "error" });
      } else {
        const message = cause instanceof ApiError ? cause.message : "Inscription impossible.";
        setError(message);
        notify(message, { tone: "error" });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <div className={styles.heading}>
        <h1 className={styles.title}>Créer un compte</h1>
      </div>

      <form className={styles.group} onSubmit={handleSubmit} noValidate>
        <p className={styles.groupTitle}>Vous êtes</p>

        <div className={styles.roleGrid}>
          {ROLES.map((option) => (
            <label
              key={option.id}
              className={`${styles.roleCard} ${
                role === option.id ? styles.roleCardActive : ""
              }`}
            >
              <input
                type="radio"
                name="role"
                value={option.id}
                checked={role === option.id}
                onChange={() => setRole(option.id)}
              />
              <span className={styles.roleTitle}>{option.title}</span>
              <span className={styles.roleText}>{option.text}</span>
            </label>
          ))}
        </div>

        <p className={styles.groupTitle}>Vos informations</p>

        <AuthField
          label="Prénom"
          value={form.firstName}
          onChange={set("firstName")}
          onBlur={blur("firstName")}
          error={touched.firstName ? fieldErrors["firstName"] : undefined}
          valid={isValid("firstName")}
          autoComplete="given-name"
          required
        />
        <AuthField
          label="Nom"
          value={form.lastName}
          onChange={set("lastName")}
          onBlur={blur("lastName")}
          error={touched.lastName ? fieldErrors["lastName"] : undefined}
          valid={isValid("lastName")}
          autoComplete="family-name"
          required
        />
        <AuthField
          label="Adresse e-mail"
          type="email"
          value={form.email}
          onChange={set("email")}
          onBlur={blur("email")}
          error={touched.email ? fieldErrors["email"] : undefined}
          valid={isValid("email")}
          autoComplete="email"
          required
        />
        <AuthField
          label="Téléphone"
          type="tel"
          placeholder="+225 07 00 00 00 00"
          value={form.phone}
          onChange={set("phone")}
          onBlur={blur("phone")}
          error={touched.phone ? fieldErrors["phone"] : undefined}
          valid={isValid("phone")}
          autoComplete="tel"
          required
        />
        <AuthField
          label="Mot de passe"
          type="password"
          value={form.password}
          onChange={set("password")}
          onBlur={blur("password")}
          error={touched.password ? fieldErrors["password"] : undefined}
          valid={isValid("password")}
          autoComplete="new-password"
          required
        />

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            required
          />
          <span className={styles.checkText}>
            J&apos;accepte les Conditions Générales et la Politique de
            Confidentialité d&apos;Ojà.
          </span>
        </label>

        {error ? (
          <p className={styles.legal} role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" fullWidth disabled={pending || !accepted}>
          {pending ? "Création…" : "Créer mon compte"}
        </Button>
      </form>

      <p className={styles.switch}>
        Déjà un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </AuthLayout>
  );
}
