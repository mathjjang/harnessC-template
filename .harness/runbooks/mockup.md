---
id: RB-mockup
trigger: 확정 목업이 있는 화면을 구현·수정할 때, "목업대로 됐는가"를 판정할 때, 공유 CSS·토큰 변경이나 릴리스 전 시각 회귀를 점검할 때
evidence: docs/features/<FDR-ID>/evidence/mockup-diff/rev<N>/
pack: 코어
entry: mockup-diff
summary: 확정 목업 ↔ 구현 화면 승인본 픽셀 대조 — 승격(rev 스탬프)·시나리오·실행·판정·완료 게이트. "목업 대조", "픽셀 diff", "목업대로 구현", "시각 회귀" 요청 시.
args: "<FDR-ID> [--state <이름>] | promote <FDR-ID> <목업 폴더> | --all"
---

# 목업 대조 — 확정 목업이 시각 정본이다

- 작성: Claude Code (claude-fable-5-1) · 2026-10-17 · 근거 ADR-261017-mockup-diff (V2 ADR-0097·런북 mockup-rev-and-screen-policy 이식)

> 왜 있나: "에이전트가 목업대로 만들지 못한다"의 실측 원인은 두 가지였다 — 목업대로인지 **기계로 묻는 단계가 없었고**, 이미지 판독으로 "일치"를 단정하는 것은 금지라 결국 아무도 검증하지 않았다. 이 절차는 그 단계를 FDR 완료 게이트로 둔다. 도구는 `node .harness/scripts/mockup-diff.mjs`(엔진 BackstopJS는 PC에 한 번 설치 — `engine --install`).

## 0. 전제

- 확정 목업 = **목업 저장소**(harnessC-mockup-template 뼈대)에서 사람이 `confirm`한 화면 폴더(`screens/<모듈>/<화면>/` — 상태별 HTML + policy.md + rev.yaml). 확정 절차·개정(rev+1)은 그 저장소의 런북 `design-mockup.md`. 코어는 confirmed 화면만 받는다.
- 목업 저장소의 자리는 둘 중 하나 — `node .harness/scripts/mockup-diff.mjs init separate`(별도 GitHub 저장소를 형제 폴더에 — 기획·디자인이 다른 사람·조직일 때, 기본) / `init embedded`(개발 저장소 안 `mockups/` — 혼자 개발할 때). 둘 다 `harness.yaml references role: mockup`에 등록되고 이후 절차는 같다. embedded는 기획 담당이 생기면 폴더째 새 저장소로 옮기고 path만 바꾼다.
- 목업 데이터는 결정적이어야 한다(오늘 날짜·상대 시각·랜덤값 금지). 목업의 예시 데이터가 곧 시드 명세다 — 구현 화면에 같은 데이터를 **실경로로** 넣는다. 목업 데이터를 주입하는 테스트 모드는 금지(실경로가 아닌 렌더를 검증하게 된다).
- `harness.yaml mockup:` — `origin_env`(구현 오리진을 담은 환경변수 이름 · 값은 적지 않는다) · `viewport` · `threshold`(기본 0.01%) · `wait` · `login`(캡처 전 로그인 모듈, 프로젝트 소유).

## 1. 승격 — 코드보다 먼저 (순서 불변)

```bash
node .harness/scripts/mockup-diff.mjs promote <FDR-ID> <모듈>/<화면> --by "<에이전트(모델)>"     # 목업 저장소의 confirmed 화면 · 폴더 경로도 가능
```

- `docs/features/<FDR-ID>/mockup/<화면>/`에 사본, 공용 자산은 FDR 루트 `_assets/`(html의 `../../_assets/` 참조가 그대로 열리는 자리), `mockup/rev.yaml`에 rev·원본 화면·원본 rev·확정자·상태 파일별 sha256. 원본이 confirmed가 아니거나 확정본 해시와 다르면(reopen 중·몰래 수정) 승격이 거부된다. 재확정(원본 rev+1)이면 다시 promote → 사본 rev+1. **사본은 고치지 않는다.**
- 승격이 사본의 자산 참조를 검사한다 — 열리지 않으면(무스타일) 승격 자체가 실패한다. 그래도 사본 1장은 브라우저로 열어 본다.
- 승격을 건너뛰면 게이트 전부가 "대상 아님"으로 침묵한다. 기존 구현이 있어도 출발점은 목업이다.

## 2. 시나리오 — `mockup/diff-scenarios.json`

상태 파일 **전수**를 적는다(rev.yaml `files`와 1:1 — 미커버·유령은 게이트가 잡는다).

