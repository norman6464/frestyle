import { describe, it, expect } from 'vitest';
import { compilerIdFilter } from './react-compiler.js';

/**
 * コンパイラをかけるかどうかの判定が、react-compiler-scope.js の範囲と除外のとおりになることを
 * 確かめる。lint・check:compiler・ビルドの 3 つが同じ定数を読む前提なので、ビルド側の判定だけが
 * ずれると「lint が外しているフォルダをビルドだけがコンパイルする」ことになる。
 */
const ROOT = '/work/frontend/';
const matches = (id) => {
  const { include, exclude } = compilerIdFilter();
  const path = ROOT + id;
  return include.some((re) => re.test(path)) && !exclude.some((re) => re.test(path));
};

describe('compilerIdFilter', () => {
  it('範囲の中の部品と hook にはかける', () => {
    expect(matches('src/pages/kb/ui/KbPage.tsx')).toBe(true);
    expect(matches('src/pages/kb/model/useKbPageDoc.ts')).toBe(true);
    expect(matches('src/widgets/app-shell/ui/Header.tsx')).toBe(true);
    expect(matches('src/entities/kb/model/types.ts')).toBe(true);
  });

  it('範囲の外（shared・app・lib）にはかけない', () => {
    expect(matches('src/shared/ui/Button.tsx')).toBe(false);
    expect(matches('src/app/App.tsx')).toBe(false);
    expect(matches('src/pages/kb/lib/docPlainText.ts')).toBe(false);
  });

  it('テストと見本は除外する', () => {
    expect(matches('src/pages/kb/ui/__tests__/KbPage.test.tsx')).toBe(false);
    expect(matches('src/pages/kb/ui/KbPage.stories.tsx')).toBe(false);
  });

  it('ナレッジの本文エディタは範囲の中（pages/kb/ui）にあるが除外する', () => {
    expect(matches('src/pages/kb/ui/editor/RichTextEditor.tsx')).toBe(false);
    expect(matches('src/pages/kb/ui/editor/FormatMenuBar.tsx')).toBe(false);
    // フォルダをさらに切っても除外のまま（`**` は深さを問わない）。
    expect(matches('src/pages/kb/ui/editor/nodes/CalloutView.tsx')).toBe(false);
    // 隣の部品はそのままかかる（除外はフォルダだけ）。
    expect(matches('src/pages/kb/ui/KbPageEditor.tsx')).toBe(true);
  });
});
