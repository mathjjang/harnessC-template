# harnessC-template

AI 에이전트와 함께 개발하는 프로젝트를 위한 **방법론 뼈대**. 프로젝트 종류와 무관한 구조·규칙·템플릿·설정을 담고, 새 프로젝트는 이것을 복제해 시작한다. 방법론의 고도화는 이 저장소에서 한다.

- 코어 버전: **0.1.0** (기술 검토 단계 · 하네스B의 다음 세대)
- 계보: Harness `/init` 스캐폴드(하네스B `init-templates/`) → 이전 프로젝트 운영 7~14주 → 하네스C
- 근거와 진화 기록: [`docs/methodology/`](docs/methodology/)

## 새 프로젝트 시작

```bash
# 1. GitHub "Use this template" 또는 clone
# 2. 티어·팩을 정해 적용 (결정론 복사 · {{VAR}} 치환 · docs/init-manifest.json)
node init.mjs --name my-project --tier M --packs data-pipeline,llm-app
#    --dry-run 으로 먼저 계획만, --prune 으로 템플릿 전용 폴더(tiers/, 비활성 packs/, init.mjs, docs/methodology/) 제거
# 3. CLAUDE.md "제품 불변"과 docs/requirements/ 채우기 → 첫 RFC/ADR/FDR은 생성기로
node scripts/new-doc.mjs rfc first-question "첫 탐구"
```

티어는 무게를 정한다. 포크하지 않고 `harness.yaml` 값을 바꾼다.

| 티어 | 대상 | FDR 프로파일 | 상시 규칙 상한 |
|---|---|---|---|
| S | 1~2명 · ≤3개월 | lite (단일 파일) | 15KB |
| M (기본) | 2~5명 · 3~9개월 | standard (폴더 7단계) | 25KB |
| L | 5명↑ · 다플랫폼 · 외부 팀 | full (9단계) · strict · 리뷰어 다른 모델 | 40KB |

## 구조

```
HARNESS.md            코어 규칙 (how) — 도메인을 모른다 · ≤10KB
AGENTS.md / CLAUDE.md 운영 규칙 · 제품 불변 (CLAUDE.md는 @AGENTS.md 한 줄 + 짧게)
harness.yaml          프로젝트 설정 단일 파일 (티어·팩·게이트·예산·참조)
human-only.yaml       사람만 할 수 있는 검증 등록부 — 등록 없으면 사람 큐 진입 불가
init.mjs              템플릿 적용기 (self-test 보유)
scripts/              harness-status(세션 카드) · new-doc(생성기) · lint · build-index · check-session-log · check-clutter · git-hooks/pre-commit
.scratch/             세션을 넘겨 살아야 하는 임시 파일의 유일한 자리 (gitignore · 14일 gc)
tools/catalog.yaml    도구 상태 정본 — 규칙은 active 도구만 참조할 수 있다
.claude/              settings(훅: SessionStart·Stop·UserPromptSubmit 모바일 모드) · agents(developer·reviewer·tester) · skills · rules(경로 범위) · hooks
docs/                 requirements · specs(현재 동작) · research · decisions · plans · features · queue · incidents · runbooks · project_wiki · retros · _templates
tiers/S, tiers/L      오버레이 (M은 루트가 기본)
packs/                도메인 팩 12종 (draft) — 규칙은 도구와 함께만 이동한다
evidence/runs/        RUN 원문
```

## 지금 동작하는 것과 아직 아닌 것

| 동작 | 상태 |
|---|---|
| 티어·팩 적용, {{VAR}} 치환, sha256 매니페스트 | `init.mjs` active |
| 날짜형 ID 생성(충돌 시 -2), 귀속 머리, FDR manifest·세션 로그 | `new-doc.mjs` active |
| 세션 시작 카드, 세션 로그 경고, 모바일 모드 자동 전환 | 훅 active |
| 린트: BOM·도구 참조·규칙 예산·중복 문장·귀속·생성물 표식·scripts 카탈로그 | `lint.mjs` active |
| 임시 파일 규율: 루트 신규·임시 패턴 생성 거부(훅), 커밋 차단·잔고 보고·archive·gc(게이트) | `guard-scratch` · `check-clutter` active |
| 기록·스펙·큐 인덱스 생성 | `build-index.mjs` active |
| RUN 원장, FDR close 스펙 병합, AGENTS/CLAUDE 생성(`harness build`), metrics | **planned** — `tools/catalog.yaml` 참조. 규칙 본문은 이들을 참조하지 않는다 |
| 팩의 훅·에이전트·self-test | draft — V2·미니앱 자산 이식(R4) 후 stable |

## 활성화 (clone 직후 1회)

```bash
git config core.hooksPath scripts/git-hooks
```

## 검증

```bash
node init.mjs --self-test && for s in scripts/*.mjs .claude/hooks/*.mjs; do node $s --self-test; done && node scripts/lint.mjs
```

## 개정

이 저장소의 규칙 변경은 REP다(`HARNESS.md` §9). `node scripts/new-doc.mjs adr <slug> "<제목>"`으로 ADR을 남기고 `harness.yaml`의 `harness:` 버전을 올린다.

라이선스: 미정(비공개). 공개 전환 시 결정.
