---
id: {{ID}}
title: "{{TITLE}}"
profile: lite
status: draft             # draft | in-progress | shipped | closed | abandoned
gate_mode: standard       # fast | standard | strict
risk: low                 # low | medium | high
source_req: []            # REQ-… (confirmed만)
source_rfc:               # spike에서 승격됐으면 RFC-… (work.mjs promote가 채움)
scope: []                 # 이 FDR이 고치는 제품 경로 glob — 커밋 게이트가 이 밖을 거부, 활성 FDR끼리 겹치면 lint ⑭. 예: [src/customs/**, src/config/weights.yaml]
capability:               # docs/specs/<capability> — close 시 §1 델타 병합 대상
created: {{DATE}}
updated: {{DATE}}
---

# {{ID}} · {{TITLE}}

- 작성: {{AGENT}} · {{DATE}}

## 1. Spec (델타 — 현재 스펙 대비 ADDED / MODIFIED / REMOVED)

### ADDED Requirement: 
#### Scenario: 
- WHEN / THEN / 단언 등급 / 계층

**AC**
- AC-1 … (출처 REQ-…)

**사전 일괄 질의 (Stage 1 — 접점 ①)**
- Q1 … → 답:
- PG 후보: (등재는 `node .harness/scripts/new-doc.mjs pg …` → `docs/queue/PG-…`)

## 2. Design (구조·계약·비범위. 되돌리기 비싼 결정이 나오면 멈추고 REP→ADR)

## 3. Impl (커밋 · 바뀐 파일 · 고른 이유 한 줄)

## 4. Test (계층별 RUN 원문 인용 — 원문은 이 폴더 `evidence/`. 못 돌린 것은 "미검증"으로)

| AC | 계층 | 실행 명령 | RUN/결과 원문 | 판정 |
|---|---|---|---|---|

## 5. Review (접점 ② — 다른 세션의 리뷰어. 확인한 RUN 목록 · PG 일괄 결정 · 리뷰 패키지 링크)

- 리뷰어(모델):
- 판정: 통과 | 재작업 | 조건부
- 종결: shipped(사람 대기: ) | closed(스펙 병합: )

## 세션 로그

| 날짜 | 에이전트 | 완료 | 가설 | 미결 | 재개점 |
|---|---|---|---|---|---|
| {{DATE}} | {{AGENT}} | 생성 | - | - | 재개점: §1 작성 |
