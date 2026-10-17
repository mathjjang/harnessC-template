---
id: RB-work
trigger: 파일을 고치는 작업을 시작할 때(FDR 구현·RFC spike·PLAN 통합), 끝낼 때, spike를 FDR로 승격할 때, 여러 세션·여러 사람이 같은 소스를 건드릴 때
evidence: docs/<자리>/<ID>/evidence/
pack: 코어
---

# 동시 작업 — 기록 하나 = 브랜치 하나 = worktree 하나

> 여러 사람·여러 에이전트가 한 작업 트리를 같이 쓰면 남의 브랜치에 커밋하거나, 미커밋 변경이 섞이거나, 남의 검증 실패에 묶인다. 그래서 처음부터 작업마다 격리한다. 따로 선언하거나 점유 대장을 두지 않는다 — 브랜치 이름이 곧 기록이고, 점유 범위는 FDR 자신의 `scope:`다.

## 자리

```
<repo>/                 본 트리 — 항상 main. 에이전트는 읽기·병합만
<repo>/.worktrees/<ID>/ 기록별 worktree (gitignore · rg·VS Code·Claude Grep에 안 잡힘 · 셸 grep -r/find는 guard-search 훅이 제외를 붙임 · tsc·eslint·prettier ignore는 start가 등재)
브랜치 <type>/<ID>       fdr/FDR-… · rfc/RFC-… · plan/PLAN-… · ho/HO-… (이름은 ID에서 — 직접 만들지 않는다)
```

`harness.yaml work:` — `dir`(기본 `.worktrees`) · `base`(`main`) · `merge`(`ff` S티어 / `pr` M·L) · `link`(gitignore된 로컬 재료, 예 `.env.local`) · `setup`(worktree 생성 후 1회 명령, 예 `pnpm install`).

## 1. FDR 구현

```bash
node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"       # 기록 생성 → scope: [..] 채우고 커밋 (main에 문서 커밋은 허용)
node .harness/scripts/work.mjs start FDR-…                    # 브랜치 + .worktrees/FDR-…/
cd .worktrees/FDR-…  …작업·커밋(pathspec)…                     # 게이트: scope 밖 제품 경로 거부 · 다른 기록 수정 거부
node .harness/scripts/work.mjs finish FDR-…                   # (본 트리에서) lint → main 위 rebase → ff 병합 → worktree·브랜치 제거  / merge: pr 이면 push + PR 생성(§4)
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

- `rfc/*`는 main에 병합되지 않는다 — spike 코드는 결론의 증거이지 제품이 아니다. spike를 그대로 병합하면 검증 안 된 코드가 대량으로 들어오므로, 필요한 부분만 `promote`로 기능 기록에 옮긴다.
- 승격 FDR은 보통 FDR이다 — 스펙 델타·테스트가 붙어야 병합된다. spike에서 돌린 실측은 FDR 브랜치에서 **다시 돌려** `evidence/runs/`에 둘 때만 RUN이다. AC 출처가 Concluded RFC이고 risk low면 `gate_mode: fast`.
- 트리와 무관한 벤치·프로토콜 실측은 `docs/research/RFC-…/evidence/spike/`에(기록과 같이 다닌다).
- 순서: 보통 `finish RFC`(기록 반입) → `promote`. promote가 먼저여도 된다(RFC 폴더 변경은 squash에서 제외된다).

## 3. 큰 요청 (PLAN)

`plan/PLAN-…`이 통합 브랜치다. FDR 브랜치는 `work.mjs start FDR-… --base plan/PLAN-…`으로 거기서 갈라지고 finish가 거기로 ff 병합한다. 마지막에 PLAN을 finish하면 main으로 한 번 간다.

## 4. 여러 사람

같은 장치다. 사람마다가 아니라 **기록마다** 브랜치. 한 FDR = 구현자 세션 하나. 리뷰어·테스터는 그 FDR의 worktree를 읽기 전용으로 쓴다(`guard-role-write`). M 티어부터 `work.merge: pr`.

### PR 흐름 (`merge: pr`)

```bash
node .harness/scripts/work.mjs protect                 # 저장소당 1회 — main 직접 push 금지 · 필수 검사 harness · 필수 승인(S0·M1·L2) · force-push 금지
node .harness/scripts/work.mjs finish FDR-…            # main 위 rebase → push → PR 생성(gh) · 본문은 기록에서 — worktree는 병합 때까지 남는다
#   → CI(harness): lint·생성물·입구 신선도 + 브랜치=기록·scope·임시 파일·리뷰 판정. 리뷰 전이라 「판정 없음」으로 실패하는 것이 정상
#   → 리뷰어(다른 세션)가 06-review.md(lite §5)에 판정·리뷰어(모델) — risk high면 사람 사인오프. 리뷰어는 커밋할 수 없으니 구현자가 커밋
node .harness/scripts/work.mjs finish FDR-…            # 다시: rebase·push·PR 본문 갱신 → CI 통과 → 사람 승인 → GitHub에서 병합(squash 권장)
git pull && node .harness/scripts/work.mjs gc --apply  # 병합된 PR의 worktree·브랜치 정리(gh로 병합 여부 확인)
```

- **CI가 정본 게이트다.** pre-commit은 편의다 — 우회돼도 PR에서 같은 검사가 다시 돈다(`.github/workflows/harness.yml` → `ci.mjs`). 이 파일은 코어라 프로젝트에서 고치지 않는다. 다른 검사(빌드·테스트)는 프로젝트가 별도 워크플로로 더한다.
- 리뷰 판정 `재작업`·미기입·리뷰어=작성자는 병합이 막힌다. `조건부`는 조건을 적어야 하고, 조건은 후속 FDR이나 BL로 남긴다.
- 브랜치 이름은 기록 ID(`fdr/FDR-…`). 기록 없는 브랜치(봇·hotfix)는 CI가 거부한다 — hotfix도 lite FDR 한 장.
- `protect`가 403이면 GitHub Free의 비공개 저장소다. CI 실패 표시는 남지만 병합을 막지는 못한다 — 사람이 빨간 검사를 보고 멈추는 규율만 남는다(공개 또는 Team/Pro로 해소).

## 5. 수명

- 세션 카드가 열린 worktree와 닫힌 기록의 잔존을 보여 준다. `work.mjs list` · `gc --apply`.
- 기록이 closed/abandoned/Concluded인데 브랜치나 worktree가 남으면 lint ⑮ 위반 — 커밋이 막힌다.
- `.scratch/`에 worktree를 두지 않는다(14일 gc 대상).

## 판정

`git worktree list`에 `.worktrees/<ID>`가 없고 `git branch --list <type>/<ID>`가 비면 끝난 것이다. main의 `git log --oneline -3`에 병합(fdr) 또는 "기록 반입"(rfc) 커밋이 보인다.
