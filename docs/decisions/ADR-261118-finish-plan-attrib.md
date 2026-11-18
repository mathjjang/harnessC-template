# ADR-261118-finish-plan-attrib: 구현 전 FDR은 finish가 shipped로 올리지 않고, plan PR은 들어온 FDR의 판정을 보며, standard FDR의 작성 줄은 01-spec에서 읽는다

- 상태: Accepted (REP `rep/finish-plan-attrib` · PR #11 · 담당 승인 2026-11-18)
- 작성: Claude Code (claude-opus-5-5) · 담당 mathjjang · 2026-11-18
- 강제 등급: gate — 집행 수단: `.harness/catalog.yaml` work.mjs(finish 거부 · `--draft`) · ci.mjs(plan PR 판정) · lint.mjs(⑤ 귀속)
- 위험: low (세 곳 모두 지금 쓸 수 없던 길을 여는 수정이다. 기존에 통과하던 PR·기록이 새로 막히는 경우는 구현 전 FDR의 finish 하나뿐이다)
- 선행 RFC: 없음
- 관련: 없음
- 정책 소유: technical

> ADR은 되돌리기 비싼 결정에만 쓴다. 결정은 단정문으로. 대안이 비면 "정말 비교했나"를 의심한다.

## 1. Context (왜 지금)

한 프로젝트에서 standard 프로파일·PLAN을 처음 쓰면서 코어 결함 셋이 한꺼번에 드러났다.

1. **finish가 구현 전 FDR을 shipped로 올린다.** 구현자가 설계 검토를 받으려고 spec·design 단계에서 `work.mjs finish`를 돌리자 `markShipped`가 상태를 shipped로 바꿔 커밋했고, PR 본문도 shipped로 나갔다. 구현자가 손으로 되돌렸다. `markShipped`는 상태만 보고(draft·in-progress) 단계를 보지 않는다.
2. **plan/* PR이 언제나 CI에서 실패한다.** `reviewProblems`가 plan 기록을 폴더(`docs/records/PLAN-…/`)로 찾는다. PLAN은 파일 한 장(`docs/records/PLAN-….md`)이라 "기록 폴더가 없다"로 끝난다. 폴더가 있었더라도 PLAN 양식에는 판정 칸이 없어 통과할 수 없다.
3. **standard FDR은 만들자마자 lint ⑤에 걸린다.** `recordMain`이 standard FDR의 본문을 `manifest.yaml`로 고르고 그 파일에서 「작성:」을 찾는다. new-doc은 작성 줄을 `01-spec.md`에 쓴다(담당 검사·ci의 작성자 판정도 01-spec을 읽는다). 프로젝트들은 manifest에 주석 한 줄을 넣어 우회했다.

## 2. Decision (무엇을 한다 / 하지 않는다)

- **finish** — standard·full FDR의 manifest `current_stage`가 spec·design·ui-flow·prototype이면 `finish <ID>`는 거부하고 이유와 대안을 알린다. `finish <ID> --draft`(work.merge: pr일 때만)는 상태를 바꾸지 않고 rebase → lint → push → 초안 PR을 연다. 구현·시험 뒤에는 `--draft` 없이 finish한다(지금과 같다). lite FDR은 단계 칸이 없어 보지 않는다.
- **plan PR** — CI는 PLAN 기록이 파일 또는 폴더로 있는지만 보고 PLAN 자체에 판정을 요구하지 않는다. 그 PR이 바꾸는 경로(변경 파일 + 커밋 이력)에 나오는 FDR마다 그 기록의 판정(⑦)을 묻는다. ⑧(판정 뒤 제품 코드)은 plan PR에서 보지 않는다 — 각 FDR이 plan 브랜치에 병합될 때 물었고, 여러 FDR의 커밋이 섞인 이력에서는 남의 코드가 판정 뒤로 잡힌다. FDR이 하나도 없는 plan PR은 판정 없이 통과한다.
- **lint ⑤** — standard·full FDR(본문이 `manifest.yaml`이고 `01-spec.md`가 있다)은 「작성:」을 `01-spec.md`에서 찾는다. 담당 검사와 같은 파일이다.
- 런북 `work.md` §1·§3에 `--draft`와 plan PR 판정, "기록·문서만 바꾸는 일은 main에 바로 커밋한다"를 적는다. catalog의 work.mjs 명령에 `[--draft]`.
- 하지 않는다: PLAN 양식에 판정 칸 추가 · lite FDR의 단계 추정 · `markShipped` 자체의 조건 변경(finish가 앞에서 막는다).

## 3. Alternatives

| 대안 | 장점 | 탈락 사유 |
|---|---|---|
| finish가 구현 전 FDR이면 markShipped만 건너뛰고 일반 PR을 연다 | 명령이 하나 | 구현자가 설계 검토 PR과 병합 PR을 구분하지 못한다. 초안이 아니면 실수로 병합된다 |
| PLAN 양식에 판정 칸을 두고 plan PR에 PLAN 판정을 요구한다 | 판정 위치가 하나 | 각 FDR이 이미 판정을 받는다 — 같은 내용을 두 번 묻는다. 문서만인 plan PR도 리뷰를 기다린다 |
| plan PR에서도 FDR마다 ⑧을 본다 | 더 엄격하다 | 커밋 이력에 여러 FDR이 섞여 다른 FDR의 코드가 판정 뒤로 잡힌다(오탐) |
| new-doc이 manifest.yaml에도 작성 줄을 쓴다 | lint를 고치지 않는다 | 같은 사실이 두 곳에 생긴다(HARNESS §8). 이미 만든 기록은 그대로 걸린다 |

## 4. Consequences (득실 · 후속 작업 · 되돌릴 때 비용)

- 득: 설계 검토를 PR로 받는 길이 생긴다. plan 통합 브랜치가 실제로 main에 들어갈 수 있다. standard FDR을 우회 줄 없이 만든다.
- 실: 구현 전 FDR에 `finish`를 쓰던 습관은 막힌다(의도).
- 시험: `ci.mjs --self-test`(plan 4건 — 기록 없음 · 문서만 · 판정 없는 FDR · 판정 있는 FDR의 ⑧ 오탐 없음), `work.mjs --self-test`(구현 전 거부 · ff 저장소의 --draft 거부 · preImplStage 2건), `lint.mjs --self-test`(01-spec 작성 줄 양성 · 01-spec에도 없으면 부정). 세 시험 모두 수정을 되돌린 사본에서 실패함을 확인했다.
- 적용: 프로젝트는 `sync-core` 뒤 manifest에 넣었던 작성 줄 우회 주석을 지워도 된다(남겨도 무해).
- 되돌릴 때: 세 스크립트의 해당 분기를 지운다. 기록 형식은 바뀌지 않는다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| 2026-11-18 | Claude Code (claude-opus-5-5) · 담당 mathjjang | 전체 | 최초 작성 |
| 2026-11-18 | Claude Code (claude-opus-5-5) · 담당 mathjjang | §2 finish | 구현 전 판단을 worktree(브랜치)의 기록에서 읽는다 — v0.4.12는 본 트리 사본(착수 때 spec)을 읽어 구현을 마친 FDR의 finish를 거부했다 |
