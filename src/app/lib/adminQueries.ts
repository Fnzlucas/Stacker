import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import {
  fetchAdminDeals,
  fetchAdminOffers,
  fetchAdminPayouts,
  fetchAdminStackers,
  fetchIsAdmin,
  fetchOverview,
  markPayout,
  setDealStatus,
  setFlag,
  setOfferActive,
  type AdminDeal,
  type AdminOffer,
  type AdminPayout,
  type AdminStacker,
  type Overview,
  type PayoutFilter,
} from './admin';

export const ADMIN_KEY = ['admin'] as const;

export function useIsAdmin(): UseQueryResult<boolean> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'is'], queryFn: () => fetchIsAdmin(backend), staleTime: 10 * 60_000 });
}
export function useOverview(): UseQueryResult<Overview> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'overview'], queryFn: () => fetchOverview(backend), staleTime: 0, retry: false });
}
export function useAdminPayouts(status: PayoutFilter): UseQueryResult<AdminPayout[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'payouts', status], queryFn: () => fetchAdminPayouts(backend, status), staleTime: 0 });
}
export function useAdminDeals(status: string | null, search: string): UseQueryResult<AdminDeal[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'deals', status, search], queryFn: () => fetchAdminDeals(backend, status, search), staleTime: 0 });
}
export function useAdminOffers(): UseQueryResult<AdminOffer[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'offers'], queryFn: () => fetchAdminOffers(backend), staleTime: 0 });
}
export function useAdminStackers(search: string): UseQueryResult<AdminStacker[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ADMIN_KEY, 'stackers', search], queryFn: () => fetchAdminStackers(backend, search), staleTime: 0 });
}

/** Toute action admin rafraîchit l'ensemble de l'espace admin. */
function useAdminMutation<A>(fn: (a: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ADMIN_KEY }) });
}
export function useMarkPayout() {
  const { backend } = useSignedIn();
  return useAdminMutation((a: { id: string; status: 'verse' | 'refuse'; note: string }) => markPayout(backend, a.id, a.status, a.note));
}
export function useSetDealStatus() {
  const { backend } = useSignedIn();
  return useAdminMutation((a: { id: string; status: 'suspendu' | 'resilie' | 'annule'; reason: string }) => setDealStatus(backend, a.id, a.status, a.reason));
}
export function useSetOfferActive() {
  const { backend } = useSignedIn();
  return useAdminMutation((a: { id: string; active: boolean }) => setOfferActive(backend, a.id, a.active));
}
export function useSetFlag() {
  const { backend } = useSignedIn();
  return useAdminMutation((a: { key: string; enabled: boolean }) => setFlag(backend, a.key, a.enabled));
}
