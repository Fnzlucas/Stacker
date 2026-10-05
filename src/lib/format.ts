const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** 1234 → « 1 234 » (espace fine insécable, typographie française). */
export function formatInteger(value: number): string {
  return integer.format(value);
}

/** Typographie française : espace fine insécable avant ? ! ; : et avant %, pour éviter un signe seul en début de ligne. */
export function frenchSpaces(text: string): string {
  return text.replace(/ ([?!;:%])/g, '\u202f$1');
}

/** Accord simple : 0 ou 1 → singulier. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return Math.abs(count) < 2 ? singular : pluralForm;
}

/** Libellé du compteur public de la liste d'attente (nombre réel). */
export function waitlistCountLabel(count: number): { strong: string | null; rest: string } {
  if (count <= 0) return { strong: null, rest: 'Liste d’attente ouverte' };
  return {
    strong: formatInteger(count),
    rest: ` ${plural(count, 'personne inscrite', 'personnes inscrites')} sur la liste d’attente`,
  };
}

/** Message de confirmation selon la position (faits uniquement, aucune promesse). */
export function positionMessage(position: number, seats: number): string {
  const priority = `Les inscrits ont priorité sur les ${String(seats)} places de l’offre de lancement.`;
  if (position <= seats) return `Tu fais partie des ${String(seats)} premiers inscrits. ${priority}`;
  return `${priority} On te prévient par email dès l’ouverture.`;
}
