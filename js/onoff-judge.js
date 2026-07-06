// onoff-judge.js — 이벤트 레이어 + 결정론적 룰 판정 엔진. 순수 함수, DOM·파일 I/O 없음.
// 입력은 파생 세대(series:[[date,raw,slope,fly]])와 입찰일 배열(data/onoff-events.js).
// 판정·코멘터리는 '참고 신호'다 — 자동 매매신호·bp 환산 없음. 임계값은 아래 TH 에 집약한다.
//
// [방법론] fly<0 지표물 리치(정상), fly>0 저평가(이례). '확대' = fly 상승(Δ>0).
//   분기·반기말/입찰은 수급·컨세션으로 일시 확대 후 되돌림되는 패턴을, 유동성 리프라이싱은
//   이벤트 무관 지속 확대(되돌림 부재)를 잡는다. 근거(충족 조건)를 배지 옆에 상시 노출한다.

// ── 임계값 (파일 상단 집약) ──
export const TH = {
  concessionPre: 4,          // 입찰 컨세션 관측창 D−4~D0
  concessionWiden: 2.0,      // 확대 임계(bp)
  concessionGivebackDays: 3, // D+3 내
  concessionGiveback: 0.5,   // 50% 반납 → "소멸"
  periodPre: 7,              // 분기·반기말 관측창 D−7~D0
  periodWiden: 2.0,          // 확대 임계(bp)
  periodRevertDays: 3,       // 익월 3영업일 내
  periodRevert: 0.5,         // 50% 되돌림
  liquidityDays: 10,         // 유동성 리프라이싱: 10영업일 지속 확대
  liquidityWiden: 3.0,       // 확대 임계(bp)
  liquidityRevertMax: 0.5,   // 되돌림 부재 판정(되돌림 비율 < 0.5)
  zOutlier: 1.5,             // 세대간 z 아웃라이어 플래그(별도 병기)
  recentDays: 7,             // 헤드라인 최근성 게이트: 현재로부터 ±7영업일 내 발화만 headline
  upcomingDays: 5,           // 미래 입찰: 최종 관측일 이후 5영업일 내면 사전 윈도우 평가
};

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const pctStr = r => (r == null ? '—' : Math.round(r * 100) + '%');

// ── 이벤트 캘린더 (자동 계산) ──
// 분기말(3/6/9/12 말)·반기말(6/12 말). 관측 없는 주말·공휴일 → 해당 분기 마지막 관측일을 앵커로.
export function periodEnds(dates) {
  if (!dates.length) return [];
  const first = dates[0], last = dates[dates.length - 1];
  const y0 = +first.slice(0, 4), y1 = +last.slice(0, 4);
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (const md of ['03-31', '06-30', '09-30', '12-31']) {
      const cal = `${y}-${md}`;
      if (cal < first || cal > last) continue;         // 데이터 기간 밖 / 진행중 분기 제외
      let idx = -1;
      for (let i = 0; i < dates.length; i++) { if (dates[i] <= cal) idx = i; else break; }
      if (idx < 0) continue;
      out.push({ kind: (md === '06-30' || md === '12-31') ? '반기말' : '분기말', calendar: cal, date: dates[idx], day: idx });
    }
  }
  return out;
}

// 입찰일 → 해당일(또는 직전) 관측 앵커
export function auctionEvents(dates, auctions) {
  if (!dates.length) return [];
  const first = dates[0], last = dates[dates.length - 1];
  const out = [];
  for (const a of (auctions || [])) {
    if (a < first || a > last) continue;
    let idx = -1;
    for (let i = 0; i < dates.length; i++) { if (dates[i] <= a) idx = i; else break; }
    if (idx < 0) continue;
    out.push({ kind: '입찰', calendar: a, date: dates[idx], day: idx });
  }
  return out;
}

