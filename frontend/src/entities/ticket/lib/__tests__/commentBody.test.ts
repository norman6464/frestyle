import { describe, it, expect } from 'vitest';
import { readCommentBody, buildCommentBody } from '../commentBody';

/** 段落 1 つだけの塊の列（読み取り結果の大半がこの形になる）。 */
const oneParagraph = (segments: unknown[]) => [{ kind: 'paragraph', segments }];

describe('readCommentBody', () => {
  it('段落の中の text と mention を区間の列に畳む', () => {
    const body = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'お疲れさまです ' },
          { type: 'mention', attrs: { userId: '42' } },
          { type: 'text', text: ' さん' },
        ],
      },
    ];
    expect(readCommentBody(body)).toEqual(
      oneParagraph([
        { kind: 'text', text: 'お疲れさまです ' },
        { kind: 'mention', userId: '42' },
        { kind: 'text', text: ' さん' },
      ]),
    );
  });

  it('段落が 2 つなら塊も 2 つ', () => {
    const body = [
      { type: 'paragraph', content: [{ type: 'text', text: '一段目' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '二段目' }] },
    ];
    expect(readCommentBody(body)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '一段目' }] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: '二段目' }] },
    ]);
  });

  it('bulletList は項目ごとの区間を持つ塊になる', () => {
    const body = [
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一つ目' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二つ目' }] }] },
        ],
      },
    ];
    expect(readCommentBody(body)).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]],
      },
    ]);
  });

  it('orderedList は ordered: true になる', () => {
    const body = [
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '手順' }] }] }],
      },
    ];
    expect(readCommentBody(body)).toEqual([
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: '手順' }]] },
    ]);
  });

  /**
   * 塊が入る前に保存された本文（段落を持たない一列）。本番に既に入っているので、
   * 1 つの段落として読めなければならない（読めないと過去の発言が全部消える）。
   */
  it('塊を持たない古い本文は 1 つの段落として読む', () => {
    const body = [
      { type: 'text', text: 'お疲れさまです ' },
      { type: 'mention', attrs: { userId: '42' } },
    ];
    expect(readCommentBody(body)).toEqual(
      oneParagraph([
        { kind: 'text', text: 'お疲れさまです ' },
        { kind: 'mention', userId: '42' },
      ]),
    );
  });

  it('古い一列と塊が混ざっていても順番は保つ', () => {
    const body = [
      { type: 'text', text: '前置き' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'text', text: '項目' }] }] },
      { type: 'text', text: '後書き' },
    ];
    expect(readCommentBody(body)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '前置き' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: '項目' }]] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: '後書き' }] },
    ]);
  });

  it('mention の userId が数値でも文字列化する', () => {
    expect(readCommentBody([{ type: 'mention', attrs: { userId: 42 } }])).toEqual(
      oneParagraph([{ kind: 'mention', userId: '42' }]),
    );
  });

  it('userId が無い・空文字の mention は落とす', () => {
    expect(readCommentBody([{ type: 'mention', attrs: {} }])).toEqual([]);
    expect(readCommentBody([{ type: 'mention', attrs: { userId: '' } }])).toEqual([]);
  });

  it('未知の type は文字を持っていれば拾い、持っていなければ捨てる', () => {
    expect(readCommentBody([{ type: 'bold', text: '強調' }])).toEqual(oneParagraph([{ kind: 'text', text: '強調' }]));
    expect(readCommentBody([{ type: 'hardBreak' }])).toEqual([]);
  });

  it('知らない塊でも中の文字は拾う（読めない飾りで発言ごと消さない）', () => {
    const body = [{ type: 'blockquote', content: [{ type: 'text', text: '引いた文' }] }];
    expect(readCommentBody(body)).toEqual(oneParagraph([{ kind: 'text', text: '引いた文' }]));
  });

  it('中身が空の塊は落とす', () => {
    expect(readCommentBody([{ type: 'paragraph', content: [] }])).toEqual([]);
    expect(readCommentBody([{ type: 'bulletList', content: [] }])).toEqual([]);
  });

  it('配列でない・要素が record でない本文は空として扱う', () => {
    expect(readCommentBody(null)).toEqual([]);
    expect(readCommentBody('text')).toEqual([]);
    expect(readCommentBody([null, 'x', 42])).toEqual([]);
  });

  it('空文字の text ノードは落とす', () => {
    expect(readCommentBody([{ type: 'text', text: '' }])).toEqual([]);
  });
});

