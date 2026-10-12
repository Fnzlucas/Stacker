/**
 * Formation des stackers : contenu (modules, scripts d'appel, objections)
 * et progression enregistrée côté serveur (my_formation, formation_set_done).
 *
 * Règles de rédaction : aucune promesse de revenu, aucun chiffre qui ne vient
 * pas de l'app (délais, limites, taux), et la loyauté envers le prospect
 * passe avant la vente.
 */
import { z } from 'zod';
import type { IconName } from '../../components/Icon';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

export interface FormationSection {
  title: string;
  text?: string[];
  bullets?: string[];
  /** Répliques à dire (script) : « Toi » / « Prospect ». */
  script?: { who: 'toi' | 'prospect'; line: string }[];
  /** Objection et réponse. */
  answers?: { objection: string; answer: string }[];
}

export interface FormationModule {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  icon: IconName;
  sections: FormationSection[];
}

export const FORMATION: FormationModule[] = [
  {
    id: 'bases',
    title: 'Comment Stacker fonctionne',
    summary: 'Ton rôle, ce que tu vends, comment tu es payé.',
    minutes: 4,
    icon: 'graduation',
    sections: [
      {
        title: 'Ton rôle',
        text: [
          'Tu es apporteur d’affaires indépendant. Tu trouves des entreprises intéressées par une offre du catalogue, tu leur présentes, et tu les fais signer dans l’app. C’est Stacker (et ses partenaires) qui fournit le service et qui encaisse le client.',
          'Tu n’es ni salarié ni représentant de Stacker : dis-le toujours clairement au prospect. Tu travailles quand tu veux, d’où tu veux.',
        ],
      },
      {
        title: 'Comment tu es payé',
        bullets: [
          'Chaque fois qu’un client que tu as signé paie son mois, tu touches une commission sur ce paiement, au taux de ton niveau ce jour-là (Rookie 15 %, puis 18 %, 22 % et 25 % selon ton nombre de clients actifs).',
          'Une commission devient disponible 14 jours après le paiement du client (30 jours pour le tout premier paiement d’un nouveau client), le temps qu’un prélèvement ne puisse plus être contesté facilement.',
          'Tu demandes ton virement dans Gains dès 10 € disponibles. Les virements sont traités chaque semaine.',
          'Si un client se fait rembourser un prélèvement par sa banque, la commission correspondante est reprise.',
        ],
      },
      {
        title: 'Ce que Stacker ne promet pas',
        text: [
          'Aucun revenu n’est garanti : tes commissions dépendent uniquement des clients que tu signes et qui paient. Ne promets jamais rien de ce genre à quelqu’un que tu voudrais faire entrer sur Stacker.',
        ],
      },
    ],
  },
  {
    id: 'regles',
    title: 'Les règles de la prospection',
    summary: 'Ce qui est permis, ce qui ne l’est pas, et les limites de l’app.',
    minutes: 4,
    icon: 'shield',
    sections: [
      {
        title: 'Les 4 règles (non négociables)',
        bullets: [
          'Tu ne contactes que des entreprises, jamais des particuliers.',
          'Écris d’abord aux adresses génériques (contact@, bonjour@…). Une adresse personnelle seulement si elle est publiée pour le travail.',
          'Les emails partent depuis ta propre boîte, toujours avec le lien pour ne plus être contacté.',
          'Si quelqu’un ne veut plus être contacté, c’est définitif, pour tous les stackers.',
        ],
      },
      {
        title: 'Réserver un prospect',
        bullets: [
          'Une entreprise réservée est à toi seul : aucun autre stacker ne peut la contacter pendant ta réservation.',
          'Une réservation dure 10 jours, plus longtemps quand tu avances (contacté, rendez-vous). Tu peux la prolonger une fois après le premier contact.',
          'Tu suis au maximum 40 entreprises à la fois, avec 15 nouvelles réservations par jour. Libère celles qui ne mènent à rien.',
          'Une entreprise qui dit non est mise en pause 6 mois pour tout le monde. Une même entreprise ne peut être sollicitée que 3 fois par an au total.',
        ],
      },
      {
        title: 'Au téléphone',
        bullets: [
          'Appelle aux horaires d’ouverture, jamais avant 9 h ni après 19 h, jamais le dimanche.',
          'Présente-toi avec ton vrai nom et dis que tu es apporteur d’affaires indépendant pour Stacker.',
          'Un « non » est un non : note-le dans la fiche et passe à la suite.',
        ],
      },
    ],
  },
  {
    id: 'cibler',
    title: 'Choisir les bons prospects',
    summary: 'Qui appeler en premier, et avec quelle offre.',
    minutes: 3,
    icon: 'target',
    sections: [
      {
        title: 'Partir du besoin visible',
        text: [
          'Avant d’appeler, regarde l’entreprise en 30 secondes : a-t-elle un site ? Est-il récent ? Sa fiche Google est-elle complète, avec des avis récents et des réponses ? C’est ce que tu as remarqué qui rend ton appel crédible.',
        ],
        bullets: [
          'Pas de site, ou un site vieillissant : création de site web, ou pack site + référencement.',
          'Fiche Google incomplète ou peu d’avis : Google My Business, QR avis Google, e-réputation.',
          'Commerce de quartier qui veut faire revenir ses clients : carte de fidélité, contenu réseaux sociaux.',
          'Hôtel : la conciergerie hôtelière InRoom.',
        ],
      },
      {
        title: 'Où trouver tes prospects',
        bullets: [
          'Recherche : ton département ou un rayon autour de toi, par type d’activité.',
          'Campagne : l’app prépare et envoie chaque jour des emails depuis ta boîte. Appelle en priorité ceux qui répondent.',
          'Ton réseau : artisans et commerçants que tu connais déjà. C’est souvent là que se signent les premiers clients.',
        ],
      },
    ],
  },
  {
    id: 'appel',
    title: 'Le script d’appel',
    summary: 'Un appel de 3 minutes, en 5 temps.',
    minutes: 5,
    icon: 'phone',
    sections: [
      {
        title: 'Les 5 temps',
        bullets: [
          'Te présenter (10 secondes).',
          'Dire pourquoi tu appelles CETTE entreprise (ce que tu as remarqué).',
          'Poser une question et écouter.',
          'Présenter l’offre en deux phrases, prix compris.',
          'Proposer une suite concrète : signer maintenant, ou un rendez-vous à une date précise.',
        ],
      },
      {
        title: 'Exemple : site web',
        script: [
          { who: 'toi', line: 'Bonjour, je suis Inès Martin, apporteuse d’affaires indépendante pour Stacker. Je cherche à joindre le gérant, c’est bien vous ?' },
          { who: 'prospect', line: 'Oui, c’est pour quoi ?' },
          { who: 'toi', line: 'Je vous appelle parce que j’ai cherché votre menuiserie sur Google et je n’ai pas trouvé de site. Aujourd’hui, vos nouveaux clients vous trouvent comment ?' },
          { who: 'prospect', line: 'Surtout par le bouche-à-oreille.' },
          { who: 'toi', line: 'C’est le meilleur canal. Le site, c’est ce qui rassure les gens à qui on vous a recommandé quand ils vous cherchent avant d’appeler. On propose un site professionnel, hébergement et mises à jour compris, pour un prix mensuel fixe, sans rien à gérer de votre côté.' },
          { who: 'toi', line: 'Je peux vous montrer les formules en deux minutes, ou je repasse vous voir jeudi matin si c’est plus simple ?' },
        ],
      },
      {
        title: 'Exemple : avis Google',
        script: [
          { who: 'toi', line: 'Bonjour, je suis Inès Martin, apporteuse d’affaires indépendante pour Stacker. J’ai vu votre fiche Google : vous avez de très bons avis, mais le dernier date de plusieurs mois.' },
          { who: 'toi', line: 'Les clients regardent surtout les avis récents. On propose un QR code à poser au comptoir : vos clients satisfaits laissent un avis en 20 secondes. Vous en avez combien par semaine, de clients contents ?' },
        ],
      },
      {
        title: 'Les réflexes',
        bullets: [
          'Souris en parlant : ça s’entend.',
          'Parle moins que ton prospect. Ta meilleure arme, c’est la question.',
          'Annonce le prix tôt et calmement : un prix caché crée de la méfiance.',
          'Après chaque appel, note dans la fiche ce qui a été dit et la prochaine action, avec sa date.',
        ],
      },
    ],
  },
  {
    id: 'objections',
    title: 'Répondre aux objections',
    summary: 'Les 6 réponses qu’on entend le plus.',
    minutes: 5,
    icon: 'message',
    sections: [
      {
        title: 'Les objections fréquentes',
        answers: [
          { objection: '« Je n’ai pas le temps. »', answer: 'Je comprends, je serai bref. Quel est le meilleur moment pour vous rappeler deux minutes : demain matin ou en fin de journée ?' },
          { objection: '« J’ai déjà un site / un prestataire. »', answer: 'Très bien. Vous en êtes content ? Il vous ramène des clients ? Si oui, je ne vous fais pas perdre de temps. Sinon, je peux vous montrer ce qu’on fait de différent.' },
          { objection: '« C’est trop cher. »', answer: 'Par rapport à quoi ? Si ça vous ramène un seul client par mois, c’est remboursé. Et il existe une formule plus légère, je vous la montre ?' },
          { objection: '« Envoyez-moi un mail. »', answer: 'Avec plaisir. Pour vous envoyer le bon document : qu’est-ce qui compte le plus pour vous, le prix ou le résultat ? Et je vous rappelle jeudi pour en parler ?' },
          { objection: '« Je dois réfléchir / en parler à mon associé. »', answer: 'C’est normal. Qu’est-ce qui vous fait hésiter ? On peut fixer un moment à trois pour que je réponde à vos questions ensemble.' },
          { objection: '« C’est une arnaque, ce genre d’appel. »', answer: 'Vous avez raison de vous méfier. Je suis apporteur indépendant, le contrat est au nom de Stacker, vous le lisez avant de signer, et vous avez 14 jours pour changer d’avis sans frais.' },
        ],
      },
      {
        title: 'La règle d’or',
        text: [
          'Une objection, c’est une question. Réponds, puis repose une question. Si la réponse est vraiment non, remercie, note-le, et passe à la suite : l’entreprise sera en pause 6 mois pour tout le monde.',
        ],
      },
    ],
  },
  {
    id: 'email',
    title: 'Emails et relances',
    summary: 'La campagne, les réponses, le bon moment pour rappeler.',
    minutes: 3,
    icon: 'mail',
    sections: [
      {
        title: 'Ta campagne',
        bullets: [
          'Connecte ta boîte mail (Gmail ou Outlook) : les emails partent de ton adresse, à ton nom.',
          'Choisis ta zone, le type d’entreprises et le volume quotidien : l’app envoie en semaine, avec un espacement naturel.',
          'Chaque email contient le lien pour ne plus être contacté. Ne le retire jamais.',
        ],
      },
      {
        title: 'Après une réponse',
        bullets: [
          'Réponds dans la journée, depuis ta boîte, puis passe la fiche en « A répondu ».',
          'Appelle dans les 48 heures : un intérêt refroidit vite.',
          'Sans réponse, une relance courte une semaine plus tard suffit. Jamais plus de deux.',
        ],
      },
    ],
  },
  {
    id: 'signature',
    title: 'Faire signer un client',
    summary: 'La signature dans l’app, sans erreur et sans pression.',
    minutes: 4,
    icon: 'signature',
    sections: [
      {
        title: 'Dans l’app',
        bullets: [
          'Depuis la fiche du prospect, touche « Faire signer ce client » : ses infos sont déjà remplies.',
          'Choisis l’offre avec lui, vérifie le SIRET, le nom et la fonction du signataire, son email et son IBAN.',
          'Donne-lui ton téléphone : il lit le contrat, coche l’acceptation et signe lui-même au doigt.',
          'Il reçoit tout de suite son contrat en PDF par email, toi aussi.',
        ],
      },
      {
        title: 'Ce que tu dois dire',
        bullets: [
          'Le prix mensuel, la durée d’engagement s’il y en a une, et que le paiement se fait par prélèvement SEPA.',
          'Qu’il a 14 jours pour se rétracter sans frais, et que rien n’est prélevé avant.',
          'Qu’il sera prévenu par email avant chaque prélèvement.',
        ],
      },
      {
        title: 'Ce qui est interdit',
        bullets: [
          'Signer à la place du client, ou faire signer quelqu’un qui n’a pas le pouvoir d’engager l’entreprise.',
          'Promettre un résultat, une remise ou un service qui n’est pas dans l’offre.',
          'Mettre la pression (« c’est aujourd’hui ou jamais ») : un client signé sous pression se rétracte, ou ne paie pas.',
        ],
      },
    ],
  },
  {
    id: 'apres',
    title: 'Après la signature',
    summary: 'Garder ses clients, et en trouver d’autres grâce à eux.',
    minutes: 3,
    icon: 'trending-up',
    sections: [
      {
        title: 'Le suivi',
        bullets: [
          'Suis tes deals dans « Deals » : signé, actif (le client a payé), suspendu, résilié.',
          'Si un prélèvement est refusé, tu reçois un email et le deal passe en « suspendu » : appelle ton client pour vérifier son compte. Le prochain prélèvement réussi réactive le deal.',
          'Ta commission tombe à chaque paiement du client, tant qu’il reste client : un client satisfait vaut plus qu’une signature rapide.',
        ],
      },
      {
        title: 'Le bouche-à-oreille',
        text: [
          'Un mois après la mise en place, rappelle ton client : tout se passe bien ? C’est le bon moment pour lui demander s’il connaît un confrère ou un voisin commerçant qui aurait le même besoin.',
        ],
      },
    ],
  },
];

