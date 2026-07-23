// GC JP 파싱 앵커 테스트 — node --test. 연호(和暦) 경계 변환 + jgbcm CSV 파싱.
//   명령서 GC-1b 필수 게이트: S63/S64↔H1, H31↔R1(2019-04-30/05-01), R8 경계 단위 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEraDate, parseJgbCsv } from '../scripts/gc/gc-jp.mjs';

// ── 연호 경계: Showa/Heisei/Reiwa 전환 ──
test('昭和(S): 1925+N — S49=1974, S63=1988', () => {
  assert.equal(parseEraDate('S49.9.24'), '1974-09-24');
  assert.equal(parseEraDate('S63.12.30'), '1988-12-30');
});

test('S64↔H1 경계 (1989년 1월): S64.1.6=1989-01-06, H1.1.9=1989-01-09', () => {
  assert.equal(parseEraDate('S64.1.6'), '1989-01-06'); // 昭和 마지막(~1.7)
  assert.equal(parseEraDate('H1.1.9'), '1989-01-09');  // 平成 시작(1.8~)
});

test('H31↔R1 경계 (2019년): H31.4.30=2019-04-30, R1.5.1=2019-05-01', () => {
  assert.equal(parseEraDate('H31.4.30'), '2019-04-30'); // 平成 마지막
  assert.equal(parseEraDate('R1.5.1'), '2019-05-01');   // 令和 시작
});

test('令和(R): 2018+N — R1=2019, R8=2026', () => {
  assert.equal(parseEraDate('R1.5.10'), '2019-05-10');
  assert.equal(parseEraDate('R8.6.30'), '2026-06-30');
});

test('비연호·형식오류 → null (제목/주석/서기표기/빈값)', () => {
  assert.equal(parseEraDate('2019/4/30'), null);
  assert.equal(parseEraDate('国債金利情報'), null);
  assert.equal(parseEraDate('※最新のcsv'), null);
  assert.equal(parseEraDate(''), null);
  assert.equal(parseEraDate(null), null);
  assert.equal(parseEraDate('X1.2.3'), null);
});

// ── CSV 파싱: 헤더 라벨 매칭 + 결측('-')·주석행 처리 ──
const SAMPLE = [
  '国債金利情報,,,,,,,,,,,,,,,(単位 : %)',
  '基準日,1年,2年,3年,4年,5年,6年,7年,8年,9年,10年,15年,20年,25年,30年,40年',
  'S49.9.24,10.327,9.362,8.83,8.515,8.348,8.29,8.24,8.121,8.127,-,-,-,-,-,-',
  'R1.5.10,-0.156,-0.158,-0.164,-0.169,-0.17,-0.166,-0.163,-0.135,-0.092,-0.044,0.169,0.37,0.458,0.535,0.588',
  'R8.6.30,1.165,1.382,1.531,1.755,1.937,2.075,2.231,2.398,2.55,2.63,2.9,3.1,3.2,3.35,3.5',
  '※最新のcsvデータが…,,,,,,,,,,,,,,,',
  '',
].join('\n');

test('parseJgbCsv — 3年/10年/30年 컬럼 라벨 매칭, 오름차순', () => {
  const rows = parseJgbCsv(SAMPLE);
  assert.equal(rows.length, 3); // 주석·빈줄 제외
  assert.deepEqual(rows[0], { d: '1974-09-24', y3: 8.83, y10: null, y30: null }); // 10Y/30Y 결측('-')
  assert.deepEqual(rows[1], { d: '2019-05-10', y3: -0.164, y10: -0.044, y30: 0.535 });
  assert.deepEqual(rows[2], { d: '2026-06-30', y3: 1.531, y10: 2.63, y30: 3.35 });
});

test('parseJgbCsv — 헤더 없으면 throw', () => {
  assert.throws(() => parseJgbCsv('a,b,c\n1,2,3'), /基準日/);
});
