#!/usr/bin/env python3
"""Portal'in canli sirket dizininden (backend/data/companies.json +
company-aliases.json) rating-service'in companies.yaml'ini yeniden uretir.

Onceki durum: companies.yaml elle yazilmis 8 sirketlik bir listeydi ve hem
isim eslestirme (alias_map) icin hem de global ajanslarda (Fitch/S&P/Moody's,
kaldirildi -- bkz. CLAUDE.md) hangi sirketlerin aranacagini belirlemek icin
kullaniliyordu. Global ajanslar kaldirildigi icin bu dosyanin tek islevi artik
TurkRating/JCR/SAHA/KobiRate'in kendi listeledigi sirket isimlerini KAP
adlarina eslestiren alias tablosu.

Bu script bunun yerine portal'in 1500+ sirketlik canli dizinini kullanir.
Var olan elle eklenmis kayitlar (KAP uyesi olmayan ama rating alan sirketler
gibi) korunur; portal kaydi bunlardan biriyle (canonical isim ya da mevcut
alias) CAKISIRSA ayri satir acmak yerine ayni kayda alias olarak eklenir --
normalizer.py'deki company_match_key() ile ayni fonksiyon kullanilir, aksi
halde runtime'da iki kayit ayni anahtara dusup biri digerini sessizce ezer.

Kullanim: python sync_companies.py [--dry-run]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

from app.normalizer import company_match_key

HERE = Path(__file__).parent
PORTAL_COMPANIES_PATH = HERE / ".." / "backend" / "data" / "companies.json"
PORTAL_ALIASES_PATH = HERE / ".." / "backend" / "data" / "company-aliases.json"
TARGET_PATH = HERE / "data" / "config" / "companies.yaml"


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_existing_companies(target: Path) -> list[dict]:
    if not target.exists():
        return []
    with target.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle) or {}
    return list(payload.get("companies", []) or [])


def main() -> None:
    dry_run = "--dry-run" in sys.argv

    portal_companies = load_json(PORTAL_COMPANIES_PATH, [])
    if not portal_companies:
        print(f"HATA: {PORTAL_COMPANIES_PATH} bulunamadı ya da boş.")
        sys.exit(1)
    portal_aliases = load_json(PORTAL_ALIASES_PATH, [])

    # oid -> gecmis isimler (portal tarafinda tespit edilen yeniden adlandirmalar)
    history_by_oid: dict[str, list[str]] = {
        str(entry["oid"]): list(entry.get("previousNames") or []) for entry in portal_aliases
    }

    old_companies = load_existing_companies(TARGET_PATH)

    # canonical_key -> {"name", "aliases"} ve alias_key -> canonical_key
    # (ayni normalizasyon fonksiyonu runtime eslestirmede de kullaniliyor;
    # farkli bir normalize kullanirsak burada gormedigimiz bir cakisma
    # normalizer.py'de sessizce birini digerinin ustune yazabilir).
    hand_by_key: dict[str, dict] = {}
    alias_key_to_canonical_key: dict[str, str] = {}
    for c in old_companies:
        name = c.get("name")
        if not name:
            continue
        ckey = company_match_key(name)
        hand_by_key[ckey] = {"name": name, "aliases": list(c.get("aliases") or [])}
        for alias in c.get("aliases") or []:
            akey = company_match_key(alias)
            if akey and akey != ckey:
                alias_key_to_canonical_key[akey] = ckey

    result: dict[str, dict] = {}
    claimed: set[str] = set()
    history_applied = 0
    merged_into_hand = 0

    for company in portal_companies:
        oid = str(company["oid"])
        name = company["name"]
        key = company_match_key(name)
        old_names = history_by_oid.get(oid, [])
        if old_names:
            history_applied += 1

        if key in hand_by_key:
            # Portal artik bu sirketi resmi olarak listeliyor (canonical isim ayni).
            claimed.add(key)
            aliases = list(hand_by_key[key]["aliases"])
            for old_name in old_names:
                if old_name not in aliases and old_name != name:
                    aliases.append(old_name)
            entry: dict = {"name": name}
            if aliases:
                entry["aliases"] = aliases
            result[key] = entry
        elif key in alias_key_to_canonical_key:
            # Portal kaydi, elle girilmis BASKA bir sirketin alias'iyla cakisiyor ->
            # ayni gercek sirket, ayri satir acmak yerine mevcut kayda alias olarak ekle.
            canonical_key = alias_key_to_canonical_key[key]
            claimed.add(canonical_key)
            merged_into_hand += 1
            hand_entry = hand_by_key[canonical_key]
            entry = result.setdefault(canonical_key, {"name": hand_entry["name"], "aliases": list(hand_entry["aliases"])})
            aliases = entry.setdefault("aliases", [])
            if name not in aliases and name != entry["name"]:
                aliases.append(name)
            for old_name in old_names:
                if old_name not in aliases and old_name != entry["name"]:
                    aliases.append(old_name)
        else:
            aliases = list(old_names)
            entry = {"name": name}
            if aliases:
                entry["aliases"] = aliases
            result[key] = entry

    # Portalda hic karsiligi olmayan (ne canonical ne alias olarak eslesen) elle
    # girilmis kayitlar (orn. KAP uyesi olmayan varlik yonetim sirketleri) aynen korunur.
    unmatched_keys = set(hand_by_key) - claimed
    for ckey in unmatched_keys:
        hand_entry = hand_by_key[ckey]
        entry = {"name": hand_entry["name"]}
        if hand_entry["aliases"]:
            entry["aliases"] = hand_entry["aliases"]
        result[ckey] = entry

    companies = sorted(result.values(), key=lambda item: item["name"])

    print(f"Portal şirket sayısı         : {len(portal_companies)}")
    print(f"Eski companies.yaml          : {len(old_companies)} şirket")
    print(f"Yeni companies.yaml          : {len(companies)} şirket")
    print(f"KAP isim geçmişi taşınan     : {history_applied} şirket")
    print(f"Alias çakışması birleştirilen: {merged_into_hand} şirket (ayrı satır açılmadı, mevcut kayda eklendi)")
    print(f"Portalda karşılığı olmayan   : {len(unmatched_keys)} şirket (aynen korundu: {', '.join(hand_by_key[k]['name'] for k in unmatched_keys) if unmatched_keys else '-'})")

    if dry_run:
        print("\n--dry-run: dosya değiştirilmedi.")
        return

    TARGET_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TARGET_PATH.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(
            {"companies": companies},
            handle,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )

    print(f"\n{TARGET_PATH} güncellendi ({len(companies)} şirket).")


if __name__ == "__main__":
    main()
