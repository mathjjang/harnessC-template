# HARNESS.md — 하네스C 코어 규칙 (how)

> 하네스C 코어 v0.3.0 · 모든 프로젝트에서 동일한 파일(lint ⑫). 고치려면 템플릿에서 고치고 `sync-core`. 제품 불변은 `rules/product.md`, 도메인 규칙은 `rules/domain/`, 운영 규칙은 `AGENTS.md`. 코어는 `harness.yaml`로 적응한다. 개정은 §9 REP.

## 1. 지식 층 (로딩 순서)

```
규칙    .harness/HARNESS.md · rules/product.md · AGENTS.md · .claude/rules/*  항상 (예산 always_on_kb)
도메인  rules/domain/*.md                              해당 작업 시 (프로젝트 고유)
라우터  harness-status 카드 · docs/specs/index.md      세션 시작 시 자동
스펙    docs/specs/                                    지금 참인 것 — 제품 동작·데이터 소스·프롬프트 계약
runbook .harness/runbooks/(코어) · rules/runbooks/     trigger 매칭 시 — 절차 정본. 런타임 입구(.claude/skills · .agents/skills · .gemini/commands)는 생성물
기록    docs/decisions(ADR) · research(RFC) · features(FDR) · handoffs(HO) · records(PLAN·MTG·INC·RETRO)   근거가 필요할 때만. 불변 역사. 증거는 그 폴더의 evidence/
큐      docs/queue/<PG|QA|HR|BL>-…                     열린 것만
```

폴더는 늘지 않는다 — `docs/`는 여덟(requirements·decisions·research·features·handoffs·records·specs·queue)으로 고정, 기록의 자리는 종류가 정한다(lint ⑬·훅·`lib/records.mjs`). 전체 eager-load 금지. 규칙이 참조하는 도구는 `.harness/catalog.yaml`에 `active`여야 한다.

## 2. 라우팅 (위에서부터 먼저 맞는 것)

| 변경 성격 | 절차 | 산출물 |
|---|---|---|
| 신규·불확실 (접근법 미정·실현성 모름) | 탐구(타임박스) | **RFC** |
| 되돌리기 비싼 결정 (구조·공개 계약·저장 형식·정책·이 규칙) | **REP** §9 | **ADR** |
| 큰 요청 (여러 FDR·5파일↑·2시간↑) | 분해 | **PLAN** → FDR들 |
| 사용자 가시 기능 | **FDP** | **FDR** |
| 다른 에이전트(타사 포함)에게 맡김·리뷰 요청 | §11 | **HO** |
| 확정 목업이 있는 화면 | runbook `mockup.md` (승격→문자 이식→대조) | FDR + `mockup/` + 대조 기록 |
| 반복 절차 | — | **runbook** (`rules/runbooks/` · 입구가 필요하면 머리말 `entry:`) |
| 외부 데이터·LLM 프롬프트 등 조건이 있는 의존 | — | **스펙 파일** `docs/specs/<name>.md` |
| 단순 수정 | — | 없음 |

타이브레이크: 여러 기능·외부 소비자·장기 호환에 닿으면 REP→ADR 선행. 한 기능 내부면 FDR design에.

## 3. ID와 생성

- ID = `<TYPE>-<YYMMDD>-<slug>` (예 `FDR-261016-customs-api`). 등록부·번호 대역 없음. 같은 날 같은 슬러그만 충돌(`-2`).
- 생성은 `node .harness/scripts/new-doc.mjs <fdr|adr|rfc|plan|inc|retro|ho|pg|qa|hr|bl|runbook|spec|mtg|dec> <slug> "<제목>"`. 손 복사 금지. 생성기가 자리를 고르고 귀속 머리·manifest·세션 로그·`evidence/`를 만든다.
- `MTG`(회의)·`DEC`(외부 조직과의 합의 결정)는 협업 저장소(`harness.yaml references` role `collab`)에 만든다(`--ref collab`). ADR은 내부 결정이며 DEC를 인용한다. 역방향 인용은 훅이 거부. 절차: `.harness/runbooks/collab.md`.
- 인덱스 `docs/INDEX.generated.md`·`docs/specs/index.md`·`docs/queue/INDEX.generated.md`는 생성물. 손 편집 금지.

## 4. FDR 프로파일 (티어가 기본값)

