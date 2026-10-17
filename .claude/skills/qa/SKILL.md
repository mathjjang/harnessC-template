---
name: qa
description: 검수 접수의 개발 쪽 처리 — 목업 저장소 qa/의 오류 건을 가져오고(pull), FDR 규율로 고치고, 리뷰어가 검증(verified)해 회신한다. 기획수정·정책공백은 가져오지 않는다. "검수 건 처리", "QA 가져와", "버그 고쳐서 회신" 요청 시.
argument-hint: "pull | reply <ID> --state taken|resolved|verified [--commit <sha>] [--steps \\\"<확인 절차>\\\"] | status"
---
<!-- 생성물: node .harness/scripts/harness-build.mjs · 손으로 편집하지 않는다 — 정본은 .harness/runbooks/qa.md -->

# 검수 처리 — 접수는 기획, 수정은 개발, 닫기는 다시 기획

절차 정본은 `.harness/runbooks/qa.md`이다. 그 파일을 읽고 그대로 따른다. 입력: $ARGUMENTS
