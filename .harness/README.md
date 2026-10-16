# .harness — 기계 장치 (사람은 열지 않아도 된다)

| 폴더 | 내용 |
|---|---|
| `scripts/` | 세션 카드·생성기·린트·인덱스·게이트 (`git config core.hooksPath .harness/scripts/git-hooks`) |
| `templates/` | 기록 템플릿 — 손 복사 금지, `scripts/new-doc.mjs`가 쓴다 |
| `packs/<팩>/` | 팩의 설정·복사될 파일·뼈대. 팩의 **규칙**은 `rules/packs/<팩>.md` |
| `catalog.yaml` | 도구 상태 정본 — 규칙은 active 도구만 참조한다 |
| `init-manifest.json` | 템플릿 적용 기록 (생성물) |
