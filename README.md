# harnessC-template

AI 에이전트와 함께 개발하는 프로젝트를 위한 **방법론 뼈대**. 프로젝트 종류와 무관한 구조·규칙·템플릿·설정을 담고, 새 프로젝트는 이것을 복제해 시작한다. 방법론의 고도화는 이 저장소에서 한다.

- 코어 버전: **0.1.0** (기술 검토 단계 · 하네스B의 다음 세대)
- 계보: Harness `/init` 스캐폴드(하네스B `init-templates/`) → 이전 프로젝트 운영 7~14주 → 하네스C
- 근거와 진화 기록: [`docs/methodology/`](docs/methodology/)

## 새 프로젝트 시작

```bash
# 1. GitHub "Use this template" 또는 clone
# 2. 티어·팩을 정해 적용 (결정론 복사 · {{VAR}} 치환 · .harness/init-manifest.json)
node init.mjs --name my-project --tier M --packs data-pipeline,llm-app
#    --dry-run 으로 먼저 계획만, --prune 으로 템플릿 전용(.harness/tiers/, 비활성 팩, init.mjs, docs/methodology/) 제거
# 3. rules/product.md "제품 불변"과 docs/requirements/ 채우기 → 첫 RFC/ADR/FDR은 생성기로
node .harness/scripts/new-doc.mjs rfc first-question "첫 탐구"
```

티어는 무게를 정한다. 포크하지 않고 `harness.yaml` 값을 바꾼다.

| 티어 | 대상 | FDR 프로파일 | 상시 규칙 상한 |
|---|---|---|---|
| S | 1~2명 · ≤3개월 | lite (단일 파일) | 15KB |
| M (기본) | 2~5명 · 3~9개월 | standard (폴더 7단계) | 25KB |
| L | 5명↑ · 다플랫폼 · 외부 팀 | full (9단계) · strict · 리뷰어 다른 모델 | 40KB |

## 구조 — 사람이 여는 곳과 기계가 쓰는 곳

```
README.md · AGENTS.md · CLAUDE.md · GEMINI.md · harness.yaml
                     ↑ 에이전트 도구가 루트에서만 찾는 입구와 설정 하나 (CLAUDE·GEMINI는 AGENTS + 제품 불변 import)

rules/      규칙만      HARNESS.md(방법론 코어) · product.md(제품 불변) · packs/<팩>.md · human-only.yaml
docs/       문서만      requirements · meetings · research(RFC) · decisions(ADR) · plans · features(FDR)
                        specs(현재 동작) · runbooks · handoffs(에이전트 간) · queue · incidents · project_wiki · retros
                        — 기록의 증거는 그 기록 폴더의 evidence/에 (기능 하나 = 폴더 하나)
src/ tests/ 코드        (개발 시작 시)
collab/     외부 협업   발주사·협력사와 같이 보는 별도 저장소 (팩 external-collab, gitignore)

.harness/   기계 장치   scripts(카드·생성기·린트·게이트) · templates · packs(팩 도구·뼈대) · catalog.yaml
.claude/    Claude Code 훅·에이전트·스킬·경로 규칙
.scratch/   임시        세션을 넘겨 살아야 하는 임시 파일의 유일한 자리 (gitignore · 14일 gc)
```

템플릿에만 있는 것: `init.mjs` · `.harness/tiers/`(S·L 오버레이, M이 기본) · `docs/methodology/` — `init.mjs --prune`이 지운다.

## 지금 동작하는 것과 아직 아닌 것

| 동작 | 상태 |
|---|---|
| 티어·팩 적용, {{VAR}} 치환, sha256 매니페스트 | `init.mjs` active |
| 날짜형 ID 생성(충돌 시 -2), 귀속 머리, FDR manifest·세션 로그 | `new-doc.mjs` active |
| 세션 시작 카드, 세션 로그 경고, 모바일 모드 자동 전환 | 훅 active |
| 린트: BOM·도구 참조·규칙 예산·중복 문장·귀속·생성물 표식·scripts 카탈로그 | `lint.mjs` active |
| 임시 파일 규율: 루트 신규·임시 패턴 생성 거부(훅), 커밋 차단·잔고 보고·archive·gc(게이트) | `guard-scratch` · `check-clutter` active |
| 기록·스펙·큐 인덱스 생성 | `build-index.mjs` active |
| RUN 원장, FDR close 스펙 병합, AGENTS/CLAUDE 생성(`harness build`), metrics | **planned** — `.harness/catalog.yaml` 참조. 규칙 본문은 이들을 참조하지 않는다 |
| 팩의 훅·에이전트·self-test | draft — V2·미니앱 자산 이식(R4) 후 stable |

## 활성화 (clone 직후 1회)

```bash
git config core.hooksPath .harness/scripts/git-hooks
```

## 검증

```bash
node init.mjs --self-test && for s in .harness/scripts/*.mjs .claude/hooks/*.mjs; do node $s --self-test; done && node .harness/scripts/lint.mjs
```

## 개정

이 저장소의 규칙 변경은 REP다(`rules/HARNESS.md` §9). `node .harness/scripts/new-doc.mjs adr <slug> "<제목>"`으로 ADR을 남기고 `harness.yaml`의 `harness:` 버전을 올린다.

라이선스: 미정(비공개). 공개 전환 시 결정.
