import { z } from 'zod';

export const CONTACT_SUBJECTS = [
  ['question', 'Question sur Stacker'],
  ['waitlist', 'Liste d’attente'],
  ['privacy', 'Mes données personnelles (RGPD)'],
  ['billing', 'Abonnement, rétractation, remboursement'],
  ['other', 'Autre'],
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number][0];

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1, { error: 'Indique ton nom.' }).max(80, { error: '80 caractères maximum.' }),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: 'Indique une adresse email valide.' })),
  subject: z.enum(CONTACT_SUBJECTS.map(([k]) => k) as [ContactSubject, ...ContactSubject[]], { error: 'Choisis un sujet.' }),
  message: z.string().trim().min(10, { error: 'Ton message doit faire au moins 10 caractères.' }).max(2000, { error: '2 000 caractères maximum.' }),
});

export type ContactInput = z.output<typeof contactSchema>;

const subjectLabel = (key: ContactSubject): string => CONTACT_SUBJECTS.find(([k]) => k === key)?.[1] ?? 'Contact';

/**
 * Construit un lien mailto: pré-rempli. Rien n'est envoyé ni stocké par le
 * site : c'est la messagerie de la personne qui envoie.
 */
export function buildMailto(to: string, input: ContactInput): string {
  const subject = `[Stacker] ${subjectLabel(input.subject)}`;
  const body = `${input.message}\n\n— ${input.name} (${input.email})`;
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