| 프로파일 | 단계 | 형태 |
|---|---|---|
| lite (S) | spec · design · impl · test · review | 폴더에 `fdr.md` 한 장 + `evidence/` |
| standard (M) | spec · design · impl · unit · integration · review · close | 폴더 + `manifest.yaml` + `evidence/runs/` |
| full (L) | + ui-flow · prototype · e2e · audit | 폴더 9단계 |

- `manifest.yaml`(lite는 `fdr.md` 머리말)이 상태 정본. 상태: `draft → in-progress → shipped → closed` (`abandoned` 사유 필수).
- **shipped** = 구현이 main에 있고 사람 대기만 남음. **closed** = `01-spec` 델타가 `docs/specs/`에 병합됨. 병합 없이 closed 불가(lint ⑩).
- `gate_mode: fast | standard | strict`. fast는 AC 출처가 승인된 REQ/FDR(또는 Concluded RFC)이고 새 정책 0건일 때만. 새 PG가 생기면 standard로.
- `risk: low | medium | high`. 보안·스키마·공개 API·저장 형식·결제에 닿으면 high.
- `scope: [glob]` — 이 FDR이 고치는 제품 경로. 커밋 게이트가 그 밖을 거부하고 lint ⑭가 활성 FDR 간 겹침을 알린다. 공유 변경은 별도 lite FDR로 먼저 병합.

## 5. 사람 게이트

| risk | Stage 1 | review | 종결 |
|---|---|---|---|
| low | 일괄 질의, 무응답 시 기본값 진행 | 리뷰 에이전트(다른 세션) | 에이전트 |
| medium | 승인 | 리뷰 에이전트 + 리뷰 패키지 사람 열람(비차단) | 에이전트 + 표본 감사 |
| high | 승인 | 사람 사인오프(비동기·기한) | 사람 |

- 중간은 무중단. 정책 공백(PG)은 등재만 하고 계속 간다. 릴리스 차단 여부를 적는다.
- 정지선: 미결 PG에 **의존하는 비가역 행동**(삭제·외부 공개·참조 저장소 쓰기·정본 변경·대량 데이터 처리)은 결정 전 실행하지 않는다. 독립·가역 작업은 계속. 무응답 기본값은 가역 선택에만. PG에는 영향 행동·임시 가정을 적는다.
- 사람만 할 수 있는 검증은 `rules/human-only.yaml`에 등록된 것만 사람 큐(HR-)에 들어간다(lint ⑨). 기본값은 "에이전트가 한다".
- 결정은 자유 입력이 아니라 선택지 질문으로 묻는다.

## 6. 검증과 증거

- 통과는 실행 결과 원문을 인용한 뒤에만 — RUN 원장 도입 전에는 명령·종료코드·출력 원문(기록 폴더의 `evidence/`). 못 돌린 것은 **미검증**.
- 실패할 수 있었던 시험만 증거다(0행 모집단·양성만 있는 케이스는 시험이 아니다).
- 유보("나중에")는 찾아본 경로를 적은 뒤에만. 저장소에 파일로 있는 것은 유보 사유가 아니다.
- 목은 unit까지. integration·e2e는 실 경로. 외부 API는 실호출 1회 녹화본만 단위에서 허용. 실 경로가 없는 축은 녹화본·계약 시험으로 대신하되 **격리 통합**이라 적는다.
- 검사 범위를 스스로 줄이지 않는다. 줄이면 실측 근거를 같은 줄에.
- 빌드·실행 **성공 여부**는 로그가 아니라 산출물(mtime·해시)로. 산출물은 성공의 필요조건이지 정확성의 증거가 아니다.
- 스펙 시나리오는 관찰 가능한 결과 + 단언 등급(A 재조회·재진입 유지 > B 요청·전이 > C DOM). 저장·상태는 A 필수, 표현 요구는 C도 정당. 상위 등급이 가능한 요구를 C만으로 통과시키지 않는다.
- 확정 목업이 있는 화면은 승인본 픽셀 대조 기록(같은 rev · 상태 전수 · 초과는 등재)이 shipped의 필요조건(lint ⑯). 판정은 수치, 이미지 판독 단정 금지. 절차 `.harness/runbooks/mockup.md`.
- 게이트의 보장 범위는 도구 머리에 적힌 것까지. `lint OK`는 형식·존재·연결의 통과, 내용 타당성은 리뷰어 몫.

## 7. 큐 (하나의 스키마)

