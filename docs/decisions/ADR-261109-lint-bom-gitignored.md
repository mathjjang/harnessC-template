# ADR-261109-lint-bom-gitignored: lint BOM 검사는 git이 무시하는 파일을 보지 않는다

- 상태: Accepted
- 작성: Claude Code (claude-opus-5-5) · 2026-11-09
- 강제 등급: gate — 집행 수단: `.harness/catalog.yaml` lint.mjs ① (`gitIgnored` — `git check-ignore -z --stdin`)
- 위험: low
- 선행 RFC: 없음
- 관련: automation 2026-11-09 — 받은 자료 폴더(gitignore)의 BOM 파일 하나 때문에 문서 커밋이 pre-commit lint에서 막힘(사용자 "오류나 수정해")
- 정책 소유: technical

> ADR은 되돌리기 비싼 결정에만 쓴다. 결정은 단정문으로. 대안이 비면 "정말 비교했나"를 의심한다.

## 1. Context (왜 지금)

- lint ①(BOM)은 `walk(root)`로 저장소 폴더 아래 파일을 전부 훑는다. 제외하는 것은 `node_modules`·`.git`뿐이다.
- 프로젝트 규칙(automation `rules/product.md`)은 받은 자료에 개인 정보가 있으면 즉시 `.gitignore`에 넣으라고 한다. 받은 자료는 남이 만든 파일이라 BOM이 붙어 있을 수 있다. 그 파일은 커밋되지 않는데도 lint가 위반으로 잡아 pre-commit이 **관련 없는 커밋을 모두** 막았다.
- 받은 자료를 고치는 것(BOM 떼기)은 원본을 바꾸는 일이다. lint를 통과시키려고 원본을 고치거나 저장소 밖으로 옮기게 해서는 안 된다.
- `.worktrees/`(gitignore)도 같은 이유로 매번 훑였다. 각 worktree는 자기 커밋 때 따로 검사된다.

## 2. Decision (무엇을 한다 / 하지 않는다)

- lint ①은 `git check-ignore`가 무시한다고 답한 파일을 보지 않는다. 경로는 `-z`(NUL 구분)로 주고받아 한글 경로가 따옴표·8진수로 바뀌지 않게 한다.
- git 저장소가 아니거나 git이 없으면 지금처럼 전부 검사한다(self-test 표본처럼 git 밖 폴더).
- 추적 중인 파일은 `.gitignore` 패턴에 걸려도 git이 무시하지 않으므로 계속 검사한다(`check-ignore`는 기본으로 추적 파일을 무시로 보지 않는다).
- self-test: git 표본 저장소에 무시 폴더(한글 이름)의 BOM 파일 → 알리지 않는다(양성 대조), 무시되지 않는 BOM 파일 → 알린다(부정).
- 하지 않는 것: 다른 lint 항목의 범위는 바꾸지 않는다. 그 항목들은 `docs/`·`rules/`·`.harness/`처럼 정해진 자리만 본다.

## 3. Alternatives

| 대안 | 장점 | 탈락 사유 |
|---|---|---|
| 받은 자료의 BOM을 뗀다 | lint 그대로 | 받은 원본을 바꾼다. 다음 자료마다 되풀이된다 |
| 받은 자료를 저장소 밖으로 옮긴다 | lint 그대로 | 프로젝트가 정한 자리(`root_allow`·gitignore)를 lint가 못 쓰게 한다 |
| `git ls-files`(추적 + 스테이징)만 검사 | 커밋될 것만 본다 | 아직 `git add` 안 한 새 파일의 BOM을 커밋 전에 못 본다 — 지금보다 약해진다 |
| lint에 제외 목록 설정 추가 | 명시적 | `.gitignore`와 같은 목록을 두 군데 둔다 |

## 4. Consequences (득실 · 후속 작업 · 되돌릴 때 비용)

- 득: gitignore한 받은 자료·로컬 비밀·`.worktrees/`가 lint를 막지 않는다. 큰 `.worktrees/`를 매번 읽지 않는다.
- 실: git 프로세스 한 번이 더 돈다(경로 목록을 stdin으로 한 번에).
- 후속: 프로젝트는 `sync-core`로 받는다. 설정 변경 없음.
- 되돌릴 때: lint.mjs ① 세 줄과 `gitIgnored`를 빼면 된다.

## 개정 이력

| 날짜 | 에이전트(모델) | 수정 부위 | 요지 |
|---|---|---|---|
| 2026-11-09 | Claude Code (claude-opus-5-5) | 전체 | 최초 작성 |
