# AGENTS.md — {{PROJECT_NAME}} 에이전트 운영 규칙

> 하네스C 코어 v0.1.0 · 모든 에이전트(Claude Code·Codex·Gemini·Cursor 등) 공통. 이 파일은 모든 프로젝트에서 동일하다(프로젝트명만 다름 — lint ⑫). 충돌 시 `rules/product.md`(제품 불변) → `.harness/HARNESS.md`(방법론) → 이 파일 순으로 이긴다.
> 지원 매트릭스(v0.1): 쓰기 전 훅은 **Claude Code**에만 있다. 다른 런타임은 pre-commit 게이트만 — 아래 규칙을 커밋 전 스스로 점검한다.

## 가장 먼저

0. `rules/product.md`(제품 불변)를 읽는다 — Claude Code·Gemini CLI는 자동 import, 그 밖은 직접. `rules/domain/`은 해당 작업 때.
1. `.harness/HARNESS.md` §1 로딩 순서대로 읽는다. 전체 eager-load 금지.
2. 세션 시작 카드(`node .harness/scripts/harness-status.mjs`)에서 활성 기록·큐·다음 ID를 본다.
3. 작업 유형을 정하고 `.harness/HARNESS.md` §2 라우팅으로 절차와 산출물을 고른다.

## 지시 집행

1. 지시의 동사와 대상을 끝낼 때까지 다른 것을 하지 않는다. 결함마다 되묻지 않는다. 진짜 결정은 모아서 끝에 한 번 선택지로 묻는다.
2. 검사 범위를 스스로 줄이지 않는다. 줄이면 실측 근거(파일:라인·명령 출력)를 같은 줄에.
3. "통과"는 근거를 확인한 뒤에만. 빌드는 로그가 아니라 산출물로 묻는다.
4. 기록은 원인만. 과정 서사와 코드에 이미 있는 내용을 되풀이하지 않는다.

## Git

- 작업은 worktree 또는 작업 브랜치에서. `main`은 안정화 브랜치. 새 브랜치·PR은 사용자 지시로만.
- 커밋은 pathspec으로(`git commit -m "..." -- <경로>`). 인덱스 전체 커밋 금지.
- 커밋 메시지는 원인·결과만. 트레일러 `Co-Authored-By:`는 실행 환경이 명시한 모델 표기로.
- force-push·히스토리 재작성 금지. push 실패 시 pull 후 재시도 또는 보고.

## 파일

- 모든 텍스트 파일은 UTF-8(BOM 없음). 한글→ASCII 치환으로 "수리"하지 않는다. 깨져 보이면 읽는 쪽 인코딩부터 의심.
- `.harness/`·`.claude/`·이 파일은 템플릿의 사본이다. 여기서 고치지 않는다(lint ⑫가 막는다). 고칠 것은 템플릿 저장소에서 고치고 `node .harness/scripts/sync-core.mjs --from <템플릿>`.
- 생성물(`*.generated.md`, `.harness/init-manifest.json`)은 손으로 고치지 않는다.
- 참조 저장소(`harness.yaml` `references`)는 읽되 고치지 않는다(`mode: read-only`). `trust: external` 협업 저장소는 `writable` 폴더에만 쓰고, 개발 저장소 경로·기록 ID·원가·공수를 쓰지 않는다 — 훅이 거부·질의한다.
- 임시 스크립트·로그는 세션 scratchpad나 `.scratch/`에 만든다. 루트·`docs/`·`rules/`에 새 폴더를 만들면 훅(Claude Code)·pre-commit 게이트가 거부한다 — 우회 플래그는 없다.

## 다중 에이전트

- 구현자·리뷰어·테스터는 다른 세션이다. 리뷰어·테스터는 제품 코드를 고치지 않는다(에이전트 정의가 막는다).
- 다른 에이전트가 활성인 영역은 직접 고치지 않고 큐·리뷰로 전달한다.
- "제안해줘·방안·리서치" 요청의 산출물은 문서다. 코드 수정은 "진행해" 이후에만.

## 다른 에이전트와 주고받기 (다른 세션·Codex·Gemini 등)

- 맡기고 받는 것은 **핸드오프** `docs/records/HO-…/`로만 한다. 채팅·`.scratch/`·남의 문서에 이어 쓰기로 주고받지 않는다. 절차는 `.harness/runbooks/handoff.md`.
- 받았으면: `request.md`의 기준 커밋·쓰기 허용·완료 조건을 따르고 상태 `taken`·맡은 쪽 기입. 응답은 `node .harness/scripts/new-doc.mjs reply <HO-ID> --agent "<자기(모델)>"`가 만든 새 파일에만, 끝나면 `answered`. 남길 재현물은 그 HO 폴더의 `evidence/`. 커밋은 보낸 쪽이 한다.

## 보고

- 보고·질문은 한국어로. 결론 먼저. 완료·미검증·건너뜀을 구분해 적는다.
- Remote Control(휴대폰) 연결 중에는 모바일 모드 규칙(짧게·선택지·파일로)을 따른다.
