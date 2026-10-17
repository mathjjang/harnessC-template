---
id: RB-init
trigger: 새 프로젝트에 하네스C를 적용할 때, 프로젝트 조건이 바뀌었을 때(사람이 늘었다 · 외부 발주처가 생겼다 · 화면이 생겼다), "프로젝트 세팅", "하네스 초기화", "설정 다시"
evidence: docs/decisions/ADR-<날짜>-project-setup.md · harness.yaml 「# 근거」·setup 블록
pack: 코어
entry: harness-init
summary: 프로젝트 설정 질문 — 동시 구현자·화면과 목업 담당·기간·규모·외부 조직·사인오프·공개 여부를 물어 티어·병합 방식·게이트를 정하고 근거를 ADR로 남긴다. "프로젝트 세팅", "하네스 초기화", "설정 다시" 요청 시.
args: "[--reconfigure]"
---

# 프로젝트 설정 — 질문으로 정한다

> 왜 질문인가: 티어(S·M·L)를 인원·기간 같은 대리 지표로 고르면 맞지 않는 경우가 생긴다 — 혼자라도 외부 발주처가 있으면, 한 달짜리라도 동시 구현자가 여럿이면. 실제 조건을 묻고 설정 하나하나를 정한다. 티어는 그 결과의 요약이다.

## 1. 묻는다 (에이전트는 자기 런타임의 질문 도구로 · 선택지로)

**반드시 묻는 둘** — 기본값이 위험한 질문이다.

| # | 질문 | 답 |
|---|---|---|
| Q1 | 프로젝트 이름 | 영문 소문자·숫자·하이픈 |
| Q2 | 동시에 구현하는 사람·에이전트 세션은 몇인가(리뷰어 제외)? | 정수 |
| Q4 | 화면이 있는가? 목업은 누가 만드나? | `none`(화면 없음) · `self`(개발자가 직접) · `separate`(기획·디자인이 따로) |

**나머지는 기본값을 보여 주고 한 번에 확인받는다** — "그대로 갈까요?"에 아니오일 때만 하나씩.

| # | 질문 | 기본값 |
|---|---|---|
| Q3a | 예상 기간(개월) | 3 |
| Q3b | 기능 규모 — `small`(FDR 10개 미만) · `medium`(10~50) · `large`(50 이상·다플랫폼·레거시 전환) | small |
| Q5 | 외부 조직(발주처·협력사)과 같이 보는 문서가 있는가? | 아니오 |
| Q6 | 결제·개인정보·의료·공공 납품처럼 사람 사인오프가 필요한 영역이 있는가? | 아니오 |
| Q7 | GitHub 저장소 공개 여부 — `private` · `public` | private |

## 2. 적용한다

답을 `.scratch/answers.json`에 적는다(키: `name · concurrent · ui · duration_months · scale · external · signoff · visibility`).

```bash
# 새 프로젝트(템플릿에서 막 만든 저장소)
node init.mjs --answers .scratch/answers.json --prune --agent "<에이전트(모델)>"
# 조건이 바뀌었을 때 — 이전 답이 기본값, 바뀐 것만 답 파일에
node .harness/scripts/setup.mjs --answers .scratch/answers.json --reconfigure --agent "<에이전트(모델)>"
# 사람이 터미널에서
node init.mjs --interactive --prune           # 또는 node .harness/scripts/setup.mjs --interactive --reconfigure
```

## 3. 판정 (setup.mjs — 고치려면 ADR)

| 설정 | 규칙 |
|---|---|
| 티어 | L: 규모 large · 동시 5 이상 · 외부+사인오프 / M: 규모 medium · 동시 2 이상 · 기간 3개월 초과 · 외부 조직 / 그 밖 S. FDR 기본 프로파일 lite·standard·full, 규칙 상한 18·25·40KB |
| 병합 | 동시 2 이상이면 `pr`(리뷰 판정이 병합 조건) · 혼자면 `ff` |
| 필수 승인(protect) | 동시 5 이상 2 · 2 이상 1 · 혼자 0 |
| gate_mode | 사인오프 영역이 있거나 L이면 `strict` |
| 사람 접점 | 사인오프 영역이면 `signoff` 추가 |

## 4. 결과를 확인한다

- `harness.yaml`의 각 값 옆 「# 근거: Qn …」과 `setup:` 블록(답 원문).
- `docs/decisions/ADR-<날짜>-project-setup.md` — 답·판정·근거·후속 동작. 재설정이면 같은 ADR의 개정 이력에 "무엇이 무엇으로"가 쌓인다.
- 후속 동작: 화면을 개발자가 직접 만들면 `mockups/`가 생긴다. 기획·디자인이 따로면 별도 GitHub 저장소(`mockup-diff.mjs init separate`), PR 모드면 `work.mjs protect`, 외부 조직이면 협업 저장소 — 이 셋은 **바깥(GitHub)에 만드는 일**이라 사람이 실행하거나 `--remote`로 명시 동의한다.
- 비공개 저장소 + PR 모드면 경고가 나온다: GitHub Free에서는 CI가 병합을 막지 못한다.

`node .harness/scripts/setup.mjs --show` — 지금 답과 판정.
