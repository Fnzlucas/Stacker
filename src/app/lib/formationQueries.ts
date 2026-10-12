import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import { fetchFormation, setModuleDone } from './formation';

export const FORMATION_KEY = ['formation'] as const;

export function useFormation(): UseQueryResult<string[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: FORMATION_KEY, queryFn: () => fetchFormation(backend) });
}

export function useSetModuleDone() {
  const { backend } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (a: { id: string; done: boolean }) => setModuleDone(backend, a.id, a.done), onSuccess: (data) => qc.setQueryData(FORMATION_KEY, data) });
}
