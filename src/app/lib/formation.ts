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
    summary: 'Ton rôle, ce que tu vends, qui fait quoi, comment tu es payé.',
    minutes: 8,
    icon: 'graduation',
    sections: [
      {
        title: 'Ton rôle, en une phrase',
        text: [
          'Tu es apporteur d’affaires indépendant : tu trouves des entreprises qui ont un besoin, tu leur présentes l’offre du catalogue qui y répond, et tu les fais signer dans l’app. C’est Stacker qui fournit le service, qui encaisse le client et qui s’occupe de lui ensuite.',
          'Ton métier, ce n’est donc pas de fabriquer un site ou de gérer une fiche Google. C’est de repérer le bon commerçant, de comprendre son problème, de lui montrer la solution et de l’aider à décider. Le reste, Stacker s’en charge.',
        ],
      },
      {
        title: 'Qui fait quoi',
        bullets: [
          'Toi : tu cherches les prospects, tu les contactes (email, téléphone, visite), tu présentes l’offre, tu fais signer, puis tu gardes le contact avec ton client.',
          'L’app : elle te donne les entreprises à contacter, envoie tes emails depuis ta boîte, t’affiche les scripts pendant tes appels, génère le contrat et recueille la signature.',
          'Stacker : il livre le service au client, gère les prélèvements, répond au support client et te verse tes commissions.',
          'Le client : il signe un contrat au nom de Stacker, paie chaque mois par prélèvement SEPA et dispose de 14 jours pour se rétracter sans frais.',
        ],
      },
      {
        title: 'Ton statut',
        text: [
          'Tu n’es ni salarié ni représentant de Stacker. Tu travailles quand tu veux, d’où tu veux, sans objectif imposé. Dis-le toujours clairement au prospect : « Je suis apporteur d’affaires indépendant pour Stacker. » C’est honnête, et c’est ce qui rend ta démarche crédible.',
          'Dès que tes commissions dépassent le seuil indiqué dans l’app, tu dois avoir un statut d’indépendant (la micro-entreprise suffit, elle se crée gratuitement en ligne en quelques minutes). L’app te prévient avant.',
        ],
      },
      {
        title: 'Comment tu es payé',
        bullets: [
          'Chaque fois qu’un client que tu as signé paie son mois, tu touches une commission sur ce paiement, au taux de ton niveau ce jour-là.',
          'Les niveaux dépendent de ton nombre de clients actifs : Rookie 15 % (0 à 2 clients), Pro 18 % (3 à 9), Legend 22 % (10 à 24), Elite 25 % (25 et plus). Ces seuils peuvent évoluer : l’app affiche toujours ceux qui s’appliquent.',
          'Une commission devient disponible 14 jours après le paiement du client (30 jours pour le tout premier paiement d’un nouveau client), le temps qu’un prélèvement ne puisse plus être contesté facilement.',
          'Tu demandes ton virement dans Gains dès 10 € disponibles. Les virements sont traités chaque semaine.',
          'Si un client se fait rembourser un prélèvement par sa banque, la commission correspondante est reprise.',
        ],
      },
      {
        title: 'Pourquoi le récurrent change tout',
        text: [
          'Un client signé ne te paie pas une fois : tu touches ta commission chaque mois tant qu’il reste client. C’est pour ça qu’un client bien conseillé, qui reste longtemps, vaut beaucoup plus qu’une signature arrachée qui se rétracte au bout de 10 jours.',
          'Retiens cette règle pour toute la formation : vends à quelqu’un qui a vraiment besoin de l’offre. C’est plus honnête, et c’est aussi ce qui fait durer tes commissions.',
        ],
      },
      {
        title: 'Ce que Stacker ne promet pas',
        text: [
          'Aucun revenu n’est garanti : tes commissions dépendent uniquement des clients que tu signes et qui paient. Ne promets jamais rien de ce genre à quelqu’un que tu voudrais faire entrer sur Stacker, ni à un prospect sur les résultats de l’offre.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Explique à voix haute, en moins de 30 secondes, ce que tu fais, comme si un ami te le demandait. Si tu bloques, relis « Ton rôle, en une phrase ».',
          'Ouvre l’onglet Gains et repère où s’afficheront tes commissions estimées, disponibles et versées.',
        ],
      },
    ],
  },
  {
    id: 'mental',
    title: 'Le métier et le mental',
    summary: 'À quoi t’attendre au début, la bonne routine, et comment tenir.',
    minutes: 10,
    icon: 'trending-up',
    sections: [
      {
        title: 'La vérité sur les débuts',
        text: [
          'La prospection, c’est un métier de volume et de régularité. Au début, la grande majorité des gens que tu contactes ne répondront pas, ou diront non. C’est normal, ça arrive à tous les commerciaux, même aux meilleurs.',
          'Un « non » ne veut pas dire que tu es mauvais. Ça veut souvent dire : pas le bon moment, pas le bon besoin, ou pas la bonne personne. Ton travail n’est pas de convaincre tout le monde, c’est de trouver ceux pour qui l’offre tombe juste.',
        ],
      },
      {
        title: 'Tes 20 premiers appels',
        bullets: [
          'Fixe-toi un objectif d’effort, pas de résultat : « 20 appels cette semaine », pas « 2 signatures ». L’effort, tu le contrôles. Le résultat, non.',
          'Commence par des entreprises où le besoin se voit (pas de site, fiche Google vide, avis anciens) : tes premiers appels seront plus faciles.',
          'Après chaque appel, note une chose qui a marché et une chose à améliorer. Au bout de 20 appels, relis tes notes : tu verras déjà ta progression.',
          'Appelle d’abord des gens de ton réseau (le garage de ton oncle, la coiffeuse du quartier) pour t’entraîner dans un cadre bienveillant.',
        ],
      },
      {
        title: 'La routine qui fonctionne',
        bullets: [
          'Un créneau fixe, protégé, plusieurs fois par semaine. Même 1 heure, mais toujours à la même heure : la régularité bat la motivation.',
          'Avant le créneau (10 min) : vérifie les réponses à tes emails, prépare 10 à 15 fiches à appeler, relis le script de l’offre du jour.',
          'Pendant le créneau : enchaîne les appels sans t’arrêter pour réfléchir. Note vite, passe au suivant.',
          'Après (10 min) : mets à jour tes fiches, programme tes rappels avec une date, libère les entreprises qui ne mènent à rien.',
          'Les meilleurs moments pour joindre un commerçant : souvent en milieu de matinée ou en milieu d’après-midi, hors rush. Évite l’heure du déjeuner dans la restauration et les samedis dans le commerce.',
        ],
      },
      {
        title: 'Gérer les refus',
        text: [
          'Ne prends jamais un refus personnellement. Le commerçant ne te rejette pas toi, il rejette une proposition à un moment donné. Remercie, note, passe au suivant : ton énergie doit aller au prochain appel, pas au précédent.',
          'Si tu enchaînes plusieurs mauvais appels, fais une pause de 5 minutes, relis une réussite passée, puis repars. Si une journée est vraiment mauvaise, arrête-toi et analyse : souvent, c’est le ciblage ou l’accroche qu’il faut changer, pas toi.',
        ],
      },
      {
        title: 'Ce qui fait la différence sur la durée',
        bullets: [
          'Tu progresses à chaque appel : ta voix se pose, tu reconnais les objections, tu trouves tes formulations.',
          'Tes clients satisfaits t’en apportent d’autres (module « Après la signature »).',
          'Tes commissions s’additionnent mois après mois tant que tes clients restent : ce sont tes premiers mois qui demandent le plus d’effort.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Bloque dans ton agenda trois créneaux de prospection pour la semaine prochaine.',
          'Liste 10 commerçants ou artisans que tu connais personnellement : ce seront tes premiers appels d’entraînement.',
        ],
      },
    ],
  },
  {
    id: 'offres',
    title: 'Connaître ce que tu vends',
    summary: 'Chaque offre du catalogue : ce que c’est, pour qui, comment la présenter.',
    minutes: 18,
    icon: 'target',
    sections: [
      {
        title: 'Pourquoi c’est essentiel',
        text: [
          'Un commerçant ne signe pas avec quelqu’un qui récite une fiche produit. Il signe avec quelqu’un qui a compris son problème et qui sait expliquer simplement ce que l’offre change pour lui. Pour chaque offre, retiens trois choses : le problème qu’elle règle, à qui elle s’adresse, et la phrase qui la résume.',
          'Les prix ci-dessous sont ceux du catalogue au moment où tu lis : l’écran « Faire signer » affiche toujours les prix et engagements à jour. En cas de doute, c’est l’app qui fait foi.',
        ],
      },
      {
        title: 'Google My Business : la fiche Google',
        text: [
          'Le problème : quand on cherche « boulangerie près de moi », c’est la fiche Google qui s’affiche en premier, avant le site. Une fiche incomplète (pas de photos, horaires faux, aucune réponse aux avis) fait fuir les clients vers le concurrent.',
          'Ce que fait l’offre : optimisation complète de la fiche, puis gestion chaque mois (horaires, posts, réponses aux avis, photos selon la formule).',
          'Pour qui : tous les commerces et artisans qui reçoivent des clients ou interviennent localement.',
          'Formules : Starter 39 €/mois, Pro 69 €/mois (1 post par semaine et réponses aux avis), Premium 119 €/mois (photos pro mensuelles, multi-établissements, engagement 12 mois).',
          'La phrase : « Votre fiche Google, c’est votre vitrine sur Internet. On la rend complète et vivante, chaque mois, sans que vous ayez à y toucher. »',
        ],
      },
      {
        title: 'QR Avis Google et E-Réputation : les avis',
        text: [
          'Le problème : les clients choisissent en regardant la note et surtout les avis récents. Beaucoup de commerces ont des clients contents qui ne laissent jamais d’avis, simplement parce que c’est compliqué.',
          'QR Avis Google : un QR code physique livré en 48 h, posé en caisse ou en vitrine. Le client scanne et arrive directement sur la page pour laisser un avis. Solo 9 €/mois, Pro 19 €/mois (3 QR codes, rapport mensuel, relance SMS), Max 39 €/mois (10 QR codes, multi-établissements, réponses rédigées par IA).',
          'E-Réputation Google : un système plus complet pour collecter les avis, être alerté des nouveaux, et répondre aux avis négatifs. Starter 29 €/mois, Pro 49 €/mois (réponses automatiques IA, rapport mensuel), Premium 89 €/mois (veille des concurrents, engagement 12 mois).',
          'Pour qui : restaurants, coiffeurs, garages, instituts, tous les commerces avec du passage. QR Avis est une porte d’entrée idéale : petit prix, sans engagement, résultat visible vite.',
          'La phrase : « Vos clients contents ne laissent pas d’avis parce que c’est compliqué. Avec un QR code en caisse, ça leur prend 20 secondes. »',
        ],
      },
      {
        title: 'Sites web : Alma Company et les packs Site + SEO',
        text: [
          'Le problème : pas de site, ou un site vieux, lent, illisible sur téléphone. Les gens à qui on recommande un artisan vérifient presque toujours en ligne avant d’appeler.',
          'Alma Company : création de site professionnel, hébergement et maintenance inclus, livraison en 7 jours. Starter 39,99 €/mois (5 pages), Pro 69,99 €/mois (15 pages, blog, 3 modifications par mois), Premium 119,99 €/mois (pages illimitées, e-commerce). Engagement 12 mois.',
          'Packs Site + SEO : le site plus un suivi pour être trouvé sur Google. Pack Starter 54,99 €/mois, Pack Visibilité 74,99 €/mois (avec fiche Google et e-réputation), Pack Digital Complet 99,99 €/mois (avec réseaux sociaux). Engagement 12 mois.',
          'Pour qui : artisans du bâtiment, professions de service, commerces sans site ou avec un site dépassé.',
          'La phrase : « Un site professionnel, hébergé et entretenu, pour un prix mensuel fixe. Vous n’avez rien à gérer. »',
        ],
      },
      {
        title: 'Seoia Partners : être trouvé sur Google et par les IA',
        text: [
          'Le problème : un site qui n’apparaît pas dans les recherches ne sert à rien. Et de plus en plus de clients posent leurs questions à ChatGPT ou Perplexity au lieu de Google.',
          'Ce que fait l’offre : du référencement classique (audit, optimisation du site) et une optimisation pour être cité par les moteurs IA. Starter 34,99 €/mois (6 mois), Pro 64,99 €/mois (contenu chaque semaine, fiche Google, 9 mois), Premium 99,99 €/mois (stratégie sur mesure, session mensuelle, 12 mois).',
          'Pour qui : entreprises qui ont déjà un site mais peu de visites, secteurs concurrentiels (avocats, cliniques, artisans dans une grande ville).',
          'La phrase : « Aujourd’hui vos clients vous cherchent sur Google, et de plus en plus en demandant à une IA. On fait en sorte que ce soit vous qui sortiez. »',
        ],
      },
      {
        title: 'Packs Visibilité locale : tout-en-un',
        text: [
          'Le problème : le commerçant n’a ni le temps ni l’envie de gérer cinq prestataires différents.',
          'Ce que fait l’offre : site, référencement local, fiche Google, posts sur les réseaux et carte de fidélité, avec une seule équipe et une seule facture. Pack Local Pro 119,99 €/mois, Pack Local Elite 159,99 €/mois (5 posts par semaine, vidéo UGC mensuelle). Engagement 12 mois.',
          'Pour qui : commerces de centre-ville qui veulent attirer et faire revenir leurs clients, et qui ont un vrai budget.',
          'La phrase : « Tout ce qu’il faut pour être visible dans votre quartier, géré par une seule équipe. »',
        ],
      },
      {
        title: 'Contenu Réseaux Sociaux',
        text: [
          'Le problème : un compte Instagram ou Facebook abandonné depuis des mois donne l’impression que le commerce est fermé ou peu soigné.',
          'Ce que fait l’offre : création et publication de posts chaque mois à partir des photos du commerçant. Starter 49 €/mois (8 posts), Pro 99 €/mois (12 posts, stories, deux plateformes), Premium 199 €/mois (reels, community management, engagement 12 mois).',
          'Pour qui : restaurants, boutiques, instituts, salles de sport : les activités qui se montrent.',
          'La phrase : « Vous envoyez quelques photos une fois, et votre page vit toute seule chaque semaine. »',
        ],
      },
      {
        title: 'Huntlist : la prospection pour les entreprises B2B',
        text: [
          'Le problème : les entreprises qui vendent à d’autres entreprises passent des heures à chercher des contacts.',
          'Ce que fait l’offre : un outil qui trouve et qualifie des prospects automatiquement. Starter 99 €/mois, Pro 199 €/mois, Premium 349 €/mois.',
          'Pour qui : agences, cabinets, sociétés de services, PME qui ont une équipe commerciale. Ce n’est pas une offre pour une boulangerie.',
          'La phrase : « Vos commerciaux passent leur temps à chercher qui appeler. Huntlist le fait pour eux. »',
        ],
      },
      {
        title: 'InRoom : la conciergerie pour les hôtels',
        text: [
          'Le problème : un petit ou moyen hôtel n’a pas de concierge, mais ses clients veulent des services (massage, pressing, baby-sitter…).',
          'Ce que fait l’offre : un QR code dans chaque chambre, le client commande depuis son téléphone et InRoom coordonne les prestataires. 5 € par chambre et par mois, selon la taille de l’hôtel.',
          'Pour qui : hôtels indépendants, résidences de tourisme.',
          'La phrase : « Offrez à vos clients un service de conciergerie en chambre, sans embaucher de concierge. »',
        ],
      },
      {
        title: 'Choisir la bonne offre',
        bullets: [
          'Pars toujours de ce que tu as remarqué : pas de site → site ; fiche Google vide → Google My Business ; peu d’avis récents → QR Avis ; page Instagram morte → réseaux sociaux.',
          'Au premier contact, propose la formule recommandée (celle mise en avant dans l’app) ou plus légère. Monter en gamme se fait plus tard, une fois que le client est satisfait.',
          'Une offre à la fois. Présenter cinq services dans le même appel noie le commerçant.',
          'Si aucune offre ne répond vraiment au besoin, dis-le : tu gagneras sa confiance pour plus tard.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Pour chaque famille d’offres, redis la phrase à voix haute sans lire.',
          'Choisis 5 entreprises dans Prospection et, pour chacune, note l’offre que tu proposerais et pourquoi.',
        ],
      },
    ],
  },
  {
    id: 'regles',
    title: 'Les règles de la prospection',
    summary: 'Ce que dit la loi, ce que permet l’app, et pourquoi ces règles te protègent.',
    minutes: 8,
    icon: 'shield',
    sections: [
      {
        title: 'Pourquoi des règles',
        text: [
          'La prospection est encadrée par la loi, et les commerçants reçoivent beaucoup de sollicitations agressives. Respecter les règles, c’est te protéger juridiquement, protéger Stacker, et surtout te démarquer : un commerçant écoute plus volontiers quelqu’un de correct.',
        ],
      },
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
        title: 'Ce que dit la loi, simplement',
        bullets: [
          'Écrire par email à une entreprise pour lui proposer un service lié à son activité est autorisé, à condition de dire qui tu es et de lui permettre de refuser la suite. C’est exactement ce que fait l’app.',
          'Contacter des particuliers sans leur accord est interdit : c’est pour ça que Stacker ne propose que des entreprises.',
          'Les données des prospects (nom, email, téléphone) servent uniquement à les contacter pour Stacker. Tu ne les copies pas ailleurs et tu ne les partages pas.',
          'Tu ne te fais jamais passer pour quelqu’un d’autre (Google, la mairie, un fournisseur existant du commerçant).',
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
      {
        title: 'Ce qui fait suspendre un compte',
        bullets: [
          'Signer à la place d’un client, ou avec de fausses informations.',
          'Promettre un résultat chiffré (« vous aurez 50 clients de plus ») ou une remise qui n’existe pas.',
          'Harceler un prospect qui a dit non, ou contourner une opposition.',
          'Se présenter comme salarié de Stacker ou d’une autre entreprise.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Réserve 3 entreprises dans Prospection et regarde leur date de fin de réservation dans la fiche.',
          'Prépare ta phrase de présentation complète, avec ton nom et ton statut, et dis-la à voix haute.',
        ],
      },
    ],
  },
  {
    id: 'cibler',
    title: 'Choisir et qualifier tes prospects',
    summary: 'L’audit en 60 secondes, les bons secteurs, et qui appeler en premier.',
    minutes: 10,
    icon: 'target',
    sections: [
      {
        title: 'Le principe',
        text: [
          'Un appel réussi se prépare avant de composer le numéro. Ce que tu as remarqué sur l’entreprise, c’est ce qui fait la différence entre « encore un démarcheur » et « tiens, il s’est intéressé à moi ».',
        ],
      },
      {
        title: 'L’audit en 60 secondes',
        bullets: [
          'Tape le nom de l’entreprise et sa ville sur Google. Est-ce qu’elle apparaît ? Sa fiche Google est-elle complète (photos, horaires, description) ?',
          'Regarde les avis : combien, quelle note, de quand date le dernier ? Le commerçant répond-il ?',
          'Clique sur le site s’il existe : s’ouvre-t-il bien sur téléphone ? A-t-il l’air récent ? Les infos sont-elles à jour ?',
          'Jette un œil aux réseaux sociaux : dernier post il y a 3 jours ou il y a 2 ans ?',
          'Note dans la fiche UNE observation précise. C’est ton accroche.',
        ],
      },
      {
        title: 'Les signaux d’un bon prospect',
        bullets: [
          'Un besoin visible et précis (pas de site, fiche incomplète, avis anciens).',
          'Une activité qui vit des clients locaux : restaurants, artisans, coiffeurs, instituts, garages, commerces de bouche, professions de santé et de service.',
          'Des signes que l’entreprise tourne : des avis récents, plusieurs salariés, un local en centre-ville. Une entreprise qui va bien a les moyens de payer un abonnement.',
          'Une ouverture récente : un nouveau commerce a tout à construire en ligne.',
        ],
      },
      {
        title: 'Les signaux d’alerte',
        bullets: [
          'Une entreprise qui semble fermée ou en difficulté : n’insiste pas.',
          'Une chaîne ou une franchise : la décision se prend souvent au siège, pas en boutique.',
          'Une entreprise qui a déjà tout (site récent, fiche parfaite, réseaux actifs) : sauf vraie faille, passe ton tour.',
        ],
      },
      {
        title: 'Organiser ta liste',
        bullets: [
          'Priorité 1 : ceux qui ont répondu à tes emails. Appelle-les dans les 48 heures.',
          'Priorité 2 : les entreprises avec un besoin très visible.',
          'Priorité 3 : le reste de ta liste, par secteur. Enchaîner les mêmes métiers te fait gagner en aisance : tu connais vite leurs problèmes.',
          'Recherche : n’importe quel département de France, un code postal ou un rayon autour de toi, par type d’activité. Tu n’es pas limité à ta ville.',
          'Ton réseau : artisans et commerçants que tu connais déjà. C’est souvent là que se signent les premiers clients.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Fais l’audit en 60 secondes sur 5 entreprises de ta liste et note ton accroche dans chaque fiche.',
          'Classe-les en priorité 1, 2 ou 3.',
        ],
      },
    ],
  },
  {
    id: 'email',
    title: 'Emails et relances',
    summary: 'La campagne, des modèles d’emails, et que faire quand on te répond.',
    minutes: 10,
    icon: 'mail',
    sections: [
      {
        title: 'Ta campagne',
        bullets: [
          'Connecte ta boîte mail (Gmail ou Outlook) : les emails partent de ton adresse, à ton nom.',
          'Choisis ta zone, le type d’entreprises et le volume quotidien : l’app envoie en semaine, avec un espacement naturel, et augmente le volume progressivement pour protéger ta boîte.',
          'Chaque email contient le lien pour ne plus être contacté. Ne le retire jamais.',
        ],
      },
      {
        title: 'Ce qui fait un bon email de prospection',
        bullets: [
          'Court : 4 à 6 lignes. Un commerçant lit sur son téléphone, entre deux clients.',
          'Personnel : le nom de l’entreprise et une observation précise. Pas de « Madame, Monsieur » générique.',
          'Une seule offre, une seule question à la fin.',
          'Un objet simple, sans majuscules ni promesse : « Votre fiche Google » marche mieux que « BOOSTEZ VOS VENTES !!! ».',
          'Jamais de pièce jointe au premier email : ça finit en spam.',
        ],
      },
      {
        title: 'Exemple d’email : fiche Google',
        text: [
          'Objet : Votre fiche Google',
          'Bonjour,',
          'En cherchant une boulangerie à Villeneuve, je suis tombé sur votre fiche Google : vous avez d’excellents avis, mais pas de photos et des horaires du dimanche qui semblent ne plus être à jour.',
          'Je suis apporteur d’affaires indépendant pour Stacker. On s’occupe de ce type de fiche chaque mois pour les commerces de quartier, pour un prix fixe.',
          'Est-ce que ça vous intéresserait que je vous appelle 5 minutes cette semaine pour vous montrer ce que ça donnerait ?',
          'Inès Martin',
        ],
      },
      {
        title: 'Après une réponse',
        bullets: [
          'Réponds dans la journée, depuis ta boîte, puis passe la fiche en « A répondu ».',
          'Réponse positive : propose deux créneaux d’appel précis (« mardi 10 h ou jeudi 15 h ? »). Ne demande jamais « quand êtes-vous disponible ? ».',
          'Demande d’infos : réponds en 3 lignes et propose quand même un appel. Un échange par email traîne, un appel avance.',
          'Réponse négative : remercie poliment, note-le. L’entreprise passe en pause 6 mois pour tout le monde.',
          'Appelle dans les 48 heures après une réponse positive : un intérêt refroidit vite.',
        ],
      },
      {
        title: 'Les relances',
        bullets: [
          'Sans réponse, une relance courte une semaine plus tard suffit. Jamais plus de deux.',
          'La relance ne répète pas le premier email : elle apporte une info nouvelle ou une question simple. Exemple : « Je me permets de revenir vers vous : est-ce que la fiche Google est un sujet pour vous en ce moment, ou plutôt pas ? »',
          'Souvent, le plus efficace après un email sans réponse, c’est un appel : « Je vous ai écrit la semaine dernière au sujet de votre fiche Google, vous avez eu le temps de voir ? »',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Écris un email pour une des entreprises auditées au module précédent, en suivant les 5 règles.',
          'Prépare ta réponse type à « Envoyez-moi plus d’infos ».',
        ],
      },
    ],
  },
  {
    id: 'appel',
    title: 'Le script d’appel',
    summary: 'Structure, accroches, scripts par offre, standard et répondeur.',
    minutes: 15,
    icon: 'phone',
    sections: [
      {
        title: 'Les 5 temps',
        bullets: [
          'Te présenter (10 secondes) : ton nom, ton statut, et vérifier que tu parles au décideur.',
          'Dire pourquoi tu appelles CETTE entreprise : l’observation notée pendant l’audit.',
          'Poser une question et écouter (module « Les questions qui font signer »).',
          'Présenter l’offre en deux phrases, prix compris.',
          'Proposer une suite concrète : signer maintenant, ou un rendez-vous à une date précise.',
        ],
      },
      {
        title: 'Les 10 premières secondes',
        text: [
          'C’est là que tout se joue. Parle calmement, souris, et va droit au but. Évite les phrases qui sonnent comme du démarchage classique : « Je ne vous dérange pas ? », « Comment allez-vous ? », « J’ai une offre exceptionnelle ».',
          'La meilleure accroche, c’est une observation vraie et précise sur son entreprise. Elle montre que tu ne l’appelles pas au hasard.',
        ],
      },
      {
        title: 'Exemple : site web',
        script: [
          { who: 'toi', line: 'Bonjour, je suis Inès Martin, apporteuse d’affaires indépendante pour Stacker. Je cherche à joindre le gérant, c’est bien vous ?' },
          { who: 'prospect', line: 'Oui, c’est pour quoi ?' },
          { who: 'toi', line: 'Je vous appelle parce que j’ai cherché votre menuiserie sur Google et je n’ai pas trouvé de site. Aujourd’hui, vos nouveaux clients vous trouvent comment ?' },
          { who: 'prospect', line: 'Surtout par le bouche-à-oreille.' },
          { who: 'toi', line: 'C’est le meilleur canal. Le site, c’est ce qui rassure les gens à qui on vous a recommandé quand ils vous cherchent avant d’appeler. On propose un site professionnel, hébergement et mises à jour compris, à partir de 39,99 € par mois, sans rien à gérer de votre côté.' },
          { who: 'toi', line: 'Je peux vous montrer les formules en deux minutes, ou je repasse vous voir jeudi matin si c’est plus simple ?' },
        ],
      },
      {
        title: 'Exemple : avis Google',
        script: [
          { who: 'toi', line: 'Bonjour, je suis Inès Martin, apporteuse d’affaires indépendante pour Stacker. J’ai vu votre fiche Google : vous avez de très bons avis, mais le dernier date de plusieurs mois.' },
          { who: 'prospect', line: 'Ah oui ? Les gens ne pensent pas à en laisser.' },
          { who: 'toi', line: 'C’est exactement ça. Les clients regardent surtout les avis récents. On propose un QR code à poser au comptoir : vos clients satisfaits laissent un avis en 20 secondes. Vous en avez combien par semaine, de clients contents ?' },
          { who: 'prospect', line: 'Pas mal, oui.' },
          { who: 'toi', line: 'Alors c’est dommage de les laisser partir sans avis. Le QR code est livré en 48 heures, c’est 9 € par mois, sans engagement. On le met en place maintenant ?' },
        ],
      },
      {
        title: 'Exemple : fiche Google incomplète',
        script: [
          { who: 'toi', line: 'Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker. Je vous appelle au sujet de votre fiche Google : il n’y a aucune photo du salon et les horaires du samedi ne sont pas indiqués.' },
          { who: 'prospect', line: 'Je n’ai jamais eu le temps de m’en occuper.' },
          { who: 'toi', line: 'C’est le cas de presque tous les commerçants. C’est pourtant la première chose que voient les clients qui cherchent un coiffeur dans le coin. Qui s’en occupe chez vous aujourd’hui ?' },
          { who: 'prospect', line: 'Personne.' },
          { who: 'toi', line: 'On s’en charge entièrement : on complète la fiche, on la tient à jour et on répond à vos avis, pour 69 € par mois. Vous voulez que je vous montre à quoi ressemblerait votre fiche ?' },
        ],
      },
      {
        title: 'Exemple : hôtel (InRoom)',
        script: [
          { who: 'toi', line: 'Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker. Je souhaiterais parler à la direction, c’est au sujet des services proposés à vos clients en chambre.' },
          { who: 'prospect', line: 'C’est moi, je vous écoute.' },
          { who: 'toi', line: 'Vos clients vous demandent-ils parfois un massage, un pressing ou une baby-sitter ?' },
          { who: 'prospect', line: 'Oui, et on ne sait pas toujours quoi leur répondre.' },
          { who: 'toi', line: 'C’est exactement ce que règle InRoom : un QR code dans chaque chambre, vos clients commandent le service depuis leur téléphone et tout est coordonné pour vous, sans concierge. Vous avez combien de chambres ?' },
        ],
      },
      {
        title: 'Passer le standard',
        bullets: [
          'Sois bref et assuré : « Bonjour, Inès Martin. Je souhaite parler au gérant au sujet de votre fiche Google, il est disponible ? »',
          'Si on te demande « C’est à quel sujet ? », dis la vérité en une phrase, sans entrer dans le détail.',
          'Si le gérant est absent, demande son prénom et le meilleur moment pour le rappeler. Note-le dans la fiche.',
          'La personne au standard est souvent de bon conseil : sois aimable, c’est elle qui te fait passer.',
        ],
      },
      {
        title: 'Laisser un message sur répondeur',
        text: [
          'Moins de 20 secondes : « Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker. Je vous appelle au sujet de votre fiche Google, j’ai remarqué qu’il manque vos horaires. Je vous rappelle demain en fin de matinée, ou vous pouvez me joindre au 06… Bonne journée. »',
          'Puis rappelle vraiment quand tu l’as dit : c’est ce qui construit la confiance.',
        ],
      },
      {
        title: 'Les réflexes',
        bullets: [
          'Souris en parlant : ça s’entend.',
          'Parle moins que ton prospect. Ta meilleure arme, c’est la question.',
          'Annonce le prix tôt et calmement : un prix caché crée de la méfiance.',
          'Debout et dans un endroit calme, ta voix porte mieux.',
          'Après chaque appel, note dans la fiche ce qui a été dit et la prochaine action, avec sa date.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Lis chaque script à voix haute deux fois, puis redis-le avec tes propres mots.',
          'Enregistre-toi sur ton téléphone en faisant le script « avis Google » et réécoute : ta voix est-elle posée ? Parles-tu trop vite ?',
        ],
      },
    ],
  },
  {
    id: 'decouverte',
    title: 'Les questions qui font signer',
    summary: 'Faire parler le commerçant, écouter, reformuler.',
    minutes: 10,
    icon: 'message',
    sections: [
      {
        title: 'Pourquoi questionner plutôt que présenter',
        text: [
          'Un commerçant n’achète pas un service, il achète la solution à un problème qu’il reconnaît. Si c’est toi qui expliques son problème, il se défend. Si c’est lui qui le dit, il est déjà à moitié convaincu.',
          'La règle : dans un bon appel, le commerçant parle plus que toi.',
        ],
      },
      {
        title: 'Les questions de découverte',
        bullets: [
          'Sur ses clients : « Aujourd’hui, vos nouveaux clients vous trouvent comment ? »',
          'Sur sa situation : « Qui s’occupe de votre fiche Google, de votre site, de vos réseaux ? »',
          'Sur ce qui le gêne : « Qu’est-ce qui vous embête le plus là-dedans ? »',
          'Sur ses envies : « Si vous aviez plus de clients, ce serait plutôt en semaine ou le week-end ? »',
          'Sur ce qu’il a déjà essayé : « Vous avez déjà travaillé avec quelqu’un pour ça ? Qu’est-ce qui n’a pas marché ? »',
        ],
      },
      {
        title: 'Écouter vraiment',
        bullets: [
          'Laisse des silences : après ta question, attends. Le commerçant va souvent compléter sa réponse.',
          'Note les mots qu’il utilise, et réutilise-les : s’il parle de « clients de passage », parle de clients de passage.',
          'Ne coupe jamais une réponse pour placer ton offre.',
        ],
      },
      {
        title: 'Reformuler',
        text: [
          'Avant de présenter l’offre, résume ce qu’il t’a dit : « Si je comprends bien, vos clients viennent surtout par le bouche-à-oreille, votre fiche Google n’a pas de photos, et vous n’avez pas le temps de vous en occuper. C’est bien ça ? »',
          'Quand il répond « oui, c’est ça », tu as gagné sa confiance : il sait que tu as écouté. Ta présentation de l’offre devient alors la suite logique, pas une vente forcée.',
        ],
      },
      {
        title: 'Exemple complet',
        script: [
          { who: 'toi', line: 'Aujourd’hui, vos nouveaux clients vous trouvent comment ?' },
          { who: 'prospect', line: 'Le bouche-à-oreille surtout, et quelques-uns par Google je crois.' },
          { who: 'toi', line: 'Et quand ils vous trouvent sur Google, qu’est-ce qu’ils voient ?' },
          { who: 'prospect', line: 'Honnêtement, je ne sais pas, je n’ai jamais regardé.' },
          { who: 'toi', line: 'Je l’ai regardée avant de vous appeler : il n’y a pas de photo et le dernier avis a un an. Si je comprends bien, des clients vous cherchent, mais ce qu’ils trouvent ne vous met pas en valeur. C’est ça ?' },
          { who: 'prospect', line: 'Oui, dit comme ça…' },
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Écris tes 3 questions de découverte préférées et garde-les à côté de toi pendant tes appels.',
          'Entraîne-toi à reformuler avec un proche : il te décrit son travail, tu le résumes en une phrase.',
        ],
      },
    ],
  },
  {
    id: 'objections',
    title: 'Répondre aux objections',
    summary: 'Les 12 objections les plus fréquentes et la méthode pour toutes les autres.',
    minutes: 12,
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
          { objection: '« Ça ne marche pas, Internet, pour mon métier. »', answer: 'C’est possible. Vos clients, quand on leur recommande un artisan, vous pensez qu’ils vérifient avant d’appeler ? Le plus souvent, ils tapent votre nom sur Google : c’est cette première impression qu’on soigne.' },
          { objection: '« J’ai déjà été arnaqué par une agence. »', answer: 'Je suis désolé, c’est malheureusement fréquent. Qu’est-ce qui s’était passé ? (Écoute.) Ici, le prix est fixe et affiché, le contrat est clair, et vous avez 14 jours pour vous rétracter sans frais.' },
          { objection: '« Je n’ai pas besoin de plus de clients. »', answer: 'Tant mieux, c’est une bonne nouvelle. Et pour garder ceux que vous avez, vos avis et votre fiche comptent aussi : un client fidèle vérifie souvent vos horaires sur Google. Vous les mettez à jour vous-même ?' },
          { objection: '« Je n’aime pas m’engager sur 12 mois. »', answer: 'Je comprends. Certaines offres sont sans engagement, comme le QR Avis ou la fiche Google. On peut commencer par là, et vous verrez le résultat avant d’aller plus loin.' },
          { objection: '« Rappelez-moi dans 6 mois. »', answer: 'Avec plaisir. Pour être sûr de vous appeler au bon moment : qu’est-ce qui aura changé dans 6 mois ? (Si la raison est vraie, note la date et rappelle vraiment. Sinon, c’est souvent une autre objection : creuse.)' },
          { objection: '« Mon neveu s’occupe de mon site. »', answer: 'C’est bien d’avoir quelqu’un de confiance. Il a le temps de le mettre à jour régulièrement ? Notre offre peut aussi le soulager de la partie fiche Google et avis.' },
        ],
      },
      {
        title: 'La méthode pour toutes les objections',
        bullets: [
          'Accueille : « Je comprends », « C’est normal », « Vous avez raison de poser la question ». Ne contredis jamais de front.',
          'Creuse : pose une question pour comprendre ce qu’il y a derrière. « Trop cher » veut souvent dire « je ne vois pas encore ce que ça me rapporte ».',
          'Réponds à la vraie raison, en une ou deux phrases.',
          'Relance : termine toujours par une question ou une proposition concrète.',
        ],
      },
      {
        title: 'Objection ou vrai refus ?',
        text: [
          'Une objection, c’est une question : le prospect cherche une raison de dire oui. Un vrai refus est net, répété, et ne s’accompagne d’aucune question. Si tu as répondu deux fois et que la réponse reste non, arrête-toi, remercie, et note-le : l’entreprise sera en pause 6 mois pour tout le monde.',
        ],
      },
      {
        title: 'La règle d’or',
        text: [
          'Une objection, c’est une question. Réponds, puis repose une question. Ne te bats jamais pour avoir raison : ton but est d’aider le commerçant à décider, pas de gagner un débat.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Choisis les 4 objections qui te font le plus peur et entraîne-toi à y répondre avec un proche qui joue le commerçant.',
          'Après tes 10 prochains appels, note les objections entendues : ce sera ta liste personnelle à travailler.',
        ],
      },
    ],
  },
  {
    id: 'conclure',
    title: 'Conclure',
    summary: 'Reconnaître le bon moment, proposer la signature, décrocher un rendez-vous.',
    minutes: 10,
    icon: 'signature',
    sections: [
      {
        title: 'Les signaux d’achat',
        bullets: [
          'Il pose des questions pratiques : « C’est mis en place quand ? », « Je peux arrêter quand je veux ? », « Comment on paie ? »',
          'Il se projette : « Il faudrait que je vous envoie des photos alors ? »',
          'Il parle prix sans rejeter : « Et la formule au-dessus, il y a quoi en plus ? »',
          'Quand tu entends ça, arrête de présenter : il est temps de proposer.',
        ],
      },
      {
        title: 'Proposer clairement',
        text: [
          'Beaucoup de débutants présentent très bien puis n’osent pas demander. Ose. Une proposition claire est un service rendu au commerçant : il sait ce qu’il doit décider.',
          'Formulations qui marchent : « On le met en place maintenant ? Ça prend 5 minutes. » ; « Vous préférez la formule Starter ou la Pro ? » ; « Je vous envoie le contrat, vous le lisez et vous signez sur mon téléphone, ou on se voit demain pour le faire ensemble ? »',
        ],
      },
      {
        title: 'Signer à distance ou en vrai',
        bullets: [
          'Au téléphone, si le commerçant est prêt : propose de passer le voir rapidement pour signer sur ton téléphone, ou de fixer un appel vidéo.',
          'En rendez-vous physique : c’est souvent là que se signent les meilleurs clients. Prépare l’écran de l’offre avant d’arriver.',
          'Dans tous les cas, propose une date et une heure précises. « Je repasse jeudi à 10 h, ça vous va ? » vaut mieux que « on se rappelle ».',
        ],
      },
      {
        title: 'Si ce n’est pas le moment',
        bullets: [
          'Fixe une prochaine étape concrète avec une date, et note-la dans la fiche.',
          'Demande ce qui lui manque pour décider, et apporte exactement ça la prochaine fois.',
          'Ne force jamais : un client signé sous pression se rétracte dans les 14 jours, ou ne paie pas.',
        ],
      },
      {
        title: 'Exemple de conclusion',
        script: [
          { who: 'prospect', line: 'Et ça se met en place comment, concrètement ?' },
          { who: 'toi', line: 'Très simplement : on signe le contrat sur mon téléphone, vous recevez votre copie par email tout de suite, et l’équipe vous contacte pour la mise en place. Rien n’est prélevé pendant les 14 jours de rétractation.' },
          { who: 'prospect', line: 'D’accord.' },
          { who: 'toi', line: 'Vous préférez la formule Pro avec les réponses aux avis, ou on commence par la Starter ?' },
          { who: 'prospect', line: 'La Pro, ça m’évitera de répondre moi-même.' },
          { who: 'toi', line: 'Parfait. Je passe demain à 11 h pour qu’on la signe ensemble, ça vous va ?' },
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Écris tes deux phrases de conclusion préférées et dis-les à voix haute jusqu’à ce qu’elles sortent naturellement.',
          'Sur tes prochains appels, compte combien de fois tu as fait une proposition claire.',
        ],
      },
    ],
  },
  {
    id: 'signature',
    title: 'Faire signer un client',
    summary: 'La signature dans l’app, sans erreur et sans pression.',
    minutes: 8,
    icon: 'signature',
    sections: [
      {
        title: 'Avant de commencer',
        bullets: [
          'Vérifie que tu parles à quelqu’un qui peut engager l’entreprise : le gérant, ou une personne qu’il a autorisée.',
          'Demande-lui d’avoir sous la main son SIRET (ou son Kbis) et son RIB.',
          'Prévois 5 à 10 minutes au calme. Ne fais jamais signer dans l’urgence, entre deux clients.',
        ],
      },
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
          'Qui va le contacter ensuite pour la mise en place, et sous quel délai.',
        ],
      },
      {
        title: 'Les erreurs fréquentes',
        bullets: [
          'Un email mal tapé : le client ne reçoit pas son contrat. Fais-le relire à voix haute.',
          'L’IBAN d’un compte personnel au lieu du compte de l’entreprise : demande toujours le RIB professionnel.',
          'Une offre différente de celle dont vous avez parlé : relis ensemble le nom de l’offre et le prix avant la signature.',
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
      {
        title: 'À toi de jouer',
        bullets: [
          'Ouvre l’écran « Faire signer » sur un prospect et parcours-le jusqu’au contrat, sans valider, pour connaître chaque étape.',
          'Prépare ta phrase sur les 14 jours de rétractation et le prélèvement.',
        ],
      },
    ],
  },
  {
    id: 'apres',
    title: 'Après la signature',
    summary: 'Garder ses clients, les faire monter en gamme, et obtenir des recommandations.',
    minutes: 8,
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
        title: 'Les trois appels qui fidélisent',
        bullets: [
          'Une semaine après la signature : « La mise en place s’est bien passée ? Vous avez été contacté ? » S’il y a un souci, préviens Stacker.',
          'Un mois après : « Vous avez vu une différence ? » C’est le bon moment pour lui montrer un résultat (nouveaux avis, fiche complète).',
          'Tous les trois mois : un simple appel pour garder le lien. Un client qui se sent suivi reste.',
        ],
      },
      {
        title: 'Proposer une offre de plus',
        text: [
          'Un client satisfait d’une offre est le meilleur prospect pour une deuxième. Un commerçant qui a son QR Avis voudra peut-être que quelqu’un réponde à ses avis (E-Réputation) ou une fiche Google entretenue. Ne le propose qu’une fois le premier service apprécié, et seulement s’il y a un vrai besoin.',
        ],
      },
      {
        title: 'Le bouche-à-oreille',
        text: [
          'Un mois après la mise en place, rappelle ton client : tout se passe bien ? C’est le bon moment pour lui demander s’il connaît un confrère ou un voisin commerçant qui aurait le même besoin.',
          'Formulation : « Je suis content que ça vous plaise. Vous connaissez un commerçant autour de vous qui aurait besoin de la même chose ? Je peux l’appeler de votre part ? » Un prospect recommandé t’écoute beaucoup plus facilement.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Pour chaque client signé, programme tout de suite les rappels à 1 semaine et à 1 mois.',
          'Prépare ta phrase de demande de recommandation.',
        ],
      },
    ],
  },
  {
    id: 'organisation',
    title: 'T’organiser et progresser',
    summary: 'Ton pipeline, tes chiffres, et comment t’améliorer chaque semaine.',
    minutes: 8,
    icon: 'graduation',
    sections: [
      {
        title: 'Ton pipeline',
        text: [
          'Chaque entreprise que tu suis est à une étape : réservée, contactée, a répondu, rendez-vous, signée. L’app te montre où en est chacune. Ton travail quotidien, c’est de faire avancer chaque fiche d’une étape, ou de la libérer.',
        ],
      },
      {
        title: 'La règle des notes',
        bullets: [
          'Après chaque contact, une note courte : ce qui a été dit, la prochaine action, sa date.',
          'Une fiche sans prochaine action est une fiche oubliée : soit tu programmes quelque chose, soit tu la libères.',
          'Note les détails personnels utiles (« fermé le lundi », « préfère être appelé le matin ») : ils font toute la différence au rappel suivant.',
        ],
      },
      {
        title: 'Tes chiffres de la semaine',
        bullets: [
          'Combien d’entreprises contactées (emails et appels).',
          'Combien de vraies conversations avec un décideur.',
          'Combien de rendez-vous ou de propositions faites.',
          'Combien de signatures.',
          'Regarde où ça coince : beaucoup de contacts mais peu de conversations ? Travaille ton accroche et tes horaires. Beaucoup de conversations mais peu de propositions ? Travaille tes questions et ta conclusion.',
        ],
      },
      {
        title: 'Ton bilan du vendredi (15 minutes)',
        bullets: [
          'Relis tes notes de la semaine : quel appel s’est le mieux passé, et pourquoi ?',
          'Quelle objection t’a bloqué ? Relis le module Objections et prépare une meilleure réponse.',
          'Libère les fiches mortes, programme tes rappels de la semaine suivante.',
          'Fixe ton objectif d’effort pour la semaine qui vient.',
        ],
      },
      {
        title: 'Monter de niveau',
        text: [
          'Ton niveau dépend de ton nombre de clients actifs. Chaque client qui reste compte : c’est pour ça que le suivi (module précédent) est aussi important que la prospection. L’accueil de l’app t’indique combien de clients actifs il te manque pour le niveau suivant.',
        ],
      },
      {
        title: 'À toi de jouer',
        bullets: [
          'Bloque 15 minutes dans ton agenda chaque vendredi pour ton bilan.',
          'Ouvre Prospection et vérifie que chacune de tes fiches a une prochaine action datée.',
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
