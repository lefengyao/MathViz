/* 3D / 图论交互专项测试：在真实 Chromium 里加载 viewer.html，
   用合成的 pointer 事件验证旋转、点选高亮、信息栏、双击复位、onPick 回调。 */
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const { chromium } = req('C:/Users/15610/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWER = path.join(ROOT, 'dist', 'extension', 'viewer.html');
const CHROME = 'C:/Users/15610/AppData/Local/ms-playwright/chromium-1247/chrome-win64/chrome.exe';

let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

/* 在页面里对 svg 上某一点派发 pointer 序列（tap=true 只按不拖） */
const gesture = (page, sel, dx, dy, tap) => page.evaluate(({ sel, dx, dy, tap }) => {
  const svg = document.querySelector(sel);
  const r = svg.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x0, clientY: y0, pointerId: 1 }));
  if (!tap) {
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy, pointerId: 1 }));
  }
  svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x0 + (tap ? 0 : dx), clientY: y0 + (tap ? 0 : dy), pointerId: 1 }));
}, { sel, dx, dy, tap });

/* 对某个具体元素做「点一下」：pointerdown 落在元素上（target=元素），up 冒泡回 svg */
const tapEl = (page, findJs) => page.evaluate((findJs) => {
  const el = new Function('return ' + findJs)();
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  return true;
}, findJs);

const svgTexts = (page) => page.evaluate(() =>
  [].slice.call(document.querySelectorAll('#fig svg text')).map((x) => x.textContent).join('|'));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(VIEWER).href);

