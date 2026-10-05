import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Goal, ProfileUpdate } from '@shared/account';
import { useSignedIn } from '../auth/AuthProvider';
import { completeOnboarding, fetchProfile, fetchTiers, updateProfile, type Profile } from './api';
import type { Tier } from './tiers';

export const profileKey = (userId: string) => ['profile', userId] as const;
export const TIERS_KEY = ['commission_tiers'] as const;

export function useProfile(): UseQueryResult<Profile> {
  const { backend, userId } = useSignedIn();
  return useQuery({ queryKey: profileKey(userId), queryFn: () => fetchProfile(backend) });
}

export function useTiers(): UseQueryResult<Tier[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: TIERS_KEY, queryFn: () => fetchTiers(backend), staleTime: 10 * 60_000 });
}

export function useUpdateProfile() {
  const { backend, userId } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: ProfileUpdate) => updateProfile(backend, userId, values),
    onSuccess: (profile) => qc.setQueryData(profileKey(userId), profile),
  });
}

export function useCompleteOnboarding() {
  const { backend, userId } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { firstName: string; department: string; goal: Goal }) => completeOnboarding(backend, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKey(userId) }),
  });
}
