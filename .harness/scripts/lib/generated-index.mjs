// generated-index.mjs — 생성 인덱스의 자리와 추적 여부 (build-index · lint ⑳ · work.mjs가 공유한다 — REP local-generated-index).
// LOCAL: 기록·큐가 늘 때마다 바뀌어 동시 브랜치가 같은 줄을 고친다 — git에서 빼고(.gitignore) 로컬에서만 만든다(세션 시작 카드·build-index).
// TRACKED: 스펙이 바뀔 때만 바뀐다 — 커밋하고 pre-commit·CI가 신선도(build-index --check)를 본다.
import { execSync } from 'node:child_process';

export const LOCAL_INDEXES = ['docs/INDEX.generated.md', 'docs/queue/INDEX.generated.md'];
export const TRACKED_INDEXES = ['docs/specs/index.md'];

/** 로컬 인덱스가 git에 추적되거나 .gitignore에 없으면 문제 목록(옮기는 명령 포함). git 밖이면 [] */
export function localIndexProblems(root) {
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { git('rev-parse --show-toplevel'); } catch { return []; }
  const out = [];
  for (const rel of LOCAL_INDEXES) {
    let ignored = true; try { git(`check-ignore -q --no-index -- "${rel}"`); } catch { ignored = false; }
    let tracked = false; try { tracked = !!git(`ls-files -- "${rel}"`).trim(); } catch { /* */ }
    if (tracked) out.push(`로컬 생성 인덱스 ${rel}가 git에 추적되고 있다 — 병합마다 충돌한다. git rm --cached -- ${rel} 후 커밋(파일은 남는다)`);
    if (!ignored) out.push(`로컬 생성 인덱스 ${rel}가 .gitignore에 없다 — .gitignore에 "${rel}" 한 줄을 넣는다`);
  }
  return out;
}