// 세대 전체 이벤트(분기·반기말 + 입찰), day 오름차순
export function allEvents(gen, auctions) {
  const dates = gen.series.map(r => r[0]);
  return [...periodEnds(dates), ...auctionEvents(dates, auctions)].sort((a, b) => a.day - b.day);
}

// 최종 관측일 이후 upcomingDays 영업일 내 입찰(미래 입찰) → 사전 컨세션 부분 평가 대상
export function futureAuctions(dates, auctions) {
  if (!dates.length) return [];
  const last = dates[dates.length - 1];
  const out = [];
  for (const a of (auctions || [])) {
    if (a <= last) continue;
    let n = 0, d = new Date(last + 'T00:00:00Z'); const end = new Date(a + 'T00:00:00Z');
    while (d < end) { d = new Date(d.getTime() + 86400000); const g = d.getUTCDay(); if (g !== 0 && g !== 6) n++; }
    if (n <= TH.upcomingDays) out.push({ calendar: a, bdaysAhead: n });
  }
  return out;
}

// 관측창 [evDay−pre .. evDay] 확대 + [evDay+1 .. evDay+revertDays] 되돌림 계산
function windowStats(fly, evDay, pre, revertDays) {
  const start = Math.max(0, evDay - pre);
  const baseline = fly[start];
  let peak = -Infinity, peakDay = start;
  for (let d = start; d <= evDay; d++) if (fly[d] > peak) { peak = fly[d]; peakDay = d; }
  const widen = round1(peak - baseline);
  const rEnd = Math.min(fly.length - 1, evDay + revertDays);
  let postMin = Infinity;
  for (let d = evDay + 1; d <= rEnd; d++) if (fly[d] < postMin) postMin = fly[d];
  const hasPost = postMin !== Infinity;
  const span = peak - baseline;
  const giveback = (hasPost && span > 0) ? (peak - postMin) / span : null;
  return { start, baseline: round1(baseline), peak: round1(peak), peakDay, widen, postMin: hasPost ? round1(postMin) : null, giveback };
}

