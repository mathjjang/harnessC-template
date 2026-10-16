#!/usr/bin/env node
// UserPromptSubmit 훅 — Remote Control(휴대폰·웹) 연결 중이면 "모바일 모드" 답변 규칙을 주입한다.
// 신호: Claude Code가 Remote Control 연결 중에만 설정하는 CLAUDE_CODE_BRIDGE_SESSION_ID.
// 한계: 프롬프트 단위 출처(휴대폰 vs 터미널)는 훅 입력에 없다 — 연결 중이면 전부 모바일 모드다.
// 예외: 프롬프트가 상세·전체·파일 작성을 명시하면 규칙을 주입하지 않는다.
// 자기 검사: node mobile-mode.mjs --self-test
import { readFileSync } from 'node:fs';

const RULES = [
  '[모바일 모드 — 휴대폰(Remote Control)에서 읽고 있다]',
  '답변 형식: 결론 1문장 → 핵심 최대 3문장 → 다음 행동 또는 선택지 1문장. 전체 150자 안팎.',
  '표·코드블록·링크·파일 경로·괄호 설명을 쓰지 않는다. 숫자는 셋 이하만.',
  '긴 내용은 파일에 저장하고 "문서에 적었다"고만 말한다. 세부는 묻기 전에는 내지 않는다.',
  '결정이 필요하면 자유 입력 대신 AskUserQuestion 선택지로 묻는다(탭으로 답할 수 있게).',
  '긴 작업은 백그라운드로 돌리고 끝나면 한 문장으로 보고한다.',
  '사용자가 "자세히"·"전체"·"풀어서"라고 하면 그때 평소 형식으로 답한다.',
].join('\n');

const DETAIL_RE = /(자세히|상세히|전체|전부|풀어서|길게|파일로|문서로|md로|정리해\s*줘|작성해\s*줘|만들어\s*줘)/;

function decide(env, prompt) {
  if (!env.CLAUDE_CODE_BRIDGE_SESSION_ID) return null;           // 터미널 단독 세션 — 개입 없음
  if (DETAIL_RE.test(prompt || '')) return null;                  // 상세 요청 — 평소 형식
  return {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: RULES },
  };
}

if (process.argv.includes('--self-test')) {
  const cases = [
    [{}, '서버 상태 봐줘', false],
    [{ CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' }, '서버 상태 봐줘', true],
    [{ CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' }, '자세히 설명해줘', false],
    [{ CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' }, '검토 문서로 정리해줘', false],
  ];
  let fail = 0;
  for (const [env, prompt, expect] of cases) {
    const got = decide(env, prompt) !== null;
    if (got !== expect) { fail++; console.error(`FAIL env=${JSON.stringify(env)} prompt="${prompt}" expect=${expect} got=${got}`); }
  }
  console.log(fail ? `self-test FAIL (${fail})` : 'self-test OK (4 cases)');
  process.exit(fail ? 1 : 0);
}

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* stdin 없음 */ }
let prompt = '';
try { prompt = JSON.parse(raw || '{}').prompt || ''; } catch { /* 비JSON — 무시 */ }
const out = decide(process.env, prompt);
if (out) process.stdout.write(JSON.stringify(out));
process.exit(0);
