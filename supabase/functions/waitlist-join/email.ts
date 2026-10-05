/**
 * Email de confirmation d'inscription à la liste d'attente.
 * Contenu transactionnel uniquement (pas de prospection) : Brevo l'autorise.
 * Aucune promesse de gain ni de date de versement, aucun montant.
 */
import type { EmailMessage } from './services.ts';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export interface ConfirmationEmailInput {
  email: string;
  firstName: string;
  position: number;
  referralUrl: string;
  siteUrl: string;
  contactEmail: string | null;
}

export function buildConfirmationEmail(input: ConfirmationEmailInput): EmailMessage {
  const name = escapeHtml(input.firstName);
  const position = new Intl.NumberFormat('fr-FR').format(input.position);
  const referral = escapeHtml(input.referralUrl);
  const privacyUrl = escapeHtml(`${input.siteUrl}/confidentialite`);
  const rightsText = `Pour accéder à tes données, les rectifier ou les supprimer, ${
    input.contactEmail ? `écris à ${input.contactEmail}` : `consulte ${input.siteUrl}/confidentialite`
  }.`;
  const rightsHtml = `Pour accéder à tes données, les rectifier ou les supprimer, ${
    input.contactEmail ? `écris à ${escapeHtml(input.contactEmail)}` : `consulte ${privacyUrl}`
  }.`;

  const text = [
    `Bonjour ${input.firstName},`,
    '',
    'Ton inscription sur la liste d’attente de Stacker est confirmée.',
    `Ta position : n° ${position}.`,
    '',
    'Stacker ouvre le 20 octobre 2026. Les inscrits sont prévenus par email, dans l’ordre d’inscription, et ont priorité sur les 100 places de l’offre de lancement.',
    '',
    `Ton lien de parrainage : ${input.referralUrl}`,
    'Il permet de savoir qui t’a fait connaître Stacker. Il ne donne droit à aucune rémunération.',
    '',
    'Tu reçois cet email parce que cette adresse a été inscrite sur la liste d’attente de Stacker. Si ce n’est pas toi, ignore-le ou réponds-nous pour que l’on supprime l’inscription.',
    rightsText,
    '',
    'L’équipe Stacker',
  ].join('\n');

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inscription confirmée</title></head>
<body style="margin:0;padding:0;background:#ececf0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececf0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:28px;padding:32px 28px;">
<tr><td style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#636368;font-weight:600;">Liste d’attente Stacker</td></tr>
<tr><td style="padding-top:12px;font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.02em;">Bienvenue ${name}, ton inscription est confirmée.</td></tr>
<tr><td style="padding-top:20px;"><table role="presentation" cellpadding="0" cellspacing="0" style="background:#1c1c1e;border-radius:20px;width:100%;"><tr><td style="padding:20px 22px;color:#a1a1aa;font-size:13px;">Ta position<div style="color:#ffffff;font-size:36px;font-weight:800;letter-spacing:-.03em;padding-top:4px;">n°&nbsp;${position}</div></td></tr></table></td></tr>
<tr><td style="padding-top:20px;font-size:15px;line-height:1.55;color:#1c1c1e;">Stacker ouvre le <b>20 octobre 2026</b>. Les inscrits sont prévenus par email, dans l’ordre d’inscription, et ont priorité sur les 100 places de l’offre de lancement.</td></tr>
<tr><td style="padding-top:20px;font-size:15px;line-height:1.55;">Ton lien de parrainage&nbsp;:<br><a href="${referral}" style="color:#4b4bc4;font-weight:600;word-break:break-all;">${referral}</a><br><span style="font-size:13px;color:#636368;">Il permet de savoir qui t’a fait connaître Stacker. Il ne donne droit à aucune rémunération.</span></td></tr>
<tr><td style="padding-top:28px;font-size:12px;line-height:1.5;color:#636368;border-top:1px solid #e5e5ea;margin-top:28px;">Tu reçois cet email parce que cette adresse a été inscrite sur la liste d’attente de Stacker. Si ce n’est pas toi, ignore-le ou réponds-nous pour que l’on supprime l’inscription. ${rightsHtml}</td></tr>
</table></td></tr></table>
</body></html>`;

  return {
    to: { email: input.email, name: input.firstName },
    subject: `Inscription confirmée : tu es n° ${position} sur la liste d’attente Stacker`,
    html,
    text,
    tags: ['waitlist-confirmation'],
  };
}
