# CLAUDE.md — {{PROJECT_NAME}}

@AGENTS.md

> 이 파일은 짧게 둔다(≤3KB). 방법론은 `HARNESS.md`, 운영은 `AGENTS.md`, 도메인 규칙은 `.claude/rules/`와 `packs/`.

## 제품 불변 (이 프로젝트에서만 참인 것 — 위반 = 재작업)

- (init 시 채운다. 예: "로컬 저장이 기본이다", "외부 LLM은 어댑터 뒤에만", "발주사 데이터는 저장소에 두지 않는다")

## 정본 위치

- 요구사항: `docs/requirements/` (`harness.yaml` `requirements.mode`가 separate-repo면 그 저장소)
- 현재 동작: `docs/specs/`
- 결정·탐구·기능: `docs/decisions/` · `docs/research/` · `docs/features/`

## 로딩

세션 시작 카드가 읽을 파일을 안내한다. 작업 중 필요한 토픽 하나만 연다.
