---
id: RB-qa
trigger: 목업 저장소에 검수 접수(qa/QA-…)가 들어왔을 때, 오류 건을 가져와 고치고 검증·회신할 때, "검수 건 처리", "QA 가져와", "버그 고쳐서 회신"
evidence: 목업 저장소 qa/<ID>/resolution.md (개발 소유) · docs/queue/<ID>.md 처리 기록
pack: 코어
entry: qa
summary: 검수 접수의 개발 쪽 처리 — 목업 저장소 qa/의 오류 건을 가져오고(pull), FDR 규율로 고치고, 리뷰어가 검증(verified)해 회신한다. 기획수정·정책공백은 가져오지 않는다. "검수 건 처리", "QA 가져와", "버그 고쳐서 회신" 요청 시.
args: "pull | reply <ID> --state taken|resolved|verified [--commit <sha>] [--steps \"<확인 절차>\"] | status"
---

# 검수 처리 — 접수는 기획, 수정은 개발, 닫기는 다시 기획

- 작성: Claude Code (claude-fable-5-1) · 2026-10-17 (V2 ADR-0134 QA 체계의 두 저장소판 — ADR-261017-qa-flow)

> 접수처는 목업 저장소 `qa/`(런북 `qa-intake.md`)다. 유형이 경로를 정한다 — **오류만 개발이 가져간다.** 기획수정(UI·정책)은 목업 rev+1·policy 개정이 먼저이고, 그 뒤 개발이 재승격·구현한다(런북 `mockup.md`). 정책공백은 사람 결정 뒤 다시 분류된다. 도구 `node .harness/scripts/qa-intake.mjs`.

## 0. 누가 발견했나가 자리를 정한다

| 발견 | 자리 |
|---|---|
| 기획·검수자가 테스트 서버에서 | 목업 저장소 `qa/` (이 런북이 가져온다) |
| 개발자가 사람으로서 테스트 서버에서 — **오류**(기획대로 동작하지 않음) | 개발 저장소 `node .harness/scripts/new-doc.mjs qa <slug> "<증상>"` 직접 접수 → 이 런북 §2부터 같다 |
| 개발자가 발견했지만 **기획에 닿음**(화면·정책을 바꿔야 풀림) | 목업 저장소 `qa/`에 접수해 기획이 분류·결정한다 — 개발이 기획을 대신 정하지 않는다 |
| 에이전트가 자기 작업 중 | 접수하지 않는다 — 그 FDR 안에서 고친다(evidence/·session-log) |
| 에이전트가 못 하는 사람 검증 | `docs/queue/HR-` (`rules/human-only.yaml` 축만) |

## 1. 가져오기

```bash
node .harness/scripts/qa-intake.mjs pull          # 오류 · open|reopened → docs/queue/<같은 ID>.md (sync: 원본). 미정·기획수정·정책공백은 보류 목록으로만
node .harness/scripts/build-index.mjs
```

큐 파일에는 원본 링크·화면·되어야 할 모습만 있다 — 증상·캡처는 원본(`qa/<ID>/report.md`)에서 읽는다. 복사하지 않는다.

## 2. 고치기 — 평소 개발 규칙 그대로

- 귀속 재확인: 분류가 틀렸으면 고치지 말고 목업 저장소에서 다시 classify(에이전트)하게 한다 — 기획수정을 오류로 가장해 코드로 바꾸지 않는다.
- 수정은 그 화면을 소유한 FDR의 worktree에서(`work.mjs start`), scope 안에서. 한 줄 수정이면 lite FDR 또는 기존 FDR 안에서.
- 착수 표시: `qa-intake.mjs reply <ID> --state taken --by "<에이전트(모델)>"`
- 고쳤으면 **증적은 둘만** — 원인 한 줄 + 수정 커밋 + 리뷰어가 밟을 확인 절차(한 줄이면 한 줄). 증상 성격에 맞는 증거 하나(기계로 잡히면 재발 방지 테스트 + 출력 원문, 눈에 보이면 수정 후 캡처). 과한 증적은 속도를 죽인다(V2 QA §6 — 한 줄 수정이 절차에 26분 묶인 사고).

```bash
node .harness/scripts/qa-intake.mjs reply <ID> --state resolved --commit <sha> --steps "<확인 절차>" [--server <반영된 테스트 서버>] --by "<에이전트(모델)>"
```

## 3. 검증 — 고친 쪽은 자기 검증자가 될 수 없다

리뷰어(다른 세션 · `reviewer` 에이전트)가 ① 원본의 재현 절차를 다시 밟아 증상이 사라졌는지 ② 커밋이 실제 그 변경인지 확인하고:

```bash
node .harness/scripts/qa-intake.mjs reply <ID> --state verified --by "<리뷰어(모델)>"     # by가 resolved의 by와 같으면 거부
```

불합격이면 verified를 올리지 않고 발견을 큐 파일 처리 기록에 적는다. 리뷰어는 제품 코드를 고치지 않는다.

## 4. 닫기 — 기획이

verified가 올라가면 목업 저장소 인덱스의 「확인 후 닫기」에 뜬다. 기획이 테스트 서버에서 확인하고 `qa.mjs close`. 여전히 재현되면 `reopen` → `pull`이 다시 가져온다(같은 큐 파일에 이어 적는다).

## 상태 한눈에

```bash
node .harness/scripts/qa-intake.mjs status
```

| 원본 state(기획) | resolution state(개발) | 뜻 |
|---|---|---|
| open | — | 분류·착수 전 |
| open | taken | 고치는 중 |
| open | resolved | 리뷰 대기 |
| open | verified | 기획 확인 대기 |
| closed | verified | 끝 |
| reopened | (이전) | 재현 — 다시 pull |
