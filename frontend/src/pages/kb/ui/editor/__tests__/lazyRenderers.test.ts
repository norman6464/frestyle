import { describe, it, expect } from 'vitest';
import { renderMath } from '../lazyRenderers';

/*
 * 数式の描画の口を本物の KaTeX で確かめる（KaTeX は DOM が無くても文字列へ描ける）。
 * 図（mermaid）は SVG の寸法の計算に本物のブラウザが要るので、Storybook の見本で確かめる。
 */
describe('renderMath（KaTeX）', () => {
  it('式を HTML（見た目）と MathML（読み上げ）にする', async () => {
    const result = await renderMath('E=mc^2', false);
    expect('html' in result).toBe(true);
    if (!('html' in result)) return;
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('<math');
  });

  it('行の数式は display の形で描く', async () => {
    const result = await renderMath('\\sum_{i=1}^n i', true);
    expect('html' in result && result.html.includes('katex-display')).toBe(true);
  });

  it('読めない式は例外にせず、理由を返す', async () => {
    const result = await renderMath('\\frac{1}{', false);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/KaTeX parse error/);
  });

  it('trust: false — \\href の javascript: はリンクにしない', async () => {
    const result = await renderMath('\\href{javascript:alert(1)}{x}', false);
    const out = 'html' in result ? result.html : result.error;
    expect(out).not.toMatch(/href="javascript:/);
  });

  it('maxExpand — 自分を呼び続けるマクロは描かずに理由を返す', async () => {
    const result = await renderMath('\\def\\a{\\a}\\a', false);
    expect('error' in result).toBe(true);
  });

  it('利用者の文字は HTML として解釈しない', async () => {
    const result = await renderMath('\\text{<img src=x onerror=alert(1)>}', false);
    expect('html' in result).toBe(true);
    if (!('html' in result)) return;
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
  });
});
