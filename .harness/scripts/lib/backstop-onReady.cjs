// backstop-onReady.cjs — mockup-diff.mjs가 생성한 backstop 시나리오의 onReady (playwright 엔진).
// 하는 일: ① 구현 쪽만 조작(clicks → keypress → clicksAfter — backstop playwright 엔진은 clickSelectors를 구현하지 않는다)
//          ② 양쪽 모두 애니메이션·전환·캐럿 정지(시간 의존값 정착 — 가리거나 걷어내는 것이 아니다)  ③ 폰트 로드 대기 후 harnessWait 만큼 정착
//          ④ 폰트 검사 결과를 HARNESS_MOCKUP_FONTS/<label>.json 에 기록 — 미로드는 실패하지 않고 전 픽셀을 조용히 오염시키므로 기록기가 오류로 판정한다
// CommonJS인 이유: backstop이 require로 읽는다. 프로젝트 지식은 없다 — 전부 시나리오 객체(harness* 필드)에서 온다.
const fs = require('fs');
const path = require('path');

module.exports = async (page, scenario, vp, isReference) => {
  if (!isReference) {
    for (const sel of scenario.harnessClicks || []) { await page.locator(sel).first().click(); await page.waitForTimeout(300); }
    for (const k of scenario.harnessKeypress || []) { await page.locator(k.selector).first().fill(String(k.text)); }
    for (const sel of scenario.harnessClicksAfter || []) { await page.locator(sel).first().click(); await page.waitForTimeout(300); }
  }
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  await page.waitForTimeout(Number(scenario.harnessWait) || 0);
  const fonts = await page.evaluate(() => {
    const f = getComputedStyle(document.body).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return { family: f, loaded: !document.fonts || document.fonts.check(`12px "${f}"`) };
  });
  const dir = process.env.HARNESS_MOCKUP_FONTS;
  if (dir) {
    const p = path.join(dir, `${scenario.label}.json`);
    let cur = {}; try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 첫 기록 */ }
    cur[isReference ? 'reference' : 'test'] = fonts;
    fs.writeFileSync(p, JSON.stringify(cur));
  }
};
