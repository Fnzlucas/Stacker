import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSignedIn } from '../auth/AuthProvider';
import {
  acceptRules,
  addNote,
  claimProspect,
  deleteNote,
  disconnectMailbox,
  fetchCampaign,
  setCampaignStatus,
  startCampaign,
  extendClaim,
  fetchMyProspects,
  fetchProspect,
  fetchQuotas,
  fetchTemplates,
  logCall,
  markEmailSent,
  prepareEmail,
  releaseClaim,
  setContact,
  setStatus,
  type CallOutcome,
  type ProspectDetail,
  type ProspectQuotas,
  type ProspectRow,
  type ProspectStatus,
} from './prospects';

export const PROSPECTS_KEY = ['prospects'] as const;
const listKey = [...PROSPECTS_KEY, 'list'] as const;
const quotasKey = [...PROSPECTS_KEY, 'quotas'] as const;
const detailKey = (id: string) => [...PROSPECTS_KEY, 'detail', id] as const;

export function useMyProspects(): UseQueryResult<ProspectRow[]> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: listKey, queryFn: () => fetchMyProspects(backend) });
}

export function useProspect(id: string): UseQueryResult<ProspectDetail> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: detailKey(id), queryFn: () => fetchProspect(backend, id), retry: false });
}

export function useProspectQuotas(): UseQueryResult<ProspectQuotas> {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: quotasKey, queryFn: () => fetchQuotas(backend) });
}

export function useEmailTemplates() {
  const { backend } = useSignedIn();
  return useQuery({ queryKey: [...PROSPECTS_KEY, 'templates'], queryFn: () => fetchTemplates(backend), staleTime: 10 * 60_000 });
}

/** Mutation suivie d'un rafraîchissement de toutes les données de prospection. */
function useProspectMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: PROSPECTS_KEY }) });
}

export function useAcceptRules() {
  const { backend } = useSignedIn();
  return useProspectMutation(() => acceptRules(backend));
}

export function useClaim() {
  const { backend } = useSignedIn();
  return useProspectMutation((siret: string) => claimProspect(backend, siret));
}

export function useSetStatus(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((v: { status: ProspectStatus; nextActionAt: string | null }) => setStatus(backend, id, v.status, v.nextActionAt));
}

export function useSetContact(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((v: { phone: string | null; email: string | null; source: string | null }) => setContact(backend, id, v));
}

export function useAddNote(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((body: string) => addNote(backend, id, body));
}

export function useDeleteNote() {
  const { backend } = useSignedIn();
  return useProspectMutation((noteId: string) => deleteNote(backend, noteId));
}

export function useLogCall(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((v: { outcome: CallOutcome; nextActionAt: string | null }) => logCall(backend, id, v.outcome, v.nextActionAt));
}

export function useExtend(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation(() => extendClaim(backend, id));
}

export function useRelease(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((reason: 'manuel' | 'opposition') => releaseClaim(backend, id, reason));
}

export function usePrepareEmail(id: string) {
  const { backend } = useSignedIn();
  return useProspectMutation((templateKey: string) => prepareEmail(backend, id, templateKey));
}

export function useMarkSent() {
  const { backend } = useSignedIn();
  return useProspectMutation((emailId: string) => markEmailSent(backend, emailId));
}

// ---------------------------------------------------------------------------
// Campagnes
// ---------------------------------------------------------------------------

export function useCampaign() {
  const { backend } = useSignedIn();
  // Les compteurs bougent pendant la journée : rafraîchis toutes les 60 s.
  return useQuery({ queryKey: [...PROSPECTS_KEY, 'campaign'], queryFn: () => fetchCampaign(backend), refetchInterval: 60_000 });
}

export function useStartCampaign() {
  const { backend } = useSignedIn();
  return useProspectMutation((v: { department: string; preset: string; dailyTarget: number; templateKey: string }) => startCampaign(backend, v));
}

export function useCampaignStatus() {
  const { backend } = useSignedIn();
  return useProspectMutation((status: 'active' | 'paused' | 'stopped') => setCampaignStatus(backend, status));
}

export function useDisconnectMailbox() {
  const { backend } = useSignedIn();
  return useProspectMutation(() => disconnectMailbox(backend));
}
