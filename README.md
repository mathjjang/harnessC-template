# harnessC-template

AI 에이전트와 함께 개발하는 프로젝트를 위한 **방법론 뼈대**. 이 저장소에는 **모든 프로젝트에서 동일하게 동작하는 것만** 있다. 제품·도메인에 따라 달라지는 것은 각 프로젝트의 `rules/`·`docs/`에 쓴다. 방법론의 고도화는 여기서만 한다 — 프로젝트는 `sync-core`로 내려받고, 프로젝트에서 코어를 고치면 린트가 막는다.

- 버전: **0.3.10** · 릴리스 태그 `v0.3.10` · 짝: harnessC-mockup-template `v0.1.8`
- 짝 템플릿: [harnessC-mockup-template](https://github.com/mathjjang/harnessC-mockup-template) — 목업(기획·디자인) 저장소 뼈대. 화면이 있는 프로젝트만 쓴다

---

## 사용법

**선행 조건** — Node 22 이상(CI 기준) · git · `gh` CLI(PR 생성·`protect`·`init separate`·`gc`가 쓴다 — 없으면 그 단계만 안내로 대체) · 화면 대조를 쓰면 `mockup-diff.mjs engine --install`(BackstopJS + Playwright 브라우저 내려받기).

명령은 전부 저장소 루트에서 `node`로 돈다. 에이전트(Claude Code · Codex · Gemini CLI)는 같은 절차를 런북으로 읽는다 — 아래 [에이전트에게 시키기](#에이전트에게-시키기) 참고.

### 1. 새 프로젝트 시작 — 질문으로 설정

```bash
# 템플릿에서 저장소 만들기 — GitHub "Use this template" 또는
gh repo create <owner>/<project> --template mathjjang/harnessC-template --private --clone
cd <project>

# 질문에 답하면 설정·근거 기록까지 끝난다 (--prune: 템플릿 전용 파일 제거)
node init.mjs --interactive --prune
git config core.hooksPath .harness/scripts/git-hooks   # pre-commit 게이트 — 안 하면 scope 밖 커밋·main 직접 커밋·shipped 조건 검사가 로컬에서 돌지 않는다
```

묻는 것 — 반드시 셋, 나머지는 기본값을 보여 주고 한 번에 확인한다.

| # | 질문 | 이것으로 정해지는 것 |
|---|---|---|
| Q1 | 프로젝트 이름 | 이름 치환 |
| Q2 | 동시에 구현하는 사람·에이전트 세션 수 | 병합 방식(1이면 리뷰 판정 뒤 바로 병합 · 2 이상이면 PR) · 필수 승인 수 |
| Q4 | 화면이 있는가, 목업은 누가 만드나(none / self / separate) | 목업 저장소 자리 |
| Q3a·Q3b | 예상 기간(개월) · 기능 규모(small / medium / large) | 기록 양식(lite / standard / full) · 규칙 크기 상한 |
| Q5 | 외부 조직(발주처·협력사)과 같이 보는 문서가 있나 | 협업 저장소 |
| Q6 | 결제·개인정보·의료·공공 납품처럼 사람 사인오프가 필요한 영역이 있나 | 엄격 모드 · 사인오프 접점 |
| Q7 | GitHub 저장소 공개 여부 | 비공개 + PR이면 "CI가 병합을 막지 못한다" 경고 |

결과는 세 곳에 남는다: `harness.yaml`(값 옆에 `# 근거: Q2 …`), `harness.yaml`의 `setup:` 블록(답 원문), 첫 결정 기록 `docs/decisions/ADR-<날짜>-project-setup.md`. 티어(S·M·L)는 고르는 것이 아니라 답에서 나온다 — S: 혼자·짧게 · M: 동시 2명 이상·3개월 초과·규모 medium(FDR 10~50)·외부 조직 · L: 대규모·동시 5명 이상·외부+사인오프.

> 질문 없이 바로: `node init.mjs --name <이름> --tier S|M|L --prune` · 에이전트는 답을 파일로: `node init.mjs --answers answers.json --prune`

그다음 `rules/product.md`(이 제품에서 절대 바뀌지 않는 것)와 `docs/requirements/`(무엇을 만드나)를 채운다.

### 2. 기능 하나 개발 — 기록 · 브랜치 · 작업 폴더

```bash
node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"     # 기능 기록(FDR) 생성 → 머리말 scope: [고칠 경로 glob] 채우고 커밋
node .harness/scripts/work.mjs start FDR-<날짜>-<slug>      # 브랜치 fdr/<ID> + 작업 폴더 .worktrees/<ID>/
cd .worktrees/FDR-<날짜>-<slug>                            # 여기서 구현·시험·커밋 (scope 밖 파일은 커밋이 막힌다)
cd ../.. && node .harness/scripts/work.mjs finish FDR-<날짜>-<slug>
```

- `finish`가 기록을 `shipped`로 올리고 → main 위로 rebase → lint → **리뷰 판정 확인** → 혼자면 바로 병합(ff), 여럿이면 PR을 연다(3절).
- 리뷰 판정은 혼자여도 필요하다 — **다른 세션**의 리뷰어가 기록의 리뷰 칸에 `통과`(또는 `조건부` + 조건)를 적어야 병합된다. 판정이 비었거나 `재작업`이거나 리뷰어가 작성자와 같거나, **판정 뒤에 제품 코드가 바뀌면**(판정 무효 — 다시 리뷰) 병합이 막힌다. ff·PR 공통.
- 시험 결과는 기록의 시험 표에 명령·출력 원문으로, 원문 파일은 기록 폴더의 `evidence/`에. 못 돌린 것은 "미검증"으로 적는다.
- 두 기능이 같은 경로를 고치면 검사가 알린다 — 공유 변경을 작은 기록 하나로 먼저 병합한다.
- 착수 절차 전체: `.harness/runbooks/fdr-start.md` · 브랜치 규칙: `.harness/runbooks/work.md`

**기록 종류** — `new-doc.mjs <종류> <slug> "<제목>"`로만 만든다(손 복사 금지).

| 종류 | 언제 | 자리 |
|---|---|---|
| `rfc` | 접근법을 모를 때 — 타임박스 탐구. spike 코드는 `rfc/<ID>` 브랜치(병합 안 됨), 되면 `work.mjs promote`로 기능 기록에 옮긴다 | `docs/research/` |
| `adr` | 되돌리기 비싼 결정(구조·공개 계약·저장 형식·정책) | `docs/decisions/` |
| `fdr` | 사용자에게 보이는 기능 | `docs/features/` |
| `plan` | 여러 기능으로 나눠야 하는 큰 요청 | `docs/records/` |
| `ho` | 다른 에이전트(다른 회사 포함)에게 맡기기 — 6절 | `docs/handoffs/` |
| `pg` · `hr` · `bl` · `qa` | 정책 공백(사람 결정 필요) · 사람만 할 수 있는 검증 · 이월 · 사람 발견 결함 | `docs/queue/` |
| `inc` · `retro` · `spec` · `runbook` | 사고 · 방법론 회고 · 현재 참인 동작 · 반복 절차 | `docs/records/` · `docs/specs/` · `rules/runbooks/` |

세션 시작 때 `node .harness/scripts/harness-status.mjs`(훅이 자동 실행)가 진행 중인 기능·큐·다음 ID를 보여 준다.

### 3. 여러 명이 같이 — PR 흐름

Q2에 2 이상이라고 답하면 PR 모드다.

```bash
node .harness/scripts/work.mjs protect                  # 저장소당 1회 — main 직접 push 금지 · 필수 검사 harness · 필수 승인
node .harness/scripts/work.mjs finish FDR-…             # push + PR 생성(본문은 기록에서 자동 생성)
#  → GitHub Actions 「harness」가 검사: 규칙 · 브랜치=기록 · scope · 임시 파일 · 리뷰 판정(판정 뒤 제품 코드가 바뀌면 판정 무효 — 다시 리뷰)
#    리뷰 전이라 「판정 없음」으로 실패하는 것이 정상
#  → 리뷰어(구현자와 다른 세션·사람)가 기록의 리뷰 칸에 판정(통과·재작업·조건부)을 쓴다 — risk high면 사람 사인오프도
node .harness/scripts/work.mjs finish FDR-…             # 다시 — PR 본문 갱신 → 검사 통과 → 사람 승인 → GitHub에서 병합
git pull && node .harness/scripts/work.mjs gc --apply   # 병합된 PR의 작업 폴더·브랜치 정리
```

- 로컬 검사(pre-commit)를 `--no-verify`로 건너뛰어도 PR에서 같은 검사가 다시 돈다.
- 리뷰 조건(2절)은 PR에서 CI가 다시 묻는다 — 로컬을 건너뛴 PR도 같은 선에서 막힌다.
- **GitHub Free의 비공개 저장소는 브랜치 보호를 쓸 수 없다** — 검사 실패가 표시되지만 병합 버튼은 막히지 않는다. 공개 저장소 또는 Team/Pro에서만 "막는다"가 성립한다.

### 4. 화면이 있으면 — 목업 대조

```bash
# 목업 저장소 만들기 (Q4에 self라고 답했으면 이미 mockups/가 있다)
node .harness/scripts/mockup-diff.mjs init separate      # 기획·디자인이 따로 — 별도 GitHub 저장소(형제 폴더)
node .harness/scripts/mockup-diff.mjs init embedded      # 개발자가 직접 — 이 저장소 안 mockups/
node .harness/scripts/mockup-diff.mjs engine --install   # 픽셀 대조 엔진(BackstopJS) — PC에 한 번

# 기능마다 — 코드보다 먼저 승격
node .harness/scripts/mockup-diff.mjs promote FDR-… <모듈>/<화면>    # 확정된 목업만 받는다(해시 확인)
#  docs/features/FDR-…/mockup/diff-scenarios.json 에 상태별 경로·클릭·대조 범위를 적는다
APP_ORIGIN=http://localhost:5173 node .harness/scripts/mockup-diff.mjs run FDR-…   # 작업 폴더에서 · 병합 전에
```

- 기준은 언제나 목업이다(기준본 저장·승인 없음). 판정은 숫자로만 — 임계 0.01% 초과는 고치거나 `mockup/deviations.json`에 사유·승인자를 남긴다.
- 대조 기록 없이 `finish`하면 기록이 `shipped`로 오르지 못한다 — 대조는 병합 전에.
- 목업이 다시 확정되면(rev+1) 재승격 → 다시 이식 → 재대조. 절차: `.harness/runbooks/mockup.md`

### 5. 검수 — 기획이 테스트 서버에서 발견한 것

접수는 목업 저장소 `qa/`에서 기획이 한다(목업 템플릿 README). 개발은 **오류** 유형만 가져온다 — 화면·정책을 바꾸고 싶은 건(기획수정)은 목업 저장소에서 먼저 처리된다.

```bash
node .harness/scripts/qa-intake.mjs pull                                    # 오류 건 → docs/queue/QA-…
node .harness/scripts/qa-intake.mjs reply QA-… --state taken --by "<나>"
#  고친다 (해당 기능 기록의 작업 폴더에서)
node .harness/scripts/qa-intake.mjs reply QA-… --state resolved --commit <sha> --steps "<확인 절차>" --by "<나>"
node .harness/scripts/qa-intake.mjs reply QA-… --state verified --by "<리뷰어>"   # 고친 사람과 달라야 한다
node .harness/scripts/qa-intake.mjs status
```

기획이 테스트 서버에서 확인하고 닫는다. 개발자가 직접 발견한 오류는 `new-doc.mjs qa`로 개발 저장소에 바로 접수한다. 절차: `.harness/runbooks/qa.md`

### 6. 다른 에이전트·다른 회사 도구에게 맡기기

```bash
node .harness/scripts/new-doc.mjs ho <slug> "<무엇을 맡기나>"      # docs/handoffs/HO-…/request.md 를 채운다
#  받는 쪽(Codex 등)에게 한 줄: "AGENTS.md를 따르고 docs/handoffs/HO-…/request.md를 처리해"
node .harness/scripts/new-doc.mjs reply HO-… --agent "<에이전트(모델)>"   # 받는 쪽은 새 파일에만 답한다
```

채팅·임시 파일로 주고받지 않는다 — 파일이 남아야 누가 무엇을 어떤 기준으로 넘겼는지 남는다. 절차: `.harness/runbooks/handoff.md`

### 7. 조건이 바뀌면 — 다시 묻기

```bash
node .harness/scripts/setup.mjs --show                         # 지금 답과 판정
node .harness/scripts/setup.mjs --interactive --reconfigure    # 이전 답이 기본값 — 바뀐 것만 고친다
```

사람이 늘었다 · 외부 발주처가 생겼다 · 화면이 생겼다 — 설정·양식·기록(ADR 개정 이력)이 같이 바뀐다. 티어 L로 오르면 11단계 기록 양식을 템플릿에서 받아 온다.

### 8. 템플릿 갱신 받기

```bash
# harness.yaml 의 upstream.ref 를 새 릴리스 태그로 올린 뒤
node .harness/scripts/sync-core.mjs --dry-run      # 무엇이 바뀌나
node .harness/scripts/sync-core.mjs                # 받는다 — 받은 출처·커밋이 .harness/init-manifest.json 에
```

코어(`.harness/`·`.claude/`·`AGENTS.md` 등)만 바뀌고 `rules/`·`docs/`·`harness.yaml`·코드는 건드리지 않는다. 코어를 프로젝트에서 직접 고치면 검사가 막는다 — 고칠 것이 있으면 이 템플릿 저장소에 제안한다.

### 에이전트에게 시키기

절차의 정본은 `.harness/runbooks/*.md`이고, 각 런타임의 입구는 거기서 생성된다(`harness-build.mjs`).

| 하고 싶은 것 | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| 프로젝트 설정 | `/harness-init` | 스킬 `harness-init` | `/harness-init` |
| 기능 착수 | `/fdr-start` | 스킬 `fdr-start` | `/fdr-start` |
| 목업 대조 | `/mockup-diff` | 스킬 `mockup-diff` | `/mockup-diff` |
| 검수 건 처리 | `/qa` | 스킬 `qa` | `/qa` |
| 회의 준비 · 회의록 반영 | `/meeting-prep` · `/meeting-ingest` | 스킬 | 커맨드 |

Gemini CLI는 신뢰된 폴더에서만 프로젝트 커맨드를 싣는다(처음 열 때 신뢰 승인). Git Bash에서 `gemini -p "/명령"`을 칠 때는 `MSYS_NO_PATHCONV=1`이 필요하다.

### 명령 한눈에

| 스크립트 | 하는 일 |
|---|---|
| `init.mjs` (템플릿 전용) | 처음 적용 — `--interactive` · `--answers` · `--name --tier` |
| `setup.mjs` | 질문으로 설정 · 재설정 · `--show` |
| `new-doc.mjs` | 기록 생성 · 핸드오프 응답(`reply`) |
| `work.mjs` | `start` · `finish` · `promote` · `protect` · `pr-body` · `list` · `gc` |
| `mockup-diff.mjs` | `init` · `promote` · `run` · `check` · `engine` |
| `qa-intake.mjs` | `pull` · `reply` · `status` |
| `harness-status.mjs` | 세션 카드 |
| `lint.mjs` · `ci.mjs` | 규칙 검사(로컬) · 서버 게이트(PR) |
| `build-index.mjs` · `harness-build.mjs` | 생성 인덱스 · 런타임 입구 |
| `sync-core.mjs` | 템플릿 갱신 받기 |

---

## 구조 — 모든 프로젝트 동일 / 이 프로젝트만

```
AGENTS.md · CLAUDE.md · GEMINI.md   공통 뼈대 (도구 입구 — 프로젝트명만 치환)      ┐
.harness/   HARNESS.md(방법론) · runbooks/(절차 정본) · scripts · templates           │ 모든 프로젝트 동일
            catalog.yaml · init-manifest.json(코어 해시)                              │ lint ⑫가 지킨다
.claude/    Claude Code 훅·에이전트·경로 규칙 · skills/(생성물)                       │
.agents/ .gemini/   Codex·Gemini CLI 입구 — 런북에서 생성                             │
.github/workflows/harness.yml       서버 게이트(PR)                                   ┘

harness.yaml   프로젝트 설정 (티어·게이트·참조 저장소·setup 답)                       ┐
rules/         product.md(제품 불변) · domain/*.md(도메인 규칙) · runbooks/ · human-only.yaml │ 이 프로젝트만
docs/          requirements/ · decisions/(ADR) · research/(RFC) · features/(FDR) · handoffs/(HO)   │
               · records/(PLAN·MTG·INC·RETRO) · specs/(현재 참인 것) · queue/                        │
mockups/       목업 저장소(embedded일 때만)                                           │
src/ tests/    코드                                                                   ┘
.scratch/      임시 (gitignore · 14일 gc)    .worktrees/   작업 폴더 (gitignore)
```

- **폴더는 늘지 않는다.** `docs/`는 여덟으로 고정이고 새 폴더는 훅·검사가 막는다. 종류별 목록은 `docs/INDEX.generated.md`.
- **증거는 기록 옆.** `docs/<자리>/<ID>/evidence/`.
- 템플릿에만 있는 것: `init.mjs` · `.harness/tiers/` — `--prune`이 지운다.

| 티어(질문의 결과) | 기록 양식 | 병합 | 규칙 상한 |
|---|---|---|---|
| S | lite — `fdr.md` 한 장 + evidence/ | 바로 병합(ff · 리뷰 판정 뒤) | 18KB |
| M | standard — 폴더 7단계 | PR | 25KB |
| L | full — 폴더 11단계 · strict | PR · 승인 2 | 40KB |

## 지금 동작하는 것과 아직 아닌 것

| 동작 | 상태 |
|---|---|
| 질문으로 프로젝트 설정(판정 · 근거 주석 · ADR project-setup · 재설정) | `init.mjs --interactive` · `setup.mjs` active |
| 티어 적용, {{VAR}} 치환, 코어 해시 manifest · 템플릿 갱신 내려받기(릴리스 태그) | `init.mjs` · `sync-core.mjs` active |
| 날짜형 ID 생성(충돌 시 -2), 귀속 머리, FDR manifest·세션 로그·evidence, 핸드오프 응답 채번 | `new-doc.mjs` active |
| 세션 시작 카드, 세션 로그 경고, 모바일 모드 자동 전환 | 훅 active |
| 린트 17종 — 형식·존재·연결(내용 타당성은 리뷰어 몫) | `lint.mjs` active |
| 동시 작업: 기록별 worktree·브랜치, main 직접 커밋 거부, scope 게이트, spike 승격 | `work.mjs` · `check-branch-record` active |
| PR 흐름: PR 자동 생성(본문은 기록에서) · 서버 게이트(리뷰 판정 = 병합 조건) · 원격 보호 · 병합 후 정리 | `work.mjs` · `ci.mjs` · `.github/workflows/harness.yml` active |
| 쓰기 전 거부: 임시 파일·새 폴더 · 참조 저장소 경계 · 리뷰어/테스터 경로 | 훅 active (Claude Code) |
| 확정 목업 승격 · BackstopJS 승인본 픽셀 대조 · 완료 게이트 | `mockup-diff.mjs` active |
| 검수 접수의 개발 쪽 처리(오류만 · 고친 쪽≠검증자) | `qa-intake.mjs` active |
| 런북 → Claude·Codex·Gemini 입구 생성 | `harness-build.mjs` active |
| RUN 원장, FDR close 스펙 병합, metrics | **planned** — `.harness/catalog.yaml` |

## 검증

```bash
node init.mjs --self-test && for s in .harness/scripts/*.mjs .harness/scripts/lib/*.mjs .claude/hooks/guard-*.mjs; do node $s --self-test; done && node .harness/scripts/lint.mjs
node .harness/scripts/ci.mjs     # PR 서버 게이트와 같은 검사(+템플릿이면 코어 전 self-test)
```

## 개정

규칙은 이 템플릿에서만 바뀐다(`.harness/HARNESS.md` §9). 바뀔 때마다 버전을 올려 두 템플릿을 같은 시점에 태그하고, 프로젝트는 `upstream.ref`를 그 태그로 올린 뒤 `sync-core`로 받는다.

## 라이선스 · 만든 사람

- 라이선스: [MIT](LICENSE) — Copyright (c) 2026 Ubion Co., Ltd. (주식회사 유비온)
- 만든 사람: Bong Jin Jang <mathjjang@ubion.co.kr>
- 이 템플릿으로 만든 프로젝트는 자기 라이선스를 고른다 — 프로젝트 생성 때 루트 `LICENSE`는 지워지고, 복사된 도구의 MIT 고지만 `.harness/LICENSE`에 남는다(지우지 않는다 — MIT의 유일한 조건).
