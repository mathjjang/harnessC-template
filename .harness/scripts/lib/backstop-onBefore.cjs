// backstop-onBefore.cjs — mockup-diff.mjs가 생성한 backstop 시나리오의 onBefore (playwright 엔진).
// 구현 쪽(test) 캡처 전에 프로젝트의 로그인 모듈을 부른다 — 경로는 harness.yaml mockup.login (run이 HARNESS_MOCKUP_LOGIN으로 넘긴다).
// 모듈 계약: export default async (page, env, { origin }) — 로그인 후 반환. 오리진은 캡처 URL과 같아야 한다(로그인만 다른 포트로 가면 비로그인 화면이 조용히 찍힌다).
// 기준본(목업 file://)에는 로그인이 없다. 프로젝트 지식은 모듈 안에만 있다.
const { pathToFileURL } = require('url');

module.exports = async (page, scenario, vp, isReference) => {
  if (isReference) return;
  const mod = process.env.HARNESS_MOCKUP_LOGIN;
  if (!mod) return;
  const m = await import(pathToFileURL(mod).href);
  await (m.default || m)(page, process.env, { origin: process.env.HARNESS_MOCKUP_ORIGIN });
};