// ── 판정 엔진 (에피소드 모델) ──
// 세대 전 구간의 이벤트를 평가해 episodes[] 를 만든다. 헤드라인 verdict 는 최근성 게이트
// (현재±recentDays) 내 발화 에피소드로 결정(복수 발화 → 혼합/관찰). 게이트 밖 발화는 past(이력),
// 미래 입찰은 upcoming(사전 윈도우, 발화/비발화 모두 표기). z 아웃라이어는 flags 로 별도 병기.
//
// gen: 파생 세대, auctions: 입찰일 배열, zInfo: generationZ(현재 day, 해당 세대) 결과
// 반환: { verdict:{label,type}, episodes, headline, past, upcoming, flags, events, now, z }
export function judge(gen, auctions, zInfo) {
  const fly = gen.series.map(r => r[3]);
  const dates = gen.series.map(r => r[0]);
  const now = fly.length - 1;
  const events = allEvents(gen, auctions); // 분기·반기말 + 세대 기간 내 입찰 (차트 오버레이 공용)
  const isRecent = day => (now - day) <= TH.recentDays;
  const episodes = [];

  for (const ev of events) {
    if (ev.kind === '입찰') {
      const w = windowStats(fly, ev.day, TH.concessionPre, TH.concessionGivebackDays);
      if (w.widen < TH.concessionWiden) continue; // 비발화 일반 입찰은 생략(노이즈)
      const evidence = [`입찰 ${ev.calendar}(day${ev.day}): D−${TH.concessionPre}~D0 fly +${w.widen}bp 확대 (${w.baseline}→${w.peak})`];
      let label = '입찰 컨세션', status;
      if (w.giveback != null && w.giveback >= TH.concessionGiveback) { evidence.push(`D+${TH.concessionGivebackDays} 내 ${pctStr(w.giveback)} 반납(≥${pctStr(TH.concessionGiveback)}) → 소멸`); label += ' (소멸)'; status = '소멸'; }
      else if (w.giveback != null) { evidence.push(`D+${TH.concessionGivebackDays} 내 ${pctStr(w.giveback)} 반납(<${pctStr(TH.concessionGiveback)}) → 잔존`); label += ' (잔존)'; status = '잔존'; }
      else { evidence.push(`D+${TH.concessionGivebackDays} 관측 부족 → 반납 판정 보류`); label += ' (관찰)'; status = '보류'; }
      episodes.push({ type: 'concession', kind: ev.kind, event: ev, fired: true, widen: w.widen, revert: { giveback: w.giveback, status }, recent: isRecent(ev.day), label, evidence });
    } else {
      const w = windowStats(fly, ev.day, TH.periodPre, TH.periodRevertDays);
      if (w.widen < TH.periodWiden) continue;
      const evidence = [`${ev.kind} ${ev.calendar}(day${ev.day}): D−${TH.periodPre} 대비 fly +${w.widen}bp 확대 (${w.baseline}→${w.peak})`];
      let label = '분기·반기말 수급', status;
      if (w.giveback != null && w.giveback >= TH.periodRevert) { evidence.push(`익월 ${TH.periodRevertDays}영업일 내 ${pctStr(w.giveback)} 되돌림(≥${pctStr(TH.periodRevert)}) → 되돌림 완료`); label += ' (되돌림 완료)'; status = '되돌림 완료'; }
      else if (w.giveback != null) { evidence.push(`되돌림 ${pctStr(w.giveback)} (<${pctStr(TH.periodRevert)}) → 진행중/미완`); label += ' (되돌림 미완)'; status = '되돌림 미완'; }
      else { evidence.push('익월 관측 부족 → 되돌림 판정 보류'); label += ' (관찰)'; status = '보류'; }
      episodes.push({ type: 'period', kind: ev.kind, event: ev, fired: true, widen: w.widen, revert: { giveback: w.giveback, status }, recent: isRecent(ev.day), label, evidence });
    }
  }

  // 유동성 리프라이싱: 최근 liquidityDays 창에 이벤트 없음 & 지속 확대 & 되돌림 부재
  if (now - TH.liquidityDays >= 0) {
    const start = now - TH.liquidityDays;
    const hasEvent = events.some(e => e.day > start && e.day <= now);
    let peak = -Infinity; for (let d = start; d <= now; d++) peak = Math.max(peak, fly[d]);
    const baseline = fly[start];
    const widen = round1(fly[now] - baseline);
    const span = peak - baseline;
    const revertFrac = span > 0 ? (peak - fly[now]) / span : null;
    if (!hasEvent && widen >= TH.liquidityWiden && (revertFrac == null || revertFrac < TH.liquidityRevertMax)) {
      episodes.push({
        type: 'liquidity', kind: '유동성', event: null, fired: true, widen, revert: { giveback: revertFrac, status: '되돌림 부재' }, recent: true, label: '유동성 리프라이싱',
        evidence: [`이벤트 무관 ${TH.liquidityDays}영업일 fly +${widen}bp 지속 확대 (${round1(baseline)}→${round1(fly[now])}) · 되돌림 ${pctStr(revertFrac)}(<${pctStr(TH.liquidityRevertMax)}) 부재`],
      });
    }
  }

  // 미래 입찰(C): 최종 관측일 앵커로 부분 윈도우 D−4~현재 평가 — 발화/비발화 모두 기록
  const upcoming = [];
  for (const fa of futureAuctions(dates, auctions)) {
    const start = Math.max(0, now - TH.concessionPre + 1); // 마지막 concessionPre 관측
    let peak = -Infinity; for (let d = start; d <= now; d++) peak = Math.max(peak, fly[d]);
    const baseline = round1(fly[start]);
    const widen = round1(peak - fly[start]);
    const net = round1(fly[now] - fly[start]);
    const win = `${dates[start]}~${dates[now]}`;
    const fired = widen >= TH.concessionWiden;
    const ep = fired
      ? { type: 'preAuction', kind: '입찰(예정)', event: { kind: '입찰(예정)', calendar: fa.calendar, day: now }, fired: true, widen, revert: { giveback: null, status: '진행 중' }, recent: true, label: '사전 컨세션 (진행 중)',
          evidence: [`다가오는 입찰 ${fa.calendar}(D−${fa.bdaysAhead}): D−${TH.concessionPre}~현재(${win}) fly +${widen}bp 확대 (${baseline}→${round1(fly[now])}) → 사전 컨세션 진행 중`] }
      : { type: 'preAuction', kind: '입찰(예정)', event: { kind: '입찰(예정)', calendar: fa.calendar, day: now }, fired: false, widen, revert: null, recent: true, label: '다가오는 입찰: 사전 확대 없음',
          evidence: [`다가오는 입찰 ${fa.calendar}(D−${fa.bdaysAhead}): D−${TH.concessionPre}~현재(${win}) fly ${net > 0 ? '+' : ''}${net}bp (${baseline}→${round1(fly[now])}) → 사전 확대 없음 (+${widen}bp < ${TH.concessionWiden}) → 컨세션 배제`] };
    episodes.push(ep);
    upcoming.push(ep);
  }

  // 분류: headline(발화&게이트내) / past(발화&게이트밖) / upcoming(미래입찰)
  const firedRecent = episodes.filter(e => e.fired && e.recent);
  const past = episodes.filter(e => e.fired && !e.recent);

  let verdict;
  if (firedRecent.length === 0) verdict = { label: '관찰 (뚜렷한 패턴 없음)', type: 'none' };
  else if (firedRecent.length === 1) verdict = { label: firedRecent[0].label, type: firedRecent[0].type };
  else verdict = { label: '혼합/관찰', type: 'mixed' };

  // 아웃라이어 플래그(별도 병기 — verdict 계수에 불포함)
  const flags = [];
  if (zInfo && zInfo.z != null && zInfo.z >= TH.zOutlier) {
    flags.push({ type: 'outlier', label: `아웃라이어 (세대간 z ${zInfo.z}≥+${TH.zOutlier})`, evidence: [`현재 fly ${fly[now]}bp, 과거 세대 대비 z=${zInfo.z} (n=${zInfo.n})`] });
  }

  return { verdict, episodes, headline: firedRecent, past, upcoming, flags, events, now, z: zInfo ? zInfo.z : null };
}

