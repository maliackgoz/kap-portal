import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Company } from '../api';

export type MemberCompany = Pick<Company, 'id' | 'name' | 'status'>;

const STORAGE_KEY = 'kap_member_company_ids';
const CHANGE_EVENT = 'kap-member-companies-changed';
const DEFAULT_MEMBER_KEYWORDS = ['VAKIF', 'VAKIFBANK', 'ZIRAAT', 'HALK', 'HALKBANK'];

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

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function suggestDefaultMemberIds(companies: MemberCompany[]) {
  return companies
    .filter(company => {
      const name = normalize(company.name);
      return DEFAULT_MEMBER_KEYWORDS.some(keyword => name.includes(normalize(keyword)));
    })
    .map(company => company.id);
}

function sameIds(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

function notifyMemberCompaniesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useMemberCompanies<T extends MemberCompany>(companies: T[]) {
  const [memberIds, setMemberIdsState] = useState<number[]>(() => readMemberCompanyIds());

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
        const localIds = readMemberCompanyIds();
        const merged = cleanIds([...serverIds, ...localIds]);
        if (cancelled) return;

        writeMemberCompanyIds(merged);
        setMemberIdsState(merged);
        if (!sameIds(serverIds, merged)) {
          void api.setMembers(merged).catch(error => console.warn('Uye listesi sunucuya yazilamadi', error));
        }
      })
      .catch(error => console.warn('Uye listesi sunucudan alinamadi', error));

    return () => { cancelled = true; };
  }, []);

  const members = useMemo(() => {
    const byId = new Map(companies.map(company => [company.id, company]));
    return memberIds.map(id => byId.get(id)).filter((company): company is T => Boolean(company));
  }, [companies, memberIds]);

  const setMemberIds = useCallback((ids: number[]) => {
    const next = writeMemberCompanyIds(ids);
    setMemberIdsState(next);
    void api.setMembers(next).catch(error => console.warn('Uye listesi sunucuya yazilamadi', error));
    notifyMemberCompaniesChanged();
    return next;
  }, []);

  const addMember = useCallback((id: number) => {
    setMemberIds([...readMemberCompanyIds(), id]);
  }, [setMemberIds]);

  const removeMember = useCallback((id: number) => {
    setMemberIds(readMemberCompanyIds().filter(memberId => memberId !== id));
  }, [setMemberIds]);

  const toggleMember = useCallback((id: number) => {
    const current = readMemberCompanyIds();
    setMemberIds(current.includes(id) ? current.filter(memberId => memberId !== id) : [...current, id]);
  }, [setMemberIds]);

  const seedDefaultMembers = useCallback(() => {
    const suggested = suggestDefaultMemberIds(companies);
    setMemberIds([...readMemberCompanyIds(), ...suggested]);
    return suggested.length;
  }, [companies, setMemberIds]);

  return {
    memberIds,
    members,
    addMember,
    removeMember,
    toggleMember,
    setMemberIds,
    seedDefaultMembers,
  };
}
