import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import { PROSPECTS_KEY } from './prospectQueries';
import {
  fetchCatalog,
  fetchDeal,
  fetchEarnings,
  fetchMyDeals,
  previewDeal,
  requestPayout,
  setPayoutAccount,
  signDeal,
  type Catalog,
  type DealDetail,
  type DealInput,
  type DealRow,
  type Earnings,
} from './deals';

export const DEALS_KEY = ['deals'] as const;
export const EARNINGS_KEY = ['earnings'] as const;

export function useCatalog(): UseQueryResult<Catalog> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...DEALS_KEY, 'catalog'], queryFn: () => fetchCatalog(backend), staleTime: 5 * 60_000 });
}

export function useMyDeals(): UseQueryResult<DealRow[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...DEALS_KEY, 'list'], queryFn: () => fetchMyDeals(backend), staleTime: 0 });
}

export function useDeal(id: string): UseQueryResult<DealDetail> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...DEALS_KEY, 'detail', id], queryFn: () => fetchDeal(backend, id), retry: false });
}

export function useEarnings(): UseQueryResult<Earnings> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: EARNINGS_KEY, queryFn: () => fetchEarnings(backend), staleTime: 0 });
}

export function usePreviewDeal() {
  const { backend } = useSignedIn();
  return useMutation({ mutationFn: (v: DealInput) => previewDeal(backend, v) });
}

export function useSignDeal() {
  const { backend } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { input: DealInput; signature: string; sha: string }) => signDeal(backend, a.input, a.signature, a.sha),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: DEALS_KEY }),
        qc.invalidateQueries({ queryKey: EARNINGS_KEY }),
        qc.invalidateQueries({ queryKey: PROSPECTS_KEY }),
      ]);
    },
  });
}

export function useSetPayoutAccount() {
  const { backend } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { holder: string; iban: string }) => setPayoutAccount(backend, a.holder, a.iban),
    onSettled: () => qc.invalidateQueries({ queryKey: EARNINGS_KEY }),
  });
}

export function useRequestPayout() {
  const { backend } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => requestPayout(backend), onSettled: () => qc.invalidateQueries({ queryKey: EARNINGS_KEY }) });
}
