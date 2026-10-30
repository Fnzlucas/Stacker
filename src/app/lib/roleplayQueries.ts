import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import { fetchRoleplay, fetchRoleplayDetail, type RoleplayDetail, type RoleplayState } from './roleplay';

export const ROLEPLAY_KEY = ['roleplay'] as const;

export function useRoleplay(): UseQueryResult<RoleplayState> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: ROLEPLAY_KEY, queryFn: () => fetchRoleplay(backend) });
}

export function useRoleplayDetail(id: string | null): UseQueryResult<RoleplayDetail> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...ROLEPLAY_KEY, id], queryFn: () => fetchRoleplayDetail(backend, id ?? ''), enabled: Boolean(id) });
}
