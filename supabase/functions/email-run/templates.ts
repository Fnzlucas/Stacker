/**
 * Emails transactionnels de Stacker (texte + HTML). Le client (une
 * entreprise) est vouvoyé, le stacker tutoyé. Aucun chiffre inventé : tout
 * vient de la base (contrat, montants, dates).
 */
import { z } from 'zod';

const date = z.string();
export const itemSchema = z.object({
  id: z.number().int(),
  kind: z.enum(['contrat_client', 'contrat_stacker', 'prenotification', 'bienvenue', 'abonnement_refuse', 'abonnement_coupe', 'prelevement_refuse', 'virement_verse', 'virement_refuse']),
  to: z.string().nullable(),
  to_name: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  stacker: z.object({ first_name: z.string().nullable(), last_name: z.string().nullable() }).nullable(),
  deal: z
    .object({
      reference: z.string(),
      status: z.string(),
      company_name: z.string(),
      company_siret: z.string(),
      contact_name: z.string(),
      offer_label: z.string(),
      monthly_price_cents: z.number().int(),
      mandate_ref: z.string(),
      iban_masked: z.string(),
      signed_at: date,
      withdrawal_until: date,
      first_debit_on: date,
      contract_text: z.string().nullable(),
      contract_sha256: z.string().nullable(),
      signature_png: z.string().nullable(),
    })
    .nullable(),
});
export type EmailItem = z.infer<typeof itemSchema>;

export interface RenderContext {
  siteUrl: string;
  contactEmail: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** Joindre le contrat signé en PDF. */
  contract: boolean;
}

export class RenderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RenderError';
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export const euros = (cents: number): string =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100).replace(/[\u202f\u00a0]/g, ' ');

/** Date longue en français ; une date seule (AAAA-MM-JJ) est lue telle quelle, un instant à l'heure de Paris. */
export function longDate(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : 'Europe/Paris' }).format(d);
}

/** Bloc de mise en page : un titre, des paragraphes, un récapitulatif, un bouton. */
interface Block {
  eyebrow: string;
  title: string;
  paragraphs: string[];
  facts?: [string, string][];
  button?: { label: string; url: string };
  footer: string;
}

