<!-- 생성물: node .harness/scripts/build-index.mjs · 2026-10-17 · 손으로 편집하지 않는다 -->
# 기록 카탈로그

## ADR — 결정 (7)

- [ADR-261016-enforcement-alignment](docs/decisions/ADR-261016-enforcement-alignment.md) — ADR-261016-enforcement-alignment: 하네스C 보장 범위 정렬 — 규칙 문구와 집행기 일치(RFC 재판정 P0) · Accepted
- [ADR-261016-external-collab](docs/decisions/ADR-261016-external-collab.md) — ADR-261016-external-collab: 외부 조직과의 협업 저장소 — 형제 체크아웃·DEC/MTG·guard-reference · Accepted
- [ADR-261016-layout-and-handoff](docs/decisions/ADR-261016-layout-and-handoff.md) — ADR-261016-layout-and-handoff: 폴더 재배치(rules·docs·.harness)와 에이전트 간 핸드오프(HO) · Superseded
- [ADR-261017-core-only-and-fixed-folders](docs/decisions/ADR-261017-core-only-and-fixed-folders.md) — ADR-261017-core-only-and-fixed-folders: 템플릿에는 모든 프로젝트에서 동일하게 동작하는 것만 — 고정 폴더·팩 폐 · Accepted
- [ADR-261017-record-folders](docs/decisions/ADR-261017-record-folders.md) — ADR-261017-record-folders: 자주 여는 기록 넷(ADR·RFC·FDR·HO)을 docs/ 바로 아래 자기 폴더로 · Accepted
- [ADR-261017-s-tier-budget](docs/decisions/ADR-261017-s-tier-budget.md) — ADR-261017-s-tier-budget: 티어 S 상시 규칙 상한 15KB → 18KB · Accepted
- [ADR-261017-work-isolation](docs/decisions/ADR-261017-work-isolation.md) — ADR-261017-work-isolation: 동시 작업 — 기록 하나 = 브랜치 하나 = worktree 하나, spike는 RFC 브랜치 · Accepted

## RFC — 탐구 (2)

- [RFC-261016-harness-c-methodology-review](docs/research/RFC-261016-harness-c-methodology-review) — RFC-261016-harness-c-methodology-review: 하네스C 방법론의 약점과 개선 우선순위 · Concluded
- [RFC-261017-concurrent-work](docs/research/RFC-261017-concurrent-work) — RFC-261017-concurrent-work: 여러 에이전트·여러 개발자의 동시 작업 — V2 운영 분석과 하네스C 설계 · Concluded

## HO — 핸드오프 (1)

- [HO-261016-codex-rebuttal](docs/handoffs/HO-261016-codex-rebuttal) — HO-261016-codex-rebuttal: 하네스C 방법론 리뷰 재판정에 대한 Codex 재반박 · closed

## runbook (3)

- [collab](.harness/runbooks/collab.md) — 코어 · 발주사·협력사 등 다른 조직과 같이 보는 저장소(harness.yaml references role collab)를 만들거나,
- [handoff](.harness/runbooks/handoff.md) — 코어 · 다른 세션·다른 회사 에이전트(Codex·Gemini·Cursor 등)에게 리뷰·검증·조사를 맡기거나, 그런 요청을 받았을 때
- [work](.harness/runbooks/work.md) — 코어 · 파일을 고치는 작업을 시작할 때(FDR 구현·RFC spike·PLAN 통합), 끝낼 때, spike를 FDR로 승격할 때, 

## 증거 — 기록별 evidence/ 모아 보기 (2)

- [HO-261016-codex-rebuttal](docs/handoffs/HO-261016-codex-rebuttal/evidence/) — 파일 5
- [RFC-261016-harness-c-methodology-review](docs/research/RFC-261016-harness-c-methodology-review/evidence/) — 파일 3