// ── 코멘터리 스냅샷 (JSON 복사용) ──
// { 현재 fly/z/분해, 최근 20영업일 fly 경로, 헤드라인 verdict+evidence, 지난/다가오는 에피소드, 이벤트 ±10영업일 }
export function buildSnapshot(gen, judgeResult, zInfo) {
  const s = gen.series;
  const now = s.length - 1;
  const last = s[now];
  const fly20 = s.slice(Math.max(0, now - 19)).map(r => ({ date: r[0], fly: r[3] }));
  const events10 = judgeResult.events
    .filter(e => Math.abs(e.day - now) <= 10)
    .map(e => ({ kind: e.kind, date: e.date, day: e.day }));
  const epOut = e => ({ label: e.label, type: e.type, day: e.event ? e.event.day : null, widen: e.widen, revert: e.revert ? e.revert.status : null, conditions: e.evidence });
  return {
    tag: gen.tag, asof: last[0],
    fly: last[3], raw: last[1], slope: last[2],
    z: zInfo ? zInfo.z : null, zN: zInfo ? zInfo.n : null,
    verdict: judgeResult.verdict.label,
    evidence: judgeResult.headline.map(epOut),
    flags: (judgeResult.flags || []).map(f => ({ label: f.label, conditions: f.evidence })),
    upcoming: judgeResult.upcoming.map(epOut),
    past: judgeResult.past.map(epOut),
    fly20, events10,
  };
}
