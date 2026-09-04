import { z } from 'zod';

/**
 * Contrats d'authentification, partagés entre l'API et le front.
 *
 * Un seul schéma par entrée : le front valide avec le même objet que l'API,
 * donc les deux ne peuvent pas diverger. C'est l'intérêt de ce paquet.
 */

/**
 * Numéro au format E.164. Sur ce marché le téléphone est l'identité :
 * on le normalise à l'entrée plutôt que d'accepter six écritures du même
 * numéro. `07 08 09 10 11` et `+2250708091011` doivent désigner un seul compte.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s.\-()]/g, ''))
  .refine((value) => /^\+[1-9]\d{7,14}$/.test(value), {
    message: 'Numéro attendu au format international, par exemple +2250708091011',
  });

export const emailSchema = z.string().trim().toLowerCase().email('Adresse e-mail invalide');

/**
 * Le mot de passe est borné par le bas **et par le haut**. La borne haute
 * n'est pas cosmétique : argon2 travaille sur l'entrée entière, et une chaîne
 * d'un mégaoctet occuperait un cœur pendant des secondes. C'est un déni de
 * service gratuit.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit faire au moins 10 caractères')
  .max(256, 'Le mot de passe ne peut pas dépasser 256 caractères');

export const userRoleSchema = z.enum(['CUSTOMER', 'MAKER', 'COURIER']);

/** L'inscription n'ouvre jamais un compte administrateur (cahier § 2.2). */
export const registerSchema = z.object({
  role: userRoleSchema,
  firstName: z.string().trim().min(2, 'Nom trop court').max(80),
  lastName: z.string().trim().min(2, 'Prénom trop court').max(80),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  acceptedTermsVersion: z.string().min(1, 'Les conditions doivent être acceptées'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyPhoneSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Le code comporte 6 chiffres'),
});
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;

export const resendCodeSchema = z.object({ phone: phoneSchema });
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;

/** Confirmation d'adresse e-mail. Le jeton vient du lien reçu, pas d'un code
 *  recopié : rien à taper, donc rien à raccourcir. */
export const verifyEmailSchema = z.object({
  token: z.string().trim().min(20, 'Lien incomplet'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendEmailSchema = z.object({ email: emailSchema });
export type ResendEmailInput = z.infer<typeof resendEmailSchema>;

/** La connexion accepte l'e-mail ou le téléphone : les deux identifient. */
export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3) });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  identifier: z.string().trim().min(3),
  code: z.string().trim().regex(/^\d{6}$/, 'Le code comporte 6 chiffres'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Modification de son propre profil.
 *
 * Ni l'e-mail ni le téléphone n'y figurent : ce sont les deux identifiants de
 * connexion, et les changer demande de re-vérifier le nouveau canal avant
 * d'abandonner l'ancien. C'est un parcours à part entière, pas un champ de
 * formulaire.
 */
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2, 'Nom trop court').max(80).optional(),
  lastName: z.string().trim().min(2, 'Prénom trop court').max(80).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Changement de mot de passe par un utilisateur connecté.
 *
 * L'ancien mot de passe est exigé : sans lui, une session volée suffirait à
 * verrouiller le compte de son propriétaire.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  password: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Représentation publique d'un utilisateur — jamais de hash, jamais de secret. */
export interface PublicUser {
  id: string;
  role: 'CUSTOMER' | 'MAKER' | 'COURIER' | 'ADMIN';
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  emailVerified: boolean;
}
