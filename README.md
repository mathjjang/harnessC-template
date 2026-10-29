# harnessC-template

AI 에이전트와 함께 개발하는 프로젝트를 위한 방법론 템플릿.

- 버전 0.4.0
- 짝 템플릿: [harnessC-mockup-template](https://github.com/mathjjang/harnessC-mockup-template) v0.2.0. 화면이 있는 프로젝트에서 목업(기획·디자인) 저장소로 쓴다.

## 준비물

Node 22 이상, git, gh CLI가 필요하다. gh CLI가 없으면 PR 생성 같은 단계는 해야 할 일을 안내만 한다. 화면 대조를 쓰려면 `node .harness/scripts/mockup-diff.mjs engine --install`을 PC에서 한 번 실행한다.

명령은 모두 저장소 루트에서 실행한다.

## 1. 새 프로젝트 만들기

```bash
gh repo create <owner>/<project> --template mathjjang/harnessC-template --private --clone
cd <project>
node init.mjs --interactive --prune
git config core.hooksPath .harness/scripts/git-hooks
```

GitHub의 "Use this template" 버튼으로 만들어도 된다. `init.mjs`가 묻는 질문에 답하면 설정이 끝나고, 마지막 줄은 커밋 검사를 켠다.

| 질문 | 답에 따라 정해지는 것 |
|---|---|
| 프로젝트 이름 | 프로젝트 이름 |
| 동시에 구현하는 사람·에이전트 수 | 1이면 바로 병합, 2 이상이면 PR |
| 화면이 있는가, 목업은 누가 만드나 | 목업 저장소 위치 |
| 예상 기간, 기능 규모 | 기록 양식(lite, standard, full) |
| 외부 조직과 같이 보는 문서가 있나 | 협업 저장소 |
| 결제·개인정보·의료·공공 납품처럼 사람 승인이 필요한 영역이 있나 | 엄격 모드 |
| GitHub 저장소 공개 여부 | 비공개이면서 PR을 쓰면 경고 |

질문 없이 만들려면 `node init.mjs --name <이름> --tier S|M|L --prune`을 쓴다.

설정이 끝나면 `rules/product.md`(제품에서 바뀌지 않는 것)와 `docs/requirements/`(만들 것)를 채운다.

## 2. 기능 하나 개발하기

```bash
node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"
node .harness/scripts/work.mjs start FDR-<날짜>-<slug>
cd .worktrees/FDR-<날짜>-<slug>
# 구현하고 커밋한다
cd ../..
node .harness/scripts/work.mjs finish FDR-<날짜>-<slug>
```

1. `new-doc`이 기능 기록을 만든다. 기록 머리말의 `scope:`에 고칠 경로를 적고 커밋한다.
2. `work start`가 이 기능 전용 브랜치와 작업 폴더를 만든다. 작업 폴더에서 구현한다. `scope` 밖의 파일은 커밋되지 않는다.
3. 시험 결과는 기록의 시험 표에 적고, 출력 원문은 기록 폴더의 `evidence/`에 둔다. 돌리지 못한 시험은 "미검증"이라고 적는다.
4. 다른 세션의 리뷰어가 기록의 리뷰 칸에 `통과`를 적는다. 혼자 개발해도 필요하다. 판정을 받은 뒤 코드를 고쳤으면 다시 리뷰받는다.
5. `work finish`는 혼자 개발하면 바로 병합하고, 여럿이면 PR을 연다.

두 기능이 같은 파일을 고치면 검사가 알려 준다. 공통으로 바꿀 부분을 작은 기록 하나로 먼저 병합한다.

자세한 절차는 `.harness/runbooks/fdr-start.md`에 있다.

### 기록 종류

기록은 `node .harness/scripts/new-doc.mjs <종류> <slug> "<제목>"`으로 만든다.

| 종류 | 언제 쓰나 | 위치 |
|---|---|---|
| `rfc` | 방법을 모를 때 기간을 정해 조사한다 | `docs/research/` |
| `adr` | 되돌리기 어려운 결정을 남긴다 | `docs/decisions/` |
| `fdr` | 사용자에게 보이는 기능을 만든다 | `docs/features/` |
| `plan` | 큰 요청을 여러 기능으로 나눈다 | `docs/records/` |
| `ho` | 다른 에이전트에게 일을 맡긴다 | `docs/handoffs/` |
| `pg`, `hr`, `bl`, `qa` | 사람이 정할 정책, 사람만 할 수 있는 검증, 미룬 일, 사람이 찾은 결함 | `docs/queue/` |
| `inc`, `retro` | 사고 기록, 회고 | `docs/records/` |
| `spec` | 지금 동작하는 기능의 스펙 | `docs/specs/` |
| `runbook` | 반복하는 절차 | `rules/runbooks/` |

세션을 시작하면 진행 중인 기능과 처리할 큐가 자동으로 표시된다.

## 3. 여러 명이 함께 개발하기

동시에 구현하는 사람이 2 이상이면 PR로 병합한다.

```bash
node .harness/scripts/work.mjs protect           # 저장소마다 한 번
node .harness/scripts/work.mjs finish FDR-…      # PR을 연다
# 리뷰어가 기록에 판정을 적고 커밋한다
node .harness/scripts/work.mjs finish FDR-…      # PR을 갱신한다. 검사와 승인을 거쳐 GitHub에서 병합한다
git pull
node .harness/scripts/work.mjs gc --apply        # 병합된 작업 폴더와 브랜치를 지운다
```

PR을 처음 열면 리뷰 판정이 없어서 검사가 실패한다. 정상이다. 위험도를 high로 둔 기능은 사람 승인도 받아야 한다.

GitHub Free의 비공개 저장소에서는 브랜치 보호를 쓸 수 없어서, 검사가 실패해도 병합 버튼이 막히지 않는다. 병합을 실제로 막으려면 공개 저장소나 Team·Pro 요금제가 필요하다.

## 4. 화면이 있을 때: 목업 대조

```bash
node .harness/scripts/mockup-diff.mjs init separate      # 목업 저장소를 따로 만든다
node .harness/scripts/mockup-diff.mjs init embedded      # 혼자 개발하면 이 저장소 안 mockups/에 만든다

node .harness/scripts/mockup-diff.mjs promote FDR-… <모듈>/<화면>
APP_ORIGIN=http://localhost:5173 node .harness/scripts/mockup-diff.mjs run FDR-…
```

1. 구현을 시작하기 전에 `promote`로 확정된 목업을 기능 기록에 가져온다.
2. `docs/features/FDR-…/mockup/diff-scenarios.json`에 화면 상태별 경로와 클릭을 적는다.
3. 기록의 스펙에 `mockup/<화면>/policy.md rev N`을 적고, 정책 7절을 시나리오로 옮긴다.
4. 구현한 뒤 작업 폴더에서 `run`으로 목업과 실제 화면을 비교한다. 차이가 0.01%를 넘으면 고치거나 `mockup/deviations.json`에 사유와 승인자를 적는다.

비교 기록이 없으면 기능을 끝낼 수 없다. 목업이 다시 확정되면 1번부터 다시 한다. 자세한 절차는 `.harness/runbooks/mockup.md`에 있다.

## 5. 검수 건 처리

기획자가 테스트 서버에서 찾은 문제는 목업 저장소의 `qa/`에 접수된다. 개발은 그중 오류만 가져와 고친다. 화면이나 정책을 바꾸는 요청은 목업 저장소에서 처리한다.

```bash
node .harness/scripts/qa-intake.mjs pull
node .harness/scripts/qa-intake.mjs reply QA-… --state taken --by "<나>"
# 기능 기록의 작업 폴더에서 고친다
node .harness/scripts/qa-intake.mjs reply QA-… --state resolved --commit <sha> --steps "<확인 절차>" --by "<나>"
node .harness/scripts/qa-intake.mjs reply QA-… --state verified --by "<리뷰어>"
node .harness/scripts/qa-intake.mjs status
```

`verified`는 고친 사람이 아닌 리뷰어가 적는다. 마지막 확인과 종료는 기획자가 한다. 개발자가 직접 찾은 오류는 `new-doc.mjs qa`로 접수한다.

## 6. 다른 에이전트에게 맡기기

```bash
node .harness/scripts/new-doc.mjs ho <slug> "<맡길 일>"
node .harness/scripts/new-doc.mjs reply HO-… --agent "<에이전트(모델)>"
```

`docs/handoffs/HO-…/request.md`를 채운 뒤, 받는 에이전트에게 "AGENTS.md를 따르고 docs/handoffs/HO-…/request.md를 처리해"라고 전한다. 받는 쪽은 `reply`로 만든 새 파일에 답한다.

## 7. 조건이 바뀌었을 때

사람이 늘거나, 외부 발주처나 화면이 새로 생기면 설정을 다시 묻는다.

```bash
node .harness/scripts/setup.mjs --show
node .harness/scripts/setup.mjs --interactive --reconfigure
```

## 8. 템플릿 업데이트 받기

`harness.yaml`의 `upstream.ref`를 새 버전 태그로 바꾼 뒤 실행한다.

```bash
node .harness/scripts/sync-core.mjs --dry-run
node .harness/scripts/sync-core.mjs
```

`rules/`, `docs/`, `harness.yaml`, 코드는 바뀌지 않는다. `.harness/`, `.claude/`, `AGENTS.md`는 프로젝트에서 고치지 말고 이 템플릿 저장소에 제안한다.

## 에이전트에게 시키기

| 할 일 | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| 프로젝트 설정 | `/harness-init` | 스킬 `harness-init` | `/harness-init` |
| 기능 개발 시작 | `/fdr-start` | 스킬 `fdr-start` | `/fdr-start` |
| 목업 대조 | `/mockup-diff` | 스킬 `mockup-diff` | `/mockup-diff` |
| 검수 건 처리 | `/qa` | 스킬 `qa` | `/qa` |
| 회의 준비, 회의록 반영 | `/meeting-prep`, `/meeting-ingest` | 스킬 | 커맨드 |

Gemini CLI는 처음 열 때 폴더를 신뢰한다고 승인해야 프로젝트 커맨드를 불러온다.

## 명령 목록

| 스크립트 | 하는 일 |
|---|---|
| `init.mjs` | 새 프로젝트에 처음 적용 |
| `setup.mjs` | 설정 질문, 재설정 |
| `new-doc.mjs` | 기록 만들기 |
| `work.mjs` | 작업 시작·끝내기, PR, 정리 |
| `mockup-diff.mjs` | 목업 가져오기, 화면 비교 |
| `qa-intake.mjs` | 검수 건 가져오기, 답장 |
| `lint.mjs`, `ci.mjs` | 로컬 검사, PR 검사 |
| `sync-core.mjs` | 템플릿 업데이트 받기 |

## 폴더 구조

모든 프로젝트에 같은 것 (프로젝트에서 고치지 않는다):

```
AGENTS.md, CLAUDE.md, GEMINI.md   에이전트 규칙
.harness/                         방법론, 절차서, 스크립트, 양식
.claude/ .agents/ .gemini/        에이전트별 설정
.github/workflows/harness.yml     PR 검사
```

프로젝트마다 다른 것:

```
harness.yaml   프로젝트 설정
rules/         제품 규칙
docs/          기록 (요구사항, 결정, 조사, 기능, 맡긴 일, 큐 등)
mockups/       목업 (혼자 개발할 때만)
src/ tests/    코드
```

`docs/` 아래 폴더는 정해져 있고 새로 만들 수 없다. 기능마다의 증거는 그 기록 폴더의 `evidence/`에 둔다.

| 규모 | 기록 양식 | 병합 | 늘 읽히는 규칙 크기 상한 |
|---|---|---|---|
| S | `fdr.md` 한 장 | 리뷰 뒤 바로 병합 | 18KB |
| M | 7단계 파일 | PR | 25KB |
| L | 11단계 파일 | PR, 승인 2명 | 40KB |

## 검사

```bash
node .harness/scripts/ci.mjs
```

PR에서 도는 검사와 같다.

## 라이선스

[MIT](LICENSE). Copyright (c) 2026 Ubion Co., Ltd. (주식회사 유비온)

만든 사람: Bong Jin Jang <mathjjang@ubion.co.kr>
