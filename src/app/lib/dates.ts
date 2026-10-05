/** Dates affichées dans l'app, toujours en heure de Paris (jamais de date figée). */
const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

/** « LUNDI 5 OCTOBRE » (en-tête de l'accueil). */
export function todayLabel(now: Date): string {
  return dayFormat.format(now).toUpperCase();
}

/** « 5 octobre 2026 ». */
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : longDate.format(d);
}

/** Initiales pour l'avatar (« Inès Martin » → « IM », « Inès » → « I »). */
export function initials(firstName: string | null | undefined, lastName?: string | null): string {
  const first = Array.from(firstName?.trim() ?? '')[0] ?? '';
  const last = Array.from(lastName?.trim() ?? '')[0] ?? '';
  return `${first}${last}`.toUpperCase() || '?';
}