/* —— 场景一：3D 拖拽旋转（模型不写 draw，纯内置重放） —— */
await page.evaluate(() => {
  document.getElementById('fig').innerHTML = '';
  const code = [
    "var S = MK.space({box:[40,26,600,340], range:2.6, title:'立方体'});",
    "document.getElementById('fig').appendChild(S.svg);",
    "S.box([0,0,0],[1,1,1],{color:'blue', opacity:0.1});",
    "S.axes();"
  ].join('\n');
  new Function(code)();
});
{
  const d1 = await page.evaluate(() => document.querySelector('#fig svg path').getAttribute('d'));
  const n1 = await page.evaluate(() => document.querySelectorAll('#fig svg *').length);
  await gesture(page, '#fig svg', 80, 30, false);
  const d2 = await page.evaluate(() => document.querySelector('#fig svg path').getAttribute('d'));
  const n2 = await page.evaluate(() => document.querySelectorAll('#fig svg *').length);
  t('3D 拖拽改变视图（内置重放，无 redraw 闭包）', d1 !== d2);
  t('拖拽后图元数量不增长（重放不叠加，含 line）', n1 === n2, n1 + ' vs ' + n2);

  await page.evaluate(() => {
    document.querySelector('#fig svg').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  const d3 = await page.evaluate(() => document.querySelector('#fig svg path').getAttribute('d'));
  t('双击复位回到初始视角', d3 === d1);
}

/* —— 场景二：面点选 → 高亮 + 信息栏 + onPick —— */
await page.evaluate(() => {
  document.getElementById('fig').innerHTML = '';
  window.__picked = 'unset';
  const code = [
    "var S = MK.space({box:[40,26,600,340], range:2.6, title:'两个面'});",
    "document.getElementById('fig').appendChild(S.svg);",
    "S.face([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], {color:'blue', info:'这是 xy 平面的单位正方形'});",
    "S.face([[2,0,0],[3,0,0],[3,1,0],[2,1,0]], {color:'coral', info:'旁边那个面'});",
    "S.onPick(function(info){ window.__picked = info; });"
  ].join('\n');
  new Function(code)();
});
{
  const op = (n) => page.evaluate((k) => document.querySelectorAll('#fig svg path')[k], n);
  const ok1 = await tapEl(page, "document.querySelectorAll('#fig svg path')[0]");
  t('面元素可命中', ok1 === true);
  const opInfoShown = (await svgTexts(page)).indexOf('单位正方形') >= 0;
  t('点面后信息栏显示 info 文字', opInfoShown, await svgTexts(page));
  const picked1 = await page.evaluate(() => window.__picked);
  t('onPick 回调收到 info', picked1 === '这是 xy 平面的单位正方形', String(picked1));
  const hlOpacity = await page.evaluate(() => document.querySelectorAll('#fig svg path')[0].getAttribute('fill-opacity'));
  const normalOpacity = await page.evaluate(() => document.querySelectorAll('#fig svg path')[1].getAttribute('fill-opacity'));
  t('被点的面高亮（透明度提高）', parseFloat(hlOpacity) > parseFloat(normalOpacity), hlOpacity + ' vs ' + normalOpacity);

  /* 再点旁边那个面 → 切换高亮；点空白 → 取消 */
  await tapEl(page, "document.querySelectorAll('#fig svg path')[1]");
  const picked2 = await page.evaluate(() => window.__picked);
  t('点另一个面切换 info', picked2 === '旁边那个面', String(picked2));

  await gesture(page, '#fig svg', 0, 0, true);
  const picked3 = await page.evaluate(() => window.__picked);
  const infoGone = (await svgTexts(page)).indexOf('单位正方形') < 0 && (await svgTexts(page)).indexOf('旁边那个面') < 0;
  t('点空白取消选中并清空信息栏', picked3 === null && infoGone, String(picked3));
}

/* —— 场景三：solid 的 faceInfo 按面显示 —— */
await page.evaluate(() => {
  document.getElementById('fig').innerHTML = '';
  const code = [
    "var S = MK.space({box:[40,26,600,340], range:2.6, title:'立方体'});",
    "document.getElementById('fig').appendChild(S.svg);",
    'S.box([0,0,0],[1,1,1],{color:"blue", opacity:0.12,',
    '  faceInfo:["下面 z=0","顶面 z=2","前面 y=0","后面 y=2","左面 x=0","右面 x=2"]});'
  ].join('\n');
  new Function(code)();
});
{
  /* 找一个可见的拾取面直接点 */
  const has = await page.evaluate(() => {
    const paths = [].slice.call(document.querySelectorAll('#fig svg path'));
    for (const p of paths) {
      if (p.__mvPick) {
        const r = p.getBoundingClientRect();
        if (r.width > 2) return true;
      }
    }
    return false;
  });
  t('solid 有可点击的可见面', has);
  if (has) {
    await tapEl(page, "[].slice.call(document.querySelectorAll('#fig svg path')).find(function(p){return p.__mvPick && p.getBoundingClientRect().width>2;})");
    const txt = await svgTexts(page);
    t('solid 面信息显示 faceInfo 对应项', /z=|y=|x=/.test(txt), txt);
  }
}

/* —— 场景四：图论节点点选 —— */
await page.evaluate(() => {
  document.getElementById('fig').innerHTML = '';
  window.__gpicked = 'unset';
  const code = [
    "var G = MK.graph({box:[40,24,600,340], directed:false,",
    "  nodes:[{id:'A',x:220,y:100,fixed:true,info:'起点 A，度数 2'},{id:'B',x:460,y:100,fixed:true,info:'终点 B'},{id:'C',x:340,y:240,fixed:true}],",
    "  edges:[['A','B',4],['B','C',2],['A','C',1]], title:'点选测试'});",
    "document.getElementById('fig').appendChild(G.svg);",
    "G.layoutCircle();",
    "G.draw();",
    "G.onPick(function(id){ window.__gpicked = id; });"
  ].join('\n');
  new Function(code)();
});
{
  const has = await page.evaluate(() => {
    return [].slice.call(document.querySelectorAll('#fig svg circle')).some((x) => x.__mvNode === 'A');
  });
  t('图论节点可拾取', has);
  if (has) {
    await tapEl(page, "[].slice.call(document.querySelectorAll('#fig svg circle')).find(function(x){return x.__mvNode==='A';})");
    /* 图论走的是 click 事件，补一个 click */
    await page.evaluate(() => {
      const circ = [].slice.call(document.querySelectorAll('#fig svg circle')).find((x2) => x2.__mvNode === 'A');
      circ.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const g1 = await page.evaluate(() => window.__gpicked);
    const infoShown = (await svgTexts(page)).indexOf('度数 2') >= 0;
    t('点节点触发 onPick 回调', g1 === 'A', String(g1));
    t('节点 info 显示在信息栏', infoShown, await svgTexts(page));
    const sw = await page.evaluate(() => {
      const c = [].slice.call(document.querySelectorAll('#fig svg circle')).find((x2) => x2.__mvNode === 'A');
      return parseFloat(c.getAttribute('stroke-width'));
    });
    t('选中节点描边加粗', sw >= 3, String(sw));
  }
}

await browser.close();
console.log('\n交互测试: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
