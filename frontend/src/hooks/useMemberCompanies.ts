import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Company } from '../api';

export type MemberCompany = Pick<Company, 'id' | 'name' | 'status'>;

const STORAGE_KEY = 'kap_member_company_ids';
const CHANGE_EVENT = 'kap-member-companies-changed';

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function cleanIds(ids: number[]) {
  return Array.from(new Set(ids.filter(id => Number.isFinite(id) && id > 0)));
}

export function readMemberCompanyIds() {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? cleanIds(parsed.map(Number)) : [];
  } catch {
    return [];
  }
}

export function writeMemberCompanyIds(ids: number[]) {
  const cleaned = cleanIds(ids);
  const store = storage();
  if (store) store.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  return cleaned;
}

function notifyMemberCompaniesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useMemberCompanies<T extends MemberCompany>(companies: T[]) {
  const [memberIds, setMemberIdsState] = useState<number[]>(() => readMemberCompanyIds());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setMemberIdsState(readMemberCompanyIds());
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    api.getMembers()
      .then(({ members: serverMembers }) => {
        const serverIds = cleanIds(serverMembers.map(member => member.id));
        if (cancelled) return;
        writeMemberCompanyIds(serverIds);
        setMemberIdsState(serverIds);
        setError(null);
      })
      .catch(fetchError => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Üye listesi alınamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const members = useMemo(() => {
    const byId = new Map(companies.map(company => [company.id, company]));
    return memberIds.map(id => byId.get(id)).filter((company): company is T => Boolean(company));
  }, [companies, memberIds]);

  const applyMemberIds = useCallback((ids: number[]) => {
    const next = writeMemberCompanyIds(ids);
    setMemberIdsState(next);
    notifyMemberCompaniesChanged();
    return next;
  }, []);

  const setMemberIds = useCallback((ids: number[]) => {
    const previous = readMemberCompanyIds();
    const next = applyMemberIds(ids);
    setError(null);
    void api.setMembers(next)
      .then(({ members: serverMembers }) => applyMemberIds(serverMembers.map(member => member.id)))
      .catch(saveError => {
        applyMemberIds(previous);
        setError(saveError instanceof Error ? saveError.message : 'Üye listesi kaydedilemedi');
      });
    return next;
  }, [applyMemberIds]);

  const addMember = useCallback((id: number) => {
    const previous = readMemberCompanyIds();
    applyMemberIds([...previous, id]);
    setError(null);
    void api.addMember(id)
      .then(({ members: serverMembers }) => applyMemberIds(serverMembers.map(member => member.id)))
      .catch(saveError => {
        applyMemberIds(previous);
        setError(saveError instanceof Error ? saveError.message : 'Üye eklenemedi');
      });
  }, [applyMemberIds]);

  const removeMember = useCallback((id: number) => {
    const previous = readMemberCompanyIds();
    applyMemberIds(previous.filter(memberId => memberId !== id));
    setError(null);
    void api.removeMember(id)
      .then(({ members: serverMembers }) => applyMemberIds(serverMembers.map(member => member.id)))
      .catch(saveError => {
        applyMemberIds(previous);
        setError(saveError instanceof Error ? saveError.message : 'Üye çıkarılamadı');
      });
  }, [applyMemberIds]);

  const toggleMember = useCallback((id: number) => {
    const current = readMemberCompanyIds();
    setMemberIds(current.includes(id) ? current.filter(memberId => memberId !== id) : [...current, id]);
  }, [setMemberIds]);

  return {
    memberIds,
    members,
    loading,
    error,
    addMember,
    removeMember,
    toggleMember,
    setMemberIds,
  };
}