export const FORMATION_IDS = FORMATION.map((m) => m.id);

/** Modules terminés, dans l'ordre de la formation (identifiants inconnus ignorés). */
export function formationProgress(done: readonly string[]): { done: number; total: number; percent: number; next: FormationModule | null } {
  const set = new Set(done);
  const count = FORMATION.filter((m) => set.has(m.id)).length;
  return { done: count, total: FORMATION.length, percent: Math.round((count / FORMATION.length) * 100), next: FORMATION.find((m) => !set.has(m.id)) ?? null };
}

async function rpc(b: Backend, fn: string, args: Record<string, unknown>): Promise<string[]> {
  const res = await b.db.rpc(fn, args);
  if (res.error) {
    if (res.status === 0 || /fetch|network/i.test(res.error.message)) throw new ApiError('network');
    if (res.status === 401 || res.error.code === 'PGRST301' || res.error.code === 'PGRST303') throw new ApiError('unauthorized');
    throw new ApiError('server', res.error.message);
  }
  const parsed = z.array(z.string()).safeParse(res.data as unknown);
  if (!parsed.success) throw new ApiError('server', `${fn} illisible`);
  return parsed.data;
}

export const fetchFormation = (b: Backend) => rpc(b, 'my_formation', {});
export const setModuleDone = (b: Backend, id: string, done: boolean) => rpc(b, 'formation_set_done', { p_module: id, p_done: done });