describe('buildCommentBody', () => {
  it('段落を送信できるノード配列に組み立てる', () => {
    expect(
      buildCommentBody([
        {
          kind: 'paragraph',
          segments: [
            { kind: 'text', text: 'こんにちは ' },
            { kind: 'mention', userId: '42' },
          ],
        },
      ]),
    ).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'こんにちは ' },
          { type: 'mention', attrs: { userId: '42' } },
        ],
      },
    ]);
  });

  it('箇条書きは listItem → paragraph の入れ子で送る', () => {
    expect(
      buildCommentBody([
        { kind: 'list', ordered: true, items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]] },
      ]),
    ).toEqual([
      {
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一つ目' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二つ目' }] }] },
        ],
      },
    ]);
  });

  it('空白だけの text は落とす（名指しの区切り空白がこれに当たる）', () => {
    expect(
      buildCommentBody([
        {
          kind: 'paragraph',
          segments: [
            { kind: 'mention', userId: '1' },
            { kind: 'text', text: ' ' },
            { kind: 'mention', userId: '2' },
          ],
        },
      ]),
    ).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { userId: '1' } },
          { type: 'mention', attrs: { userId: '2' } },
        ],
      },
    ]);
  });

  it('userId が空文字の mention は落とす', () => {
    expect(buildCommentBody([{ kind: 'paragraph', segments: [{ kind: 'mention', userId: '' }] }])).toEqual([]);
  });

  it('中身が空になった塊は塊ごと落とす', () => {
    expect(buildCommentBody([{ kind: 'paragraph', segments: [{ kind: 'text', text: '   ' }] }])).toEqual([]);
    expect(buildCommentBody([{ kind: 'list', ordered: false, items: [[{ kind: 'text', text: '  ' }]] }])).toEqual([]);
  });
});

// 書式（marks）を持たせたので、読み込みが唯一の関所になる（backend は marks を検証しない）。
// 「通したいものが通る」だけでなく「通してはいけないものが落ちる」を両方固定する。
describe('readCommentBody の marks', () => {
  const textNode = (marks: unknown[]) => [{ type: 'text', text: 'ここ', marks }];

  it('許可した書式は残る', () => {
    const got = readCommentBody(textNode([{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }, { type: 'code' }]));
    expect(got).toEqual(
      oneParagraph([{ kind: 'text', text: 'ここ', marks: { bold: true, italic: true, strike: true, code: true } }]),
    );
  });

  it('知らない書式は捨てる（許可リストなので自動的に不許可へ倒れる）', () => {
    const got = readCommentBody(textNode([{ type: 'highlight' }, { type: 'superscript' }]));
    expect(got).toEqual(oneParagraph([{ kind: 'text', text: 'ここ' }]));
  });

  it('安全なリンクは残る', () => {
    const got = readCommentBody(textNode([{ type: 'link', attrs: { href: 'https://example.com/a' } }]));
    expect(got).toEqual(oneParagraph([{ kind: 'text', text: 'ここ', marks: { href: 'https://example.com/a' } }]));
  });

  // ここが本丸。描画するようになった以上、危ない飛び先は読み込みで落ちなければならない。
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:msgbox(1)'],
    ['  JavaScript:alert(1)'],
    ['/etc/passwd'],
  ])('危ない飛び先は落ちて文字だけ残る: %s', (href) => {
    const got = readCommentBody(textNode([{ type: 'link', attrs: { href } }]));
    expect(got).toEqual(oneParagraph([{ kind: 'text', text: 'ここ' }]));
  });

  // 箇条書きの中も同じ関所を通る（項目だけ素通しになる抜け道を塞ぐ）。
  it('箇条書きの項目の中でも危ない飛び先は落ちる', () => {
    const body = [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'ここ', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
              },
            ],
          },
        ],
      },
    ];
    expect(readCommentBody(body)).toEqual([
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'ここ' }]] },
    ]);
  });

  it('組み立て直しても危ない飛び先は出ていかない', () => {
    const nodes = buildCommentBody([
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'ここ', marks: { href: 'javascript:alert(1)' } }] },
    ]);
    expect(nodes).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'ここ' }] }]);
  });
});
