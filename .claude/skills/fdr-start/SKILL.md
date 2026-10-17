---
name: fdr-start
description: FDR 착수 절차 — 생성·출처 확인·사실 대조·델타 스펙·일괄 질의·위험 등급. "FDR 시작", "기능 개발 착수", "새 FDR" 요청 시 사용.
argument-hint: "<slug> \"<제목>\" [--profile lite|standard|full]"
---

# FDR 착수 (Stage spec)

1. **생성**: `node .harness/scripts/new-doc.mjs fdr <slug> "<제목>"` — 티어가 프로파일을 정한다. 손 복사 금지. spike(RFC)에서 승격이면 대신 `work.mjs promote <RFC-ID> <slug> "<제목>"`.
2. **출처·범위**: `manifest.yaml`(lite는 `fdr.md` 머리말) `source_req`에 confirmed REQ만. 없으면 요구사항 층에 먼저(`docs/requirements/`). `scope:`에 이 FDR이 고칠 제품 경로 glob을 적는다 — 린트가 다른 활성 FDR과의 겹침을 알린다. 겹치면 공유 변경을 별도 lite FDR로 먼저 병합.
2a. **브랜치**: 기록을 커밋한 뒤 `node .harness/scripts/work.mjs start <FDR-ID>` → `.worktrees/<FDR-ID>/`에서 작업한다. 끝나면 `work.mjs finish <FDR-ID>`(게이트→병합→정리). 검색은 `rg`(gitignore 존중)로.
3. **사실 대조**: 마지막 핀 이후 바뀐 요구·정책 절만 대조해 `일치/불일치/대응없음/검증불가`. 불일치는 PG로, AC를 임의 수정하지 않는다.
4. **델타 스펙**: `docs/specs/<capability>/spec.md` 대비 ADDED/MODIFIED/REMOVED로 쓴다. 시나리오마다 WHEN/THEN·단언 등급·계층.
5. **위험 등급**: 보안·스키마·공개 API·저장 형식·결제에 닿으면 `risk: high`. `gate_mode: fast`는 AC 출처가 승인된 REQ/FDR이고 새 정책 0건일 때만.
6. **일괄 질의**: 문제·질문·PG 후보를 표 하나로 모아 접점 ①에 낸다. risk low는 무응답 시 기본값으로 진행.
7. **사람 검증**: design에서 `rules/human-only.yaml` 축에 해당하는 AC만 human 큐 후보로 표시.
8. 세션 끝: `session-log.md` 4줄(완료·가설·미결·재개점).
