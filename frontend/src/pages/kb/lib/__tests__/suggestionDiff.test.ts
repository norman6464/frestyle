import { describe, it, expect } from 'vitest';
import { computeSuggestionDiff, extractPlainText } from '../suggestionDiff';

describe('extractPlainText', () => {
  it('トップレベルの各ブロックを1行にして改行で繋ぐ', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: '見出し' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '本文の' }, { type: 'text', text: '段落' }] },
      ],
    };
    expect(extractPlainText(doc)).toBe('見出し\n本文の段落');
  });

  it('doc でない・content が無い値は空文字列', () => {
    expect(extractPlainText(null)).toBe('');
    expect(extractPlainText({ type: 'doc' })).toBe('');
    expect(extractPlainText('not a doc')).toBe('');
  });

  it('パースできないブロックはプレースホルダ行になる', () => {
    const doc = { type: 'doc', content: [null, { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] }] };
    expect(extractPlainText(doc)).toBe('[変更あり]\nok');
  });

  it('文字色・蛍光ペンは名前を添えて出す（色だけ差し替えられても差分に現れる）', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '赤い', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
            { type: 'text', text: '強調', marks: [{ type: 'highlight', attrs: { color: 'yellow' } }] },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toBe('赤い [色: red]強調 [蛍光ペン: yellow]');
  });

  it('テキストを持たないブロック（type だけ）は空行になる', () => {
    const doc = { type: 'doc', content: [{ type: 'horizontalRule' }] };
    expect(extractPlainText(doc)).toBe('');
  });

  it('リンクのhrefは疑似テキストとして本文に埋め込まれる', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '経費精算はこちら',
              marks: [{ type: 'link', attrs: { href: 'https://intranet.example/portal' } }],
            },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toBe('経費精算はこちら (https://intranet.example/portal)');
  });

  it('画像のsrcは疑似テキストとして本文に埋め込まれる', () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: 'kb/w1/p1/abc.png' } }] };
    expect(extractPlainText(doc)).toBe('[image: kb/w1/p1/abc.png]');
  });

  it('pageRefの参照先idは疑似テキストとして本文に埋め込まれる', () => {
    const doc = { type: 'doc', content: [{ type: 'pageRef', attrs: { pageId: 'p-target', title: '表示用の題名' } }] };
    expect(extractPlainText(doc)).toBe('[page: p-target]');
  });

  it('codeBlockの言語は疑似テキストとして本文の前に埋め込まれる', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'codeBlock', attrs: { language: 'go' }, content: [{ type: 'text', text: 'fmt.Println()' }] },
      ],
    };
    expect(extractPlainText(doc)).toBe('[code: go]fmt.Println()');
  });

  it('属性が無い・壊れている場合は空文字列で埋める（例外にしない）', () => {
    const doc = { type: 'doc', content: [{ type: 'image' }, { type: 'pageRef', attrs: 'not-an-object' }] };
    expect(extractPlainText(doc)).toBe('[image: ]\n[page: ]');
  });

  it('深すぎる入れ子はスタックを守るため打ち切ってプレースホルダにする', () => {
    let node: unknown = { type: 'text', text: 'いちばん深い' };
    for (let i = 0; i < 500; i++) {
      node = { type: 'paragraph', content: [node] };
    }
    const doc = { type: 'doc', content: [node] };
    expect(() => extractPlainText(doc)).not.toThrow();
    expect(extractPlainText(doc)).toBe('[変更あり]');
  });
});

describe('computeSuggestionDiff', () => {
  it('本文が同じで文字色だけ違う 2 つの本文は、色の差分として現れる', () => {
    const withColor = (color: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '赤い', marks: [{ type: 'textStyle', attrs: { color } }] }] }],
    });
    const diff = computeSuggestionDiff(withColor('red'), withColor('blue'));
    expect(diff).toEqual([
      { type: 'removed', text: '赤い [色: red]' },
      { type: 'added', text: '赤い [色: blue]' },
    ]);
  });

  it('baseDoc が無ければ追加行だけの差分になる', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新規の本文' }] }] };
    const diff = computeSuggestionDiff(undefined, doc);
    expect(diff).toEqual([{ type: 'added', text: '新規の本文' }]);
  });

  it('変わった行だけが追加・削除として色分けされ、同じ行は unchanged になる', () => {
    const base = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '変わらない行' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '古い行' }] },
      ],
    };
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '変わらない行' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '新しい行' }] },
      ],
    };
    const diff = computeSuggestionDiff(base, doc);
    expect(diff).toContainEqual({ type: 'unchanged', text: '変わらない行' });
    expect(diff).toContainEqual({ type: 'removed', text: '古い行' });
    expect(diff).toContainEqual({ type: 'added', text: '新しい行' });
  });

  it('完全に同じ内容なら unchanged だけになる', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '同じ' }] }] };
    const diff = computeSuggestionDiff(doc, doc);
    expect(diff).toEqual([{ type: 'unchanged', text: '同じ' }]);
  });

  it('本文の文字は同じでもリンクのhrefだけ差し替えた提案は追加/削除として見える', () => {
    const linkedText = (href: string) => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '経費精算はこちら', marks: [{ type: 'link', attrs: { href } }] }],
        },
      ],
    });
    const diff = computeSuggestionDiff(linkedText('https://intranet.example/portal'), linkedText('https://evil.example/portal'));
    expect(diff).toContainEqual({ type: 'removed', text: '経費精算はこちら (https://intranet.example/portal)' });
    expect(diff).toContainEqual({ type: 'added', text: '経費精算はこちら (https://evil.example/portal)' });
  });

  it('極端に長い本文は切り詰めてから比較する（そのままjsdiffへ渡さない）', () => {
    const longDoc = (char: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: char.repeat(300_000) }] }],
    });
    const diff = computeSuggestionDiff(longDoc('a'), longDoc('a'));
    // 切り詰め後も両方とも同じ文字の繰り返し+同じ注記なので unchanged だけになり、
    // 前提の300,000文字がそのまま比較されていれば起きるはずのタイムアウト等は発生しない。
    expect(diff.every((line) => line.type === 'unchanged')).toBe(true);
    const totalLength = diff.reduce((sum, line) => sum + line.text.length, 0);
    expect(totalLength).toBeLessThan(300_000);
    expect(diff.some((line) => line.text.includes('以降は長すぎるため比較していません'))).toBe(true);
  });

  it('文字数の上限には収まっていても、行数（≒編集距離）が大きすぎる場合はnoteの1行だけを返す', () => {
    // base/new を完全に重ならない数値の並びにして、編集距離が「全行削除+全行追加」の
    // 最大値になるようにする（一致する行が1つもない）。文字数自体は上限(200,000)未満に
    // 収まるように短い数字だけで25,000行ずつ作り、切り詰め処理とは無関係に
    // maxEditLength だけで note に落ちることを確かめる。
    const lines = (start: number) => Array.from({ length: 25_000 }, (_, i) => String(start + i)).join('\n');
    const base = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: lines(0) }] }] };
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: lines(25_000) }] }] };
    const diff = computeSuggestionDiff(base, doc);
    expect(diff).toEqual([
      { type: 'note', text: '差分が大きすぎるため計算できませんでした。採用する前に内容を直接確認してください。' },
    ]);
  });
});