`docs/queue/<PG|QA|HR|BL>-<YYMMDD>-<slug>.md` — PG 정책 공백 · QA 사람 발견 결함 · HR 사람 실행 요청 · BL 이월. 머리말 스키마: `id · source · severity · blocking · owner · due · state · decision · sync`. 집계는 `docs/queue/INDEX.generated.md`. 결정 전에는 어느 정본도 고치지 않는다.

## 8. 기록 규율

- 결정은 그 순간 남긴다. ADR·FDR은 단정문으로. 대안 없는 ADR은 의심한다.
- 문서 머리 `작성: <에이전트(모델)> · <날짜>`, 수정 시 개정 이력 행. 모델명은 실행 환경이 명시한 것만.
- 같은 사실은 한 곳에, 다른 곳은 링크. 사본을 만들면 같은 작업에서 대조 기계를 만든다.
- 사고는 `INC-*`에. 규칙 본문에는 `(INC-…)` 링크만. 방법론 회고는 `RETRO-*` — 결론은 템플릿 REP 제안으로.
- 세션 종료 시 활성 기록의 `session-log.md`에 4줄(완료·가설·미결·재개점). Stop 훅이 경고한다.
- **임시 파일은 저장소를 어지럽히지 않는다.** 프로브·로그·중간 산출물은 세션 scratchpad 또는 `.scratch/<YYMMDD>-<topic>/`에만(14일 후 gc). 루트·`docs/`·`rules/`의 신규 폴더와 임시 패턴 이름(`.tmp*`·`*.log`·`probe-*`…)은 훅이 쓰기 전에 막고(`guard-scratch`) 게이트가 커밋을 막는다(`check-clutter`). 증거는 기록 폴더의 `evidence/`, 영구 스크립트는 `.harness/scripts/` + 카탈로그 등재.

## 9. REP (규칙 변경)

이 파일·AGENTS.md·코어 runbook·템플릿·스크립트를 바꾸는 것은 REP이며 **템플릿 저장소에서만** 한다: ① ADR 초안 ② 영향 스캔(문서·코드·설정·템플릿·게이트) ③ 승인 ④ 적용 ⑤ 검증 ⑥ `Accepted` ⑦ 프로젝트는 `sync-core`로 내려받는다. 되돌릴 땐 새 ADR + 옛 것 `Superseded`. 새 규칙은 강제 등급을 고른다 — `generate > gate > report > none`(사유 필수) — 그리고 `.harness/catalog.yaml`에 집행 수단을 적는다. "사람이 읽어야 지켜지는 규칙"은 미완성 규칙이다.

## 10. 원칙 (요약)

1 규칙은 파일이 정본 · 2 절차/산출물 분리 · 3 사람 2접점 · 4 통과는 원문 인용 · 5 규칙은 기계가 강제, 게이트는 self-test · 6 방법론은 REP로 자기 개정 · 7 사본에는 대조가 딸린다 · 8 **템플릿에는 모든 프로젝트에서 동일하게 동작하는 것만** — 도메인·제품 규칙은 프로젝트 `rules/` · 9 코어는 도메인을 모른다 · 10 규칙 정본 하나, 하네스별 파일은 생성물 · 11 등재·증명은 생성기가 · 12 큐는 한 스키마 · 13 기록은 역사, 스펙은 현재 · 14 다른 조직이 쓰는 저장소는 분리(gitignore된 중첩 또는 형제 체크아웃 · 의존은 개발→협업 한 방향 · 합의는 DEC, 내부 결정은 ADR) · 15 폴더는 고정, 기록은 종류별 자리에(ADR·RFC·FDR·HO는 자기 폴더, 그 밖은 records).

## 11. 동시 작업 · 핸드오프

- **기록 하나 = 브랜치 하나 = worktree 하나.** `work.mjs start <ID>` → `.worktrees/<ID>/`, 브랜치 `<type>/<ID>`. main에 제품 코드 직접 커밋 금지(게이트). `rfc/*`는 spike — 코드는 병합되지 않고 기록만 반입. 승격은 `promote`(squash 1커밋). S는 ff 병합, M·L은 PR. 잔존 브랜치·worktree는 lint ⑮. 절차 `.harness/runbooks/work.md`.
- 다른 세션·다른 회사 에이전트와는 `docs/handoffs/HO-…/`로만 주고받는다. 차례마다 새 파일, 남의 파일은 고치지 않는다. 상태는 lint ⑪. 절차 `.harness/runbooks/handoff.md`.
