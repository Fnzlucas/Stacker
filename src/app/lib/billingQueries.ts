import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import { fetchBilling, setAutoRenew, startCheckout, type Billing } from './billing';

export const BILLING_KEY = ['billing'] as const;

/** État de l'abonnement. `poll` : relecture toutes les 2 s jusqu'à l'activation (retour de la page de paiement). */
export function useBilling(poll = false): UseQueryResult<Billing> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: BILLING_KEY, queryFn: () => fetchBilling(backend), staleTime: 60_000, refetchInterval: (q) => (poll && q.state.data?.status !== 'actif' ? 2000 : false) });
}

export function useStartCheckout() {
  const { backend } = useSignedIn();
  return useMutation({ mutationFn: () => startCheckout(backend) });
}

export function useSetAutoRenew() {
  const { backend } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (on: boolean) => setAutoRenew(backend, on), onSuccess: (data) => qc.setQueryData(BILLING_KEY, data) });
}
