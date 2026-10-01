import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { filterLanguages, languageLabel, CODE_BLOCK_LANGUAGES } from '../codeBlockLanguages';
import { lowlight } from '../schemaExtensions';

async function setup(codeText = 'SELECT 1;', language: string | null = null) {
  let editor: Editor | null = null;
  render(
    <RichTextEditor
      value={{
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language },
            content: [{ type: 'text', text: codeText }],
          },
        ],
      }}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor! as Editor };
}

describe('codeBlockLanguages（純関数）', () => {
  it('一覧の言語はすべて lowlight に登録済み', () => {
    const registered = new Set(lowlight.listLanguages());
    for (const language of CODE_BLOCK_LANGUAGES) {
      expect(registered.has(language.id), `${language.id} が未登録`).toBe(true);
    }
  });

  it('languageLabel は表示名を返し、未知 id はそのまま・null はプレーンテキスト', () => {
    expect(languageLabel('sql')).toBe('SQL');
    expect(languageLabel(null)).toBe('プレーンテキスト');
    expect(languageLabel('unknown-lang')).toBe('unknown-lang');
  });

  it('filterLanguages は表示名・id の部分一致で絞り込む', () => {
    expect(filterLanguages('')).toHaveLength(CODE_BLOCK_LANGUAGES.length);
    expect(filterLanguages('type').map((l) => l.id)).toContain('typescript');
    expect(filterLanguages('SQL').map((l) => l.id)).toContain('sql');
    expect(filterLanguages('zzz')).toHaveLength(0);
  });
});

describe('コードブロック NodeView（統合）', () => {
  it('言語未指定はプレーンテキスト表示で、コードがそのまま描画される', async () => {
    await setup('plain code', null);
    expect(screen.getByRole('button', { name: /コードの言語を選択/ })).toHaveTextContent('プレーンテキスト');
    expect(screen.getByText('plain code')).toBeInTheDocument();
  });

  it('言語バッジ→メニュー→選択で attrs.language が更新されハイライトが付く', async () => {
    const { editor } = await setup('SELECT id FROM users;', null);
    fireEvent.click(screen.getByRole('button', { name: /コードの言語を選択/ }));
    expect(screen.getByRole('listbox', { name: 'コードの言語' })).toBeInTheDocument();

    // 検索で絞り込んで SQL を選択。
    fireEvent.change(screen.getByLabelText('言語を検索'), { target: { value: 'sql' } });
    // 押すのは option 自身（option の中に押せるものを入れ子にしない形へ改めた）。
    fireEvent.click(screen.getByRole('option', { name: /SQL/ }));

    await waitFor(() => {
      expect(editor.getJSON().content?.[0]?.attrs?.language).toBe('sql');
    });
    // code 要素のクラスと、lowlight のトークン（hljs-*）が描画されること。
    await waitFor(() => {
      const code = document.querySelector('code.language-sql');
      expect(code).not.toBeNull();
      expect(code!.querySelector('[class*="hljs-"]')).not.toBeNull();
    });
    // メニューは閉じる。
    expect(screen.queryByRole('listbox', { name: 'コードの言語' })).not.toBeInTheDocument();
  });

  it('言語を切り替えるとバッジ表示も変わる', async () => {
    await setup('const a = 1;', 'javascript');
    expect(screen.getByRole('button', { name: /コードの言語を選択/ })).toHaveTextContent('JavaScript');
  });

  it('コピーでブロック全文がクリップボードへ渡り、完了表示になる', async () => {
    // navigator 全体を置換すると tiptap の環境判定（platform 参照）が壊れるため clipboard だけ差し替える。
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await setup('COPY ME;', 'sql');
      fireEvent.click(screen.getByRole('button', { name: 'コードをコピー' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('COPY ME;'));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'コピーしました' })).toBeInTheDocument(),
      );
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('スラッシュ/コマンドからの codeBlock 変換も NodeView で描画される（ノード名互換）', async () => {
    const { editor } = await setup('x', null);
    act(() => {
      editor.commands.setContent(emptyRichDoc());
      editor.chain().focus().toggleCodeBlock().run();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /コードの言語を選択/ })).toBeInTheDocument(),
    );
  });

  // language は class 名にそのまま埋め込まれる（"language-" + language）。API から doc を
  // 直接書き込める経路があるため、許可リストに無い値（空白混じりの class 注入を含む）が
  // 保存されていても、描画側で必ず既定（plaintext）へ丸めることを固定する
  // （backend 側の保存時検査 parseBlockNode / normalizeBlockAttrs とは独立の防御線）。
  it('許可リストに無い language は class 注入を許さずプレーンテキストへ丸める', async () => {
    await setup('x', 'go fixed inset-0 z-50 bg-white');
    const code = document.querySelector('code');
    expect(code).not.toBeNull();
    expect(code).toHaveClass('language-plaintext');
    expect(code!.className).not.toContain('fixed');
    expect(code!.className).not.toContain('inset-0');
    // バッジの表示名も、許可リストに無い値をそのまま出さない（既定表示へ丸める）。
    expect(screen.getByRole('button', { name: /コードの言語を選択/ })).toHaveTextContent('プレーンテキスト');
  });
});
