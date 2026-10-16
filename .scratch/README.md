# .scratch — 세션 밖에서도 잠깐 살아야 하는 임시 파일의 유일한 자리

- 프로브 스크립트·로그·중간 산출물은 **여기** 또는 세션 scratchpad(저장소 밖)에 둔다. 루트·`scripts/`·`src/`에 두면 훅(`guard-scratch`)이 막는다.
- 폴더는 `<YYMMDD>-<topic>/`. 14일 지나면 세션 카드가 "오래됨"으로 보고하고 `node scripts/check-clutter.mjs --gc 14 --apply`가 지운다.
- 남겨야 할 것은 여기 두지 않는다: 증거는 FDR `evidence/`, 보존 자산은 `_assets/`, 영구 스크립트는 `scripts/` + `tools/catalog.yaml` 등재.
- git이 무시한다(`.gitignore`). 다른 세션의 파일을 지우지 않는다 — gc만 지운다.
