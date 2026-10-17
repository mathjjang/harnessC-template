# 제품 불변 — {{PROJECT_NAME}}

> 이 프로젝트에서만 참인 것. 위반 = 재작업. ≤3KB. Claude·Gemini는 자동 import, 그 밖은 AGENTS.md "가장 먼저 0".

## 불변

- (init 시 채운다. 예: "로컬 저장이 기본이다", "외부 LLM은 어댑터 뒤에만", "발주사 데이터는 저장소에 두지 않는다")

## 정본 위치

- 요구사항: `docs/requirements/` (`harness.yaml` `requirements.mode`가 separate-repo면 그 저장소)
- 현재 동작: `docs/specs/`
- 기록(결정·탐구·기능·핸드오프·회의): `docs/records/` — 종류는 ID 접두
- 증거: 각 기록 폴더의 `evidence/` (모아 보기: `docs/INDEX.generated.md` 증거 절) · 도메인 규칙: `rules/domain/`
