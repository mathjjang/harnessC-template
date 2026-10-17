---
id: RB-work
trigger: 파일을 고치는 작업을 시작할 때(FDR 구현·RFC spike·PLAN 통합), 끝낼 때, spike를 FDR로 승격할 때, 여러 세션·여러 사람이 같은 소스를 건드릴 때
evidence: docs/records/<ID>/evidence/
pack: 코어
---

# 동시 작업 — 기록 하나 = 브랜치 하나 = worktree 하나

- 작성: Claude Code (claude-fable-5-1) · 2026-10-17 · 근거 `RFC-261017-concurrent-work` · 결정 `ADR-261017-work-isolation`

> V2가 석 달간 겪은 사고(남의 브랜치에 커밋·미커밋 문맥 전환·같은 파일 hunk 섞임·verify 인질)의 공통 원인은 **작업 트리 공유**였다. 하네스C는 처음부터 격리한다. 선언(`COMMIT_BRANCH`)도 중앙 점유 대장(`work-claims.json`)도 없다 — 브랜치 이름이 기록이고, 점유는 FDR 자신의 `scope:`다.

## 자리

```
<repo>/                 본 트리 — 항상 main. 에이전트는 읽기·병합만
<repo>/.worktrees/<ID>/ 기록별 worktree (gitignore · rg·VS Code·Claude Grep에 안 잡힘 · 셸 grep -r은 잡히니 rg를 쓴다)
브랜치 <type>/<ID>       fdr/FDR-… · rfc/RFC-… · plan/PLAN-… · ho/HO-… (이름은 ID에서 — 직접 만들지 않는다)
```

`harness.yaml work:` — `dir`(기본 `.worktrees`) · `base`(`main`) · `merge`(`ff` S티어 / `pr` M·L) · `link`(gitignore된 로컬 재료, 예 `.env.local`) · `setup`(worktree 생성 후 1회 명령, 예 `pnpm install`).

## 1. FDR 구현

```bash
node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"       # 기록 생성 → scope: [..] 채우고 커밋 (main에 문서 커밋은 허용)
node .harness/scripts/work.mjs start FDR-…                    # 브랜치 + .worktrees/FDR-…/
cd .worktrees/FDR-…  …작업·커밋(pathspec)…                     # 게이트: scope 밖 제품 경로 거부 · 다른 기록 수정 거부
node .harness/scripts/work.mjs finish FDR-…                   # (본 트리에서) lint → main 위 rebase → ff 병합 → worktree·브랜치 제거  / merge: pr 이면 push 후 PR 안내
```

- `scope:`가 비어 있으면 제품 경로 커밋이 거부된다 — 먼저 선언한다. 활성 FDR끼리 겹치면 lint ⑭가 알린다.
- 두 FDR이 같은 파일을 고쳐야 하면: **공유 변경을 작은 lite FDR로 먼저 main에 병합**하고 둘 다 `git rebase main`. "선점 후 대기"가 아니라 "공유분을 먼저 끝낸다".
- rebase 충돌은 그 worktree에서 풀고 다시 `finish`. 본 트리의 상태는 건드리지 않는다.
- dev 서버·E2E는 자기 worktree에서 자기 포트로(프로젝트 런북). 실기기·단일 DB 같은 직렬 자원은 `rules/human-only.yaml` 옆에 등록하고 사용 중 표시.

## 2. Spike (RFC)

```bash
node .harness/scripts/new-doc.mjs rfc <slug> "<질문>"         # 타임박스·질문 두 줄
node .harness/scripts/work.mjs start RFC-…                    # rfc/RFC-… — 제품 트리를 바로 고쳐 본다. ADR·FDR·AC·스펙 없음
…실험·커밋…  결론을 rfc.md §3에: 처분 = 삭제 | 증거 보존 | 승격
node .harness/scripts/work.mjs promote RFC-… <fdr-slug> "<제목>"   # (승격) FDR 생성 → main에서 fdr 브랜치 → spike를 squash 1커밋으로 재기반
node .harness/scripts/work.mjs finish RFC-…                   # 기록 폴더(rfc.md·evidence)만 main에 반입. spike 코드는 병합되지 않는다
```

- `rfc/*`는 main에 병합되지 않는다 — spike 코드는 결론의 증거이지 제품이 아니다. 이것이 "spike를 ADR/FDR로 머지할 때 생기던 문제"(이전 프로젝트: 3,200줄 수작업 반입)를 없애는 선이다.
- 승격 FDR은 보통 FDR이다 — 스펙 델타·테스트가 붙어야 병합된다. spike에서 돌린 실측은 FDR 브랜치에서 **다시 돌려** `evidence/runs/`에 둘 때만 RUN이다. AC 출처가 Concluded RFC이고 risk low면 `gate_mode: fast`.
- 트리와 무관한 벤치·프로토콜 실측은 `docs/records/RFC-…/evidence/spike/`에(기록과 같이 다닌다).
- 순서: 보통 `finish RFC`(기록 반입) → `promote`. promote가 먼저여도 된다(RFC 폴더 변경은 squash에서 제외된다).

## 3. 큰 요청 (PLAN)

`plan/PLAN-…`이 통합 브랜치다. FDR 브랜치는 `work.mjs start FDR-… --base plan/PLAN-…`으로 거기서 갈라지고 finish가 거기로 ff 병합한다. 마지막에 PLAN을 finish하면 main으로 한 번 간다(V2 integration 브랜치 C방식의 후계).

## 4. 여러 사람

같은 장치다. 사람마다가 아니라 **기록마다** 브랜치. 한 FDR = 구현자 세션 하나. 리뷰어·테스터는 그 FDR의 worktree를 읽기 전용으로 쓴다(`guard-role-write`). M 티어부터 `work.merge: pr`.

## 5. 수명

- 세션 카드가 열린 worktree와 닫힌 기록의 잔존을 보여 준다. `work.mjs list` · `gc --apply`.
- 기록이 closed/abandoned/Concluded인데 브랜치나 worktree가 남으면 lint ⑮ 위반 — 커밋이 막힌다.
- `.scratch/`에 worktree를 두지 않는다(14일 gc 대상).

## 판정

`git worktree list`에 `.worktrees/<ID>`가 없고 `git branch --list <type>/<ID>`가 비면 끝난 것이다. main의 `git log --oneline -3`에 병합(fdr) 또는 "기록 반입"(rfc) 커밋이 보인다.
