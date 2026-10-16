# docs/ — 기록·스펙·큐 (하네스C 코어)

| 폴더 | 종류 | ID | 성격 |
|---|---|---|---|
| `requirements/` | 요구사항 층 (INTAKE·brief·scope·REQ·open-questions) | REQ-… | 입력 정본 (separate-repo면 링크만) |
| `specs/` | 현재 동작 스펙 (capability별 spec.md) | capability slug | 현재 · FDR close가 병합 |
| `research/` | RFC 탐구 | RFC-YYMMDD-slug | 역사 |
| `decisions/` | ADR 결정 | ADR-YYMMDD-slug | 역사 · Supersede로만 뒤집음 |
| `plans/` | PLAN 분해 | PLAN-YYMMDD-slug | 역사 |
| `features/` | FDR 기능 기록 | FDR-YYMMDD-slug(.md 또는 폴더) | 역사 · shipped/closed |
| `queue/{pg,qa,human-run,backlog}/` | 사람 결정·실행·결함·이월 큐 | PG-…/QA-…/HR-…/BL-… | 한 스키마, 집계는 생성물 |
| `incidents/` | 사고 대장 | INC-YYMMDD-slug | 규칙 개정의 근거 |
| `runbooks/` | 반복 절차 | RB-YYMMDD-slug | trigger로 라우팅 |
| `project_wiki/` | 해설 (구조·도메인) | — | 낡음은 린트가 보고 |
| `retros/` | 분기 회고 | — | metrics 입력 |
| `_templates/` | 생성기 원천 | — | 손 복사 금지 |
| `INDEX.generated.md` | 카탈로그 | — | 생성물 |
