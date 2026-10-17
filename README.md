# harnessC-template

AI 에이전트와 함께 개발하는 프로젝트를 위한 **방법론 뼈대**. 이 저장소에는 **모든 프로젝트에서 동일하게 동작하는 것만** 있다. 제품·도메인에 따라 달라지는 것은 각 프로젝트의 `rules/`·`docs/`에 쓴다. 방법론의 고도화는 여기서만 한다 — 프로젝트는 `sync-core`로 내려받고, 프로젝트에서 코어를 고치면 린트가 막는다.

- 코어 버전: **0.3.2** (기술 검토 단계 · 하네스B의 다음 세대)
- 짝 템플릿: [harnessC-mockup-template](https://github.com/mathjjang/harnessC-mockup-template) — 목업(기획·디자인) 저장소 뼈대. 화면 설계가 시작될 때 `node .harness/scripts/mockup-diff.mjs init separate`(별도 GitHub 저장소 — 기획·디자인 분리, 기본) 또는 `init embedded`(개발 저장소 안 `mockups/` — 혼자 개발)로 고른다. 레이아웃이 같아 나중에 폴더째 분리할 수 있다. UI 없는 프로젝트는 없어도 된다
- 계보: Harness `/init` 스캐폴드(하네스B) → 이전 프로젝트 운영 7~14주 → 하네스C
- 이 템플릿은 **결과물**이다. 방법론의 개발·결정(ADR)·탐구(RFC)·근거 문서는 프로젝트 저장소 [`mathjjang/HarnessC`](https://github.com/mathjjang/HarnessC)에 있다 — 여기에는 새 프로젝트가 내려받을 것만 둔다

## 새 프로젝트 시작

```bash
# 1. GitHub "Use this template" 또는 clone
# 2. 티어를 정해 적용 (결정론 복사 · {{VAR}} 치환 · 코어 해시 manifest) — --prune 으로 템플릿 전용 파일 제거
node init.mjs --name my-project --tier M --prune
git config core.hooksPath .harness/scripts/git-hooks
# 3. rules/product.md(제품 불변)와 docs/requirements/ 채우기. 도메인 규칙이 필요하면 rules/domain/<이름>.md (예시: HarnessC 저장소 docs/research/methodology/domain-rules/)
# 4. 첫 기록은 생성기로
node .harness/scripts/new-doc.mjs rfc first-question "첫 탐구"
# 이후 템플릿이 바뀌면
node .harness/scripts/sync-core.mjs --from ../harnessC-template
```

| 티어 | 대상 | FDR 프로파일 | 상시 규칙 상한 |
|---|---|---|---|
| S | 1~2명 · ≤3개월 | lite (`fdr.md` 한 장 + evidence/) | 18KB |
| M (기본) | 2~5명 · 3~9개월 | standard (폴더 7단계) | 25KB |
| L | 5명↑ · 다플랫폼 · 외부 팀 | full (9단계) · strict · 리뷰어 다른 모델 | 40KB |

## 구조 — 모든 프로젝트 동일 / 이 프로젝트만

```
AGENTS.md · CLAUDE.md · GEMINI.md   공통 뼈대 (도구 입구 — 프로젝트명만 치환)      ┐
.harness/   HARNESS.md(방법론) · runbooks/(핸드오프·협업) · scripts · templates     │ 모든 프로젝트 동일
            catalog.yaml · init-manifest.json(코어 해시)                              │ lint ⑫가 지킨다
.claude/    Claude Code 훅·에이전트·경로 규칙 · skills/(생성물)                          │
.agents/ .gemini/   Codex(Agent Skills 표준)·Gemini CLI 입구 — 런북에서 생성(harness-build)   ┘

harness.yaml   프로젝트 설정 (티어·게이트·참조 저장소)                               ┐
rules/         product.md(제품 불변) · domain/*.md(도메인 규칙) · runbooks/ · human-only.yaml │ 이 프로젝트만
docs/          requirements/ · decisions/(ADR) · research/(RFC) · features/(FDR) · handoffs/(HO)   │
               · records/(PLAN·MTG·INC·RETRO) · specs/(현재 참인 것) · queue/                        │
collab/        외부 조직과 같이 보는 별도 저장소 (gitignore)                          │
src/ tests/    코드                                                                   ┘
.scratch/      임시 (gitignore · 14일 gc)
```

- **폴더는 늘지 않는다.** `docs/`는 여덟으로 고정. 자주 여는 기록 넷(ADR 결정·RFC 탐구·FDR 기능·HO 핸드오프)은 `docs/` 바로 아래 자기 폴더, 나머지(PLAN·MTG·INC·RETRO)는 `records/`. `INDEX.generated.md`가 한 곳에 모아 준다. 데이터 소스 조건·프롬프트 계약 같은 도메인 자료는 `docs/specs/<name>.md` **파일**이다.
- **증거는 기록 옆.** `docs/<자리>/<ID>/evidence/`. 완료보고서용 모아 보기는 `docs/INDEX.generated.md` 증거 절.
- **기록 하나 = 브랜치 하나 = worktree 하나.** `work.mjs start <ID>` → `.worktrees/<ID>/`(gitignore). main에 제품 코드 직접 커밋 금지. spike는 `rfc/*` 브랜치에서 바로 — 코드는 병합되지 않고 `promote`로 FDR에 재기반. `.harness/runbooks/work.md`.
- 템플릿에만 있는 것: `init.mjs` · `.harness/tiers/` — `--prune`이 지운다.

## 지금 동작하는 것과 아직 아닌 것

| 동작 | 상태 |
|---|---|
| 티어 적용, {{VAR}} 치환, 코어 해시 manifest · 템플릿 갱신 내려받기 | `init.mjs` · `sync-core.mjs` active |
| 날짜형 ID 생성(충돌 시 -2), 귀속 머리, FDR manifest·세션 로그·evidence, 핸드오프 응답 채번 | `new-doc.mjs` active |
| 세션 시작 카드, 세션 로그 경고, 모바일 모드 자동 전환 | 훅 active |
| 린트 16종: BOM·도구 참조·예산·중복·귀속·생성물·카탈로그·중첩 참조·HR axis·closed FDR·HO 상태·코어 무결성·고정 폴더·scope 겹침·잔존 브랜치·목업 대조 | `lint.mjs` active |
| 동시 작업: 기록별 worktree·브랜치(`work.mjs`), main 제품 코드 직접 커밋 거부·FDR scope 게이트(`check-branch-record`), spike 승격(squash) | active |
| 쓰기 전 거부: 임시 파일·새 폴더(guard-scratch) · 협업 저장소 경계(guard-reference) · 리뷰어/테스터 경로(guard-role-write) | 훅 active (Claude Code) |
| 기록(종류별)·스펙·큐·증거 인덱스 생성 | `build-index.mjs` active |
| 확정 목업 승격(rev 스탬프)·BackstopJS 승인본 픽셀 대조·기록·완료 게이트. 엔진은 PC에 한 번(`engine --install`) | `mockup-diff.mjs` active |
| 런북 → Claude·Codex·Gemini 입구 생성(포인터) · pre-commit 신선도 | `harness-build.mjs` active |
| 검수 접수(목업 저장소 `qa/`)의 개발 쪽 처리 — 오류 건 가져오기·수정 회신·리뷰어 검증(고친 쪽≠검증자) | `qa-intake.mjs` active |
| RUN 원장, FDR close 스펙 병합, metrics | **planned** — `.harness/catalog.yaml` |

## 검증

```bash
node init.mjs --self-test && for s in .harness/scripts/*.mjs .harness/scripts/lib/*.mjs .claude/hooks/guard-*.mjs; do node $s --self-test; done && node .harness/scripts/lint.mjs
```

## 개정

이 저장소의 규칙 변경은 REP다(`.harness/HARNESS.md` §9). `node .harness/scripts/new-doc.mjs adr <slug> "<제목>"`으로 ADR을 남기고 `harness.yaml`의 `harness:` 버전을 올린다. 프로젝트는 `sync-core`로 따라온다.

라이선스: 미정(비공개). 공개 전환 시 결정.
