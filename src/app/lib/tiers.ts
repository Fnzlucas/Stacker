/**
 * Paliers de commission lus en base (commission_tiers) et affichage de la
 * progression. Le niveau COURANT est calculé par le serveur (profiles.tier) ;
 * ce module ne fait que présenter l'écart vers le palier suivant.
 */
import { z } from 'zod';

export const TIER_CODES = ['rookie', 'pro', 'legend', 'elite'] as const;
export type TierCode = (typeof TIER_CODES)[number];

export const tierSchema = z.object({
  code: z.enum(TIER_CODES),
  label: z.string(),
  rate_bps: z.number().int().min(0).max(10000),
  min_active_clients: z.number().int().min(0),
  max_active_clients: z.number().int().min(0).nullable(),
  sort_order: z.number().int(),
  criteria_provisional: z.boolean(),
});
export type Tier = z.infer<typeof tierSchema>;
export const tiersSchema = z.array(tierSchema);

/** 1500 → « 15 % » ; 1250 → « 12,5 % » (espace insécable). */
export function formatRate(bps: number): string {
  const pct = bps / 100;
  return `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

export interface TierProgress {
  current: Tier;
  next: Tier | null;
  /** Clients actifs manquants pour le palier suivant (0 au niveau maximal). */
  remaining: number;
  /** Avancement entre le seuil courant et le suivant, 0 à 100 (entier). */
  percent: number;
  /** Numérateur / dénominateur affichés (« 1 / 3 clients actifs »). */
  done: number;
  target: number;
  provisional: boolean;
}

/**
 * @param tiers  paliers renvoyés par la base (ordre quelconque)
 * @param currentCode  niveau calculé par le serveur
 * @param activeClients  clients payants actifs (serveur)
 */
export function tierProgress(tiers: readonly Tier[], currentCode: string, activeClients: number): TierProgress | null {
  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  const index = sorted.findIndex((t) => t.code === currentCode);
  const current = sorted[index];
  if (!current) return null;
  const next = sorted[index + 1] ?? null;
  const provisional = sorted.some((t) => t.criteria_provisional);
  const clients = Math.max(0, Math.floor(activeClients));
  if (!next) {
    return { current, next: null, remaining: 0, percent: 100, done: clients, target: clients, provisional };
  }
  const span = Math.max(1, next.min_active_clients - current.min_active_clients);
  const done = Math.min(span, Math.max(0, clients - current.min_active_clients));
  return {
    current,
    next,
    remaining: Math.max(0, next.min_active_clients - clients),
    percent: Math.round((done / span) * 100),
    done,
    target: span,
    provisional,
  };
}