function layout(b: Block): { html: string; text: string } {
  const facts = b.facts?.length
    ? `<tr><td style="padding-top:20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1c1c1e;border-radius:20px;">${b.facts
        .map(([k, v]) => `<tr><td style="padding:10px 22px 0;color:#a1a1aa;font-size:12px;">${esc(k)}</td></tr><tr><td style="padding:2px 22px 10px;color:#ffffff;font-size:15px;font-weight:700;">${esc(v)}</td></tr>`)
        .join('')}</table></td></tr>`
    : '';
  const button = b.button
    ? `<tr><td style="padding-top:24px;"><a href="${esc(b.button.url)}" style="display:inline-block;background:#3ccf63;color:#0b2a14;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;">${esc(b.button.label)}</a></td></tr>`
    : '';
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.title)}</title></head>
<body style="margin:0;padding:0;background:#ececf0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececf0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:28px;padding:32px 28px;">
<tr><td style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#636368;font-weight:600;">${esc(b.eyebrow)}</td></tr>
<tr><td style="padding-top:12px;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.02em;">${esc(b.title)}</td></tr>
${b.paragraphs.map((p) => `<tr><td style="padding-top:16px;font-size:15px;line-height:1.55;">${esc(p)}</td></tr>`).join('\n')}
${facts}
${button}
<tr><td style="padding-top:28px;font-size:12px;line-height:1.5;color:#636368;">${esc(b.footer)}</td></tr>
</table></td></tr></table>
</body></html>`;
  const text = [
    b.title,
    '',
    ...b.paragraphs.flatMap((p) => [p, '']),
    ...(b.facts?.map(([k, v]) => `${k} : ${v}`) ?? []),
    ...(b.facts?.length ? [''] : []),
    ...(b.button ? [`${b.button.label} : ${b.button.url}`, ''] : []),
    b.footer,
  ].join('\n');
  return { html, text };
}

const fullName = (s: EmailItem['stacker']): string => [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim();

export function render(item: EmailItem, ctx: RenderContext): RenderedEmail {
  const app = `${ctx.siteUrl}/app`;
  const stackerFooter = `Tu reçois cet email parce que tu as un compte Stacker. Une question ? Écris à ${ctx.contactEmail}.`;
  const hi = item.stacker?.first_name ? `Bonjour ${item.stacker.first_name},` : 'Bonjour,';
  const d = item.deal;
  const needDeal = () => {
    if (!d) throw new RenderError('missing_deal');
    return d;
  };

  switch (item.kind) {
    case 'contrat_client': {
      const deal = needDeal();
      const advisor = fullName(item.stacker);
      const { html, text } = layout({
        eyebrow: 'Contrat signé',
        title: `Votre contrat ${deal.reference} est signé`,
        paragraphs: [
          item.to_name ? `Bonjour ${item.to_name},` : 'Bonjour,',
          `Merci pour votre confiance. Vous trouverez en pièce jointe l’exemplaire de votre contrat${advisor ? `, signé avec ${advisor}, apporteur d’affaires Stacker` : ''}.`,
          `Vous pouvez vous rétracter sans motif ni frais jusqu’au ${longDate(deal.withdrawal_until)}, par email à ${ctx.contactEmail}. Aucun prélèvement n’a lieu avant la fin de ce délai.`,
          'Vous serez prévenu par email au moins 2 jours avant chaque prélèvement, avec son montant et sa date.',
        ],
        facts: [
          ['Entreprise', deal.company_name],
          ['Offre', deal.offer_label],
          ['Prix', `${euros(deal.monthly_price_cents)} par mois`],
          ['Premier prélèvement prévu', `à partir du ${longDate(deal.first_debit_on)}`],
          ['Compte prélevé', deal.iban_masked],
          ['Référence du mandat (RUM)', deal.mandate_ref],
        ],
        footer: `Vous recevez cet email car ${deal.company_name} a signé un contrat avec Stacker. Pour toute question sur votre contrat ou vos données, écrivez à ${ctx.contactEmail}.`,
      });
      return { subject: `Votre contrat Stacker ${deal.reference} (${deal.offer_label})`, html, text, contract: true };
    }
    case 'contrat_stacker': {
      const deal = needDeal();
      const { html, text } = layout({
        eyebrow: 'Deal signé',
        title: `${deal.company_name} a signé`,
        paragraphs: [
          hi,
          'Bravo ! Le contrat signé est en pièce jointe, et le client a reçu son exemplaire.',
          `Le client peut se rétracter jusqu’au ${longDate(deal.withdrawal_until)}. Ta commission est créée à chaque paiement du client, au taux de ton niveau ce jour-là, puis disponible après le délai de validation.`,
        ],
        facts: [
          ['Référence', deal.reference],
          ['Offre', deal.offer_label],
          ['Prix pour le client', `${euros(deal.monthly_price_cents)} par mois`],
        ],
        button: { label: 'Voir mes deals', url: `${app}/deals` },
        footer: stackerFooter,
      });
      return { subject: `Deal signé : ${deal.company_name} (${deal.reference})`, html, text, contract: true };
    }
    case 'prenotification': {
      const deal = needDeal();
      const amount = z.number().int().positive().safeParse(item.data['amount_cents']);
      const on = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(item.data['debit_on']);
      if (!amount.success || !on.success) throw new RenderError('invalid_data');
      const { html, text } = layout({
        eyebrow: 'Avis de prélèvement SEPA',
        title: `Prélèvement de ${euros(amount.data)} le ${longDate(on.data)}`,
        paragraphs: [
          item.to_name ? `Bonjour ${item.to_name},` : 'Bonjour,',
          `Conformément à votre contrat ${deal.reference}, le montant ci-dessous sera prélevé sur votre compte à cette date (ou le jour ouvré suivant).`,
          `Le libellé sur votre relevé mentionnera Stacker, via son prestataire de paiement Mollie. Pour toute question, écrivez à ${ctx.contactEmail}.`,
        ],
        facts: [
          ['Montant', euros(amount.data)],
          ['Date', longDate(on.data)],
          ['Entreprise', deal.company_name],
          ['Offre', deal.offer_label],
          ['Compte prélevé', deal.iban_masked],
          ['Référence du mandat (RUM)', deal.mandate_ref],
        ],
        footer: `Vous recevez cet avis car ${deal.company_name} a signé un mandat de prélèvement SEPA au profit de Stacker. Il vous est envoyé avant chaque prélèvement.`,
      });
      return { subject: `Avis de prélèvement : ${euros(amount.data)} le ${longDate(on.data)}`, html, text, contract: false };
    }
    case 'bienvenue': {
      const { html, text } = layout({
        eyebrow: 'Bienvenue',
        title: item.stacker?.first_name ? `Bienvenue sur Stacker, ${item.stacker.first_name} !` : 'Bienvenue sur Stacker !',
        paragraphs: [
          'Ton compte est prêt. Voilà comment démarrer :',
          '1. Active ton abonnement depuis ton profil.',
          '2. Réserve tes premiers prospects dans ton département, ou lance ta campagne d’emails.',
          '3. Quand un client est intéressé, fais-le signer directement sur ton téléphone. Ta commission tombe chaque mois tant qu’il reste client.',
        ],
        button: { label: 'Ouvrir Stacker', url: app },
        footer: stackerFooter,
      });
      return { subject: 'Bienvenue sur Stacker', html, text, contract: false };
    }
    case 'abonnement_refuse': {
      const amount = z.number().int().positive().safeParse(item.data['amount_cents']);
      const until = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(item.data['grace_until']);
      const { html, text } = layout({
        eyebrow: 'Abonnement',
        title: 'Le paiement de ton abonnement a été refusé',
        paragraphs: [
          hi,
          `Le paiement de ${amount.success ? euros(amount.data) : 'ton abonnement'} n’est pas passé.${until.success ? ` Tu gardes l’accès jusqu’au ${longDate(until.data)}.` : ''} Mets à jour ton moyen de paiement pour continuer à prospecter et faire signer.`,
          'Tes commissions restent à toi quoi qu’il arrive.',
        ],
        button: { label: 'Mettre à jour mon paiement', url: `${app}/abonnement` },
        footer: stackerFooter,
      });
      return { subject: 'Ton paiement Stacker a été refusé', html, text, contract: false };
    }
    case 'abonnement_coupe': {
      const { html, text } = layout({
        eyebrow: 'Abonnement',
        title: 'Ton abonnement Stacker est terminé',
        paragraphs: [
          hi,
          'Faute de paiement, ton abonnement est terminé. Tu ne peux plus réserver de prospects ni faire signer de clients, et ta campagne est en pause.',
          'Tes gains restent consultables et virables. Tu peux te réabonner à tout moment.',
        ],
        button: { label: 'Me réabonner', url: `${app}/abonnement` },
        footer: stackerFooter,
      });
      return { subject: 'Ton abonnement Stacker est terminé', html, text, contract: false };
    }
    case 'virement_verse':
    case 'virement_refuse': {
      const amount = z.number().int().positive().safeParse(item.data['amount_cents']);
      const last4 = z.string().safeParse(item.data['iban_last4']);
      const reason = z.string().safeParse(item.data['reason']);
      if (!amount.success) throw new RenderError('invalid_data');
      const done = item.kind === 'virement_verse';
      const { html, text } = layout({
        eyebrow: 'Virement',
        title: done ? `Ton virement de ${euros(amount.data)} est parti` : `Ton virement de ${euros(amount.data)} n’a pas pu être fait`,
        paragraphs: done
          ? [hi, `On vient de virer ${euros(amount.data)} sur ton compte${last4.success ? ` ••${last4.data}` : ''}. Selon ta banque, il arrive sous 1 à 3 jours ouvrés.`]
          : [
              hi,
              `Ton virement n’a pas pu être fait${reason.success && reason.data ? ` : ${reason.data}` : ''}. Ton solde est de nouveau disponible dans Gains.`,
              'Vérifie ton IBAN puis redemande le virement.',
            ],
        button: { label: 'Voir mes gains', url: `${app}/gains` },
        footer: stackerFooter,
      });
      return { subject: done ? `Virement envoyé : ${euros(amount.data)}` : 'Ton virement Stacker n’a pas pu être fait', html, text, contract: false };
    }
    case 'prelevement_refuse': {
      const deal = needDeal();
      const { html, text } = layout({
        eyebrow: 'Deal suspendu',
        title: `Prélèvement refusé : ${deal.company_name}`,
        paragraphs: [
          hi,
          `Le prélèvement de ${deal.company_name} n’est pas passé et le deal est suspendu. Appelle ton client pour vérifier son compte : le prochain prélèvement réussi réactive le deal et ta commission.`,
        ],
        facts: [
          ['Référence', deal.reference],
          ['Montant mensuel', euros(deal.monthly_price_cents)],
        ],
        button: { label: 'Voir le deal', url: `${app}/deals` },
        footer: stackerFooter,
      });
      return { subject: `Prélèvement refusé : ${deal.company_name}`, html, text, contract: false };
    }
  }
}