```json
[
  { "state": "01-default.html", "path": "/list", "clicks": ["[data-testid=menu-list]"], "selectors": [".content__inner"] },
  { "state": "02-modal.html", "path": "/list", "clicks": ["[data-testid=add]"], "keypress": [{ "selector": "#name", "text": "표본" }], "clicksAfter": ["[data-testid=submit]"] },
  { "state": "03-empty.html", "excluded": "0건 계정 필요 — 빈 상태는 단위 테스트와 E2E가 본다" }
]
```

- `selectors` = 대조 **범위**(이 화면이 소유한 영역 — 공유 셸은 그 FDR이 본다). 범위를 좁힌 것이지 임계를 완화한 것이 아니다.
- `hide`(visibility:hidden · 자리 유지) / `remove`(display:none · 자리까지)는 **같을 수 없는 것**(라이브 영상·시계)에만. 가린 것은 매 실행 노출된다.
- 도달 불가 상태는 `excluded` + 구체 사유. **전 상태 excluded는 통과가 아니다.**

## 3. 구현 — 문자 이식

- 목업에서 마크업 구조·클래스·`data-testid`를 **문자 그대로** 이식한다(HTML→프레임워크 변환만). 근사 재작성 금지. 화면 고유 CSS는 파일째.
- 목업이 로드하는 서체를 구현도 로드한다 — 폰트 미로드는 실패하지 않고 전 픽셀을 조용히 오염시킨다(러너가 검사해 오류로 적는다).

## 4. 실행과 판정

```bash
<ORIGIN_ENV>=https://<dev호스트>:<포트> node .harness/scripts/mockup-diff.mjs run <FDR-ID> [--state 01-default]
```

- 기준본은 매 실행 목업에서 다시 찍는다 — 저장된 기준본·approve는 없다. 산출: `evidence/mockup-diff/rev<N>/results.json` + 구현 캡처 전건, 초과 건의 기준본·diff.
- **판정은 숫자로만.** "일치한다"는 서술은 판정이 아니다. 수치는 그대로 적는다(반올림·"diff=0" 금지).
- 검증은 사다리다 — 픽셀부터 보지 않는다: ① 구조(testid·요소 실재) ② CSS 정의 ③ 계산값 ④ 픽셀. ④가 빨갛면 이미지를 응시하지 말고 `diff.png`의 좌표 → 그 요소의 속성 → 정의 → 구조로 내려간다.
- **크게 다르면(수 %대·구조 어긋남) 진단하지 말고 목업에서 다시 문자 이식한다.** 잔차(임계 언저리)만 사다리로.
- ④를 편집-확인 루프로 쓰지 않는다 — 한 상태를 고치는 중엔 `--state`로 좁혀 돌리고, 전량 실행은 수정이 끝났다고 판단한 시점에 한 번.
- 초과가 **승인된 차이**면 `mockup/deviations.json`에 `{ state, reason, approved_by, date }`로 등재(승인은 사람). 등재 없는 초과는 미완료다.

## 5. 완료 게이트 (lint ⑯ · `mockup-diff.mjs check`)

`mockup/`이 있는 FDR이 `shipped`·`closed`를 주장하면 기계가 묻는다: 같은 rev의 `results.json`이 있는가 · 상태 전수가 커버됐는가 · 오류 0 · 초과는 전부 등재됐는가 · 캡처 해시가 기록과 같은가(수기 조작 차단). 하나라도 아니면 커밋이 막힌다. 화면이 아직 안 됐으면 **shipped로 적지 않는 것**이 정답이다.

## 6. 회귀 — 개발 이후

```bash
<ORIGIN_ENV>=… node .harness/scripts/mockup-diff.mjs run --all
```

공유 CSS·토큰 변경 뒤, 큰 리팩터링 뒤, 릴리스 전. 결과를 각 FDR의 기록과 대조해 **나빠진 것**이 시각 회귀 결함이다 — 구현 유래면 QA 큐(`new-doc.mjs qa`), 목업 재확정 유래면 재승격(rev+1). 완료 기록을 이 실행이 덮어쓰지는 않는다(같은 rev면 덮어쓰이므로, 회귀 점검은 `--state`가 아닌 `--all`로 돌리고 나빠진 FDR만 다시 연다).

## 함정 (V2 실사고)

- 로그인 오리진 ≠ 캡처 오리진 → 비로그인 화면이 조용히 찍힌다. 로그인 모듈은 `{ origin }`을 받아 그 오리진으로 간다.
- 목업 승격본이 원본보다 낡은 채 기준본으로 쓰임 → 재승격 전에는 돌리지 않는다(`rev.yaml`의 `source`가 원본 경로).
- 정적 목업이 못 담는 동작(스크롤·진행 중·삭제 반영)을 목업 탓하지 않는다 — 그것은 스펙 시나리오와 E2E의 몫이다.
