# .harness — 방법론 (모든 프로젝트 동일 · 여기서 고치지 않는다)

템플릿 `harnessC-template`의 사본이다. `init-manifest.json`의 해시와 다르면 lint ⑫가 막는다. 고칠 것은 템플릿에서 고치고 `node .harness/scripts/sync-core.mjs --from <템플릿>`으로 내려받는다.

| 항목 | 내용 |
|---|---|
| `HARNESS.md` | 방법론 코어 규칙 — 로딩 순서·라우팅·ID·FDR·게이트·증거·큐·기록·REP·핸드오프 |
| `runbooks/` | 코어 절차 — `handoff.md`(에이전트 간) · `collab.md`(외부 조직 협업) |
| `scripts/` | 세션 카드·생성기·린트·인덱스·게이트·sync-core (`git config core.hooksPath .harness/scripts/git-hooks`) |
| `templates/` | 기록 템플릿 — 손 복사 금지, `scripts/new-doc.mjs`가 쓴다. `collab-skeleton/`은 협업 저장소 뼈대 |
| `catalog.yaml` | 도구 상태 정본 — 규칙은 active 도구만 참조한다 |
| `init-manifest.json` | 템플릿 적용 기록과 코어 해시 (생성물) |
| `tiers/` | 템플릿에만 — S·L 오버레이 |
