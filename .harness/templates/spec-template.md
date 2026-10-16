---
capability: {{SLUG}}
last_merge:               # 마지막으로 병합된 FDR ID
owner_pack:               # 코어 | 팩 이름
---

# {{TITLE}} — 현재 동작 스펙

> 이것은 **현재** 동작의 정본이다. FDR `01-spec`의 델타(ADDED/MODIFIED/REMOVED)가 close 시 여기 병합된다. 손으로 고치고 싶은 변경은 lite FDR 한 장으로 한다.
> 시나리오는 관찰 가능한 결과와 단언 등급을 가진다. C 단독은 통과가 아니다 (rules/HARNESS.md §6).

### Requirement: <요구 한 줄>

- 출처: REQ-… · FDR-…
- 정책 소유: product | technical | shared(값 키: )

#### Scenario: <상황>
- WHEN <사용자·시스템 행동>
- THEN <관찰 가능한 결과>
- 단언 등급: A(재조회·재진입 유지) | B(요청 발생·화면 전이) | C(DOM 변화)
- 계층: unit | integration | e2e | human(`rules/human-only.yaml` 축: )
- 근거 RUN: 
