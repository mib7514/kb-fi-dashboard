// rv-matcher.js — 발행사 raw → canonical 매칭. Fenrir src/lib/parsers/issuer-matcher.js 이식(로직 동일).
//   fuzzy 금지. aliases 배열에 있는 그대로만 매칭. 8단계.
//   bpbybp 호출부에서 matchIssuer(raw, aliases, KBOND_ABBREVIATIONS) 3인자로 abbreviation 단계 활성.

function stripKorea(s) { return s.startsWith('한국') ? s.slice(2) : s; }
function stripSpecial(s) { return s.replace(/[\s()（）·\-_.]/g, ''); }

/**
 * @param {string} rawString
 * @param {Array<{canonical:string, aliases:string[]}>} aliases
 * @param {Object.<string,string>} [abbreviations={}]
 * @returns {{canonical:string, match_type:string, matched_alias:string}|null}
 */
export function matchIssuer(rawString, aliases, abbreviations = {}) {
  if (!rawString || !aliases || aliases.length === 0) return null;

  // 1. exact
  for (const entry of aliases) {
    for (const alias of entry.aliases) {
      if (rawString === alias) return { canonical: entry.canonical, match_type: 'exact', matched_alias: alias };
    }
  }
  // 2. prefix — canonical이 raw의 접두 (≥2)
  for (const entry of aliases) {
    if (entry.canonical.length >= 2 && rawString.startsWith(entry.canonical) && rawString !== entry.canonical) {
      return { canonical: entry.canonical, match_type: 'prefix', matched_alias: entry.canonical };
    }
  }
  // 3. alias_prefix
  for (const entry of aliases) {
    for (const alias of entry.aliases) {
      if (alias.length >= 2 && rawString.startsWith(alias) && rawString !== alias) {
        return { canonical: entry.canonical, match_type: 'alias_prefix', matched_alias: alias };
      }
    }
  }
  // 4. reverse_prefix — raw(≥3)가 canonical/alias의 접두
  if (rawString.length >= 3) {
    for (const entry of aliases) {
      if (entry.canonical.startsWith(rawString) && entry.canonical !== rawString) {
        return { canonical: entry.canonical, match_type: 'reverse_prefix', matched_alias: entry.canonical };
      }
      for (const alias of entry.aliases) {
        if (alias.startsWith(rawString) && alias !== rawString) {
          return { canonical: entry.canonical, match_type: 'reverse_prefix', matched_alias: alias };
        }
      }
    }
  }
  // 5. korea_normalized — '한국' 제거 후 완전일치
  {
    const normRaw = stripKorea(rawString);
    if (normRaw.length >= 2) {
      for (const entry of aliases) {
        const targets = [entry.canonical, ...entry.aliases];
        for (const t of targets) {
          const normT = stripKorea(t);
          if (normT.length < 2) continue;
          if (normRaw === normT) return { canonical: entry.canonical, match_type: 'korea_normalized', matched_alias: t };
        }
      }
    }
  }
  // 6. normalized — 공백/괄호/특수문자 제거 후 완전일치(≥3)
  {
    const normRaw = stripSpecial(rawString);
    if (normRaw.length >= 3) {
      for (const entry of aliases) {
        for (const alias of entry.aliases) {
          if (normRaw === stripSpecial(alias)) return { canonical: entry.canonical, match_type: 'normalized', matched_alias: alias };
        }
        if (normRaw === stripSpecial(entry.canonical)) return { canonical: entry.canonical, match_type: 'normalized', matched_alias: entry.canonical };
      }
    }
  }
  // 7. contains — canonical(≥3)이 raw에 포함
  for (const entry of aliases) {
    if (entry.canonical.length >= 3 && rawString.includes(entry.canonical) && rawString !== entry.canonical) {
      return { canonical: entry.canonical, match_type: 'contains', matched_alias: entry.canonical };
    }
  }
  // 8. abbreviation — 축약어 사전 완전일치 AND canonical이 aliases에 존재
  if (abbreviations && rawString in abbreviations) {
    const canonical = abbreviations[rawString];
    for (const entry of aliases) {
      if (entry.canonical === canonical) return { canonical: entry.canonical, match_type: 'abbreviation', matched_alias: rawString };
    }
  }
  return null;
}
