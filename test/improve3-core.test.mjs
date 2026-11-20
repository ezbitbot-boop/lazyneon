import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runtimeContext, staticPrefix} from '../scripts/session_start.mjs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
// These are instruction-contract checks, not claims of measured model behavior.
test('improve3 dynamic session clock stays outside the stable prefix', () => {
 const before = Date.now();
 const context = runtimeContext({cwd:process.cwd()});
 const stamp = context.match(/세션 시작 시각\(UTC\): (\S+)\. 시간 민감/);
 assert.ok(stamp, 'runtime must supply a current UTC timestamp');
 assert.ok(Date.parse(stamp[1]) >= before && Date.parse(stamp[1]) <= Date.now());
 assert.doesNotMatch(staticPrefix(), /세션 시작 시각\(UTC\):/);
 assert.match(context, /증거 발생 시각이나 모델 지식 기준일이 아니다/);
});
test('improve3 prompt input contract preserves evidence and missing answers', () => {
 const s = read('skills/ulw/references/prompt-design.md');
 for (const term of ['자료 뒤에는', '제공 자료에서 확인하지 못함', '정상·결측·상충', '예시 수는 평가로', 'temperature, top_p, top_k', '정적 문자열 테스트만으로 개선을 주장하지 않는다']) assert.ok(s.includes(term), term);
 assert.match(read('skills/ulw/SKILL.md'), /references\/prompt-design.md/);
});
test('improve3 retry policy distinguishes transient failure from refusal', () => {
 const s = read('skills/ulw/SKILL.md');
 assert.match(s, /일시적 통신·서비스 오류만/);
 assert.match(s, /안전 필터·권한 거부는 재시도하지 않는다/);
 assert.doesNotMatch(s, /레인은 같은 프롬프트로/);
 assert.match(read('rules/AGENTS.md'), /오류 유형별 규칙/);
});
test('improve3 report length preserves requested final deliverables', () => {
 for (const file of ['rules/AGENTS.md', 'skills/ulw/SKILL.md']) {
  const s = read(file);
  assert.doesNotMatch(s, /보고는 20줄 이내|요약 10줄 상한|report summary ≤10 lines/);
  assert.match(s, /최종 산출물/);
 }
});
test('improve3 grounding uses source language and question date', () => {
 const s = read('skills/ulw-research/references/search-craft.md');
 assert.equal(s.split('## 공통 근거 탐색').length, 2);
 for (const term of ['한국어 공식 명칭', '과거 시점 질문', '부존재 증명이 아니다', '외부 전송 권한']) assert.ok(s.includes(term), term);
 assert.doesNotMatch(s, /English first/);
});
test('improve3 research respects budget and records hypothesis uncertainty', () => {
 const s = read('skills/ulw-research/SKILL.md');
 assert.doesNotMatch(s, /supersedes every|only stop rules|not by budget|into an `<analysis>` block/);
 assert.match(s, /승인된 예산/);
 assert.match(s, /내부 사고 과정의 공개를 요구하지 않는다/);
 assert.match(read('skills/ulw-research/references/epistemic-instrumentation.md'), /신뢰 수준은 측정 확률이 아니며/);
});
test('improve3 non-reproduction does not reject competing hypotheses', () => {
 const s = read('skills/ulw/references/hypothesis-tree.md');
 assert.doesNotMatch(s, /즉시 폐기|유일하게 살아남은 가설|1턴 만에|상호 배타적.*가설 3가지/);
 assert.match(s, /미재현은 반증이 아니다/);
 assert.match(s, /복합 원인 가능성/);
});
test('improve3 recovery examples preserve unrelated edits', () => {
 const s = read('skills/ulw/references/self-audit.md');
 const commands = [...s.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).join('\n');
 assert.doesNotMatch(commands, /git (restore|reset|checkout)/);
 assert.match(s, /다른 사용자·프로세스의 변경/);
});
test('improve3 ambiguous image evidence can be reread', () => {
 const s = read('rules/AGENTS.md');
 assert.doesNotMatch(s, /read each image once/);
 assert.match(s, /crop\/확대/);
});
test('improve3 readability outranks one-line code', () => {
 assert.match(read('skills/programming/SKILL.md'), /줄 수보다 사람이 읽을 수 있는 이름/);
});
