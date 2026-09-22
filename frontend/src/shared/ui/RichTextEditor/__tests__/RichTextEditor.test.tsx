import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import SaveStatusIndicator from '../SaveStatusIndicator';
import { emptyRichDoc, isRichDoc, type RichDocContent } from '../emptyRichDoc';

const headingDoc: RichDocContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出しテスト' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '本文テキスト' }] },
  ],
};

describe('emptyRichDoc / isRichDoc', () => {
  it('emptyRichDoc は空の doc（段落1つ）を返す', () => {
    expect(emptyRichDoc()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('isRichDoc は type=doc の object のみ true', () => {
    expect(isRichDoc({ type: 'doc', content: [] })).toBe(true);
    expect(isRichDoc({ type: 'paragraph' })).toBe(false);
    expect(isRichDoc(null)).toBe(false);
    expect(isRichDoc('doc')).toBe(false);
    expect(isRichDoc([])).toBe(false);
  });
});

describe('SaveStatusIndicator', () => {
  it('idle は何も描画しない', () => {
    const { container } = render(<SaveStatusIndicator status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('各状態のラベルと色を表示する', () => {
    const { rerender } = render(<SaveStatusIndicator status="unsaved" />);
    expect(screen.getByText('未保存')).toHaveClass('text-warning');

    rerender(<SaveStatusIndicator status="saving" />);
    expect(screen.getByText('保存中...')).toBeInTheDocument();

    rerender(<SaveStatusIndicator status="saved" />);
    expect(screen.getByText('保存済み')).toHaveClass('text-success');
  });
});

describe('RichTextEditor', () => {
  it('value の内容を描画する', async () => {
    render(<RichTextEditor value={headingDoc} />);
    expect(await screen.findByText('見出しテスト')).toBeInTheDocument();
    expect(screen.getByText('本文テキスト')).toBeInTheDocument();
  });

  it('固定ツールバーを持たない（インライン表示）', () => {
    render(<RichTextEditor value={emptyRichDoc()} />);
    // 固定/可視のツールバーを持たないことだけを担保する。
    // 選択時のバブルメニューは BubbleMenu が「表示時にだけ」中身を DOM へ接続するため、
    // 未選択の jsdom では role=toolbar は hidden:true でも見つからない（＝未マウント）。
    // バブル書式バーの表示・操作は FormatMenuBar の単体テストと e2e（jsdom 外）で担保する。
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { hidden: true })).not.toBeInTheDocument();
  });

  it('editable=false では本文が編集不可になる', () => {
    const { container } = render(<RichTextEditor value={headingDoc} editable={false} />);
    const pm = container.querySelector('.ProseMirror');
    expect(pm).not.toBeNull();
    expect(pm).toHaveAttribute('contenteditable', 'false');
  });

  // canComment は「コメントできる立場か」であって「編集できる立場か」ではない
  // （domain.GrantRoleCommenter は編集権限を持たない）。canComment=true にしても
  // 本文の編集可否（editable）に副作用が漏れないことを固定する — CodeRabbit 指摘の回帰確認。
  // バブルメニュー自体の表示・「コメント」ボタンの可否は FormatMenuBar の単体テスト・
  // story（選択が要り floating-ui の実描画に依るため jsdom では確かめにくい）で担保する。
  it('canComment=trueでもeditable=falseなら本文は編集不可のまま', () => {
    const { container } = render(
      <RichTextEditor value={headingDoc} editable={false} canComment />,
    );
    const pm = container.querySelector('.ProseMirror');
    expect(pm).not.toBeNull();
    expect(pm).toHaveAttribute('contenteditable', 'false');
  });

  it('saveStatus を渡すと保存状態を表示する', () => {
    render(<RichTextEditor value={emptyRichDoc()} saveStatus="saved" />);
    expect(screen.getByText('保存済み')).toBeInTheDocument();
  });

  it('ariaLabel が編集領域のアクセシブルネームになる', () => {
    render(<RichTextEditor value={emptyRichDoc()} ariaLabel="メモ本文" />);
    expect(screen.getByRole('textbox', { name: 'メモ本文' })).toBeInTheDocument();
  });

  it('初期描画では onChange を呼ばない（読み込み直後に未保存へ落ちない）', () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={emptyRichDoc()} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('外部から value が変わると本文が差し替わる', async () => {
    const { rerender } = render(<RichTextEditor value={emptyRichDoc()} />);
    const next: RichDocContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '新しい本文' }] }],
    };
    rerender(<RichTextEditor value={next} />);
    expect(await screen.findByText('新しい本文')).toBeInTheDocument();
  });

  it('editable を後から false にすると編集不可になる', async () => {
    const { rerender, container } = render(<RichTextEditor value={emptyRichDoc()} editable />);
    expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
    rerender(<RichTextEditor value={emptyRichDoc()} editable={false} />);
    await waitFor(() =>
      expect(container.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false'),
    );
  });

  it('onCreate で生成直後の editor を渡す', async () => {
    const onCreate = vi.fn();
    render(<RichTextEditor value={emptyRichDoc()} onCreate={onCreate} />);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    // tiptap の editor 実体（chain を持つ）が渡ること。
    expect(typeof onCreate.mock.calls[0][0]?.chain).toBe('function');
  });

  // 制御コンポーネントの中核契約: 編集で onChange が新しい doc を伴って発火する（自動保存の起点）。
  // onCreate 経由で得た editor に対して編集を発火し、dedup 条件が反転して onChange が
  // 止まる退行を捕捉する。
  it('編集すると onChange に更新後の doc（type=doc）が渡る', async () => {
    const onChange = vi.fn();
    let editor: Editor | null = null;
    render(
      <RichTextEditor
        value={emptyRichDoc()}
        onChange={onChange}
        onCreate={(created) => {
          editor = created;
        }}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.commands.insertContent('追記テキスト');
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const doc = onChange.mock.calls.at(-1)?.[0] as RichDocContent;
    expect(doc.type).toBe('doc');
    expect(JSON.stringify(doc)).toContain('追記テキスト');
  });

  // 可視本文が同じで block id だけが異なる別ページへ移動したケース（CodeRabbit 指摘の回帰）。
  // stableDocString（onUpdate の重複判定）は id を除外するが、外部 value の同期判定に
  // 同じ比較を使うと「変更なし」と誤判定し、前ページの block id を保ったまま新しいページの
  // 文脈で保存してしまう（block_id_conflict の 409 を招く）。
  it('可視本文が同じでもblock idが違う別ページへ移動したら中身を差し替える', async () => {
    let editor: Editor | null = null;
    // 段落を空（content 省略）にすると、tiptap が getJSON() でも同じ形にシリアライズするため
    // id だけが違うケースをうまく再現できない。実文字を持たせ、id 以外は真に同一にする。
    const pageA: RichDocContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
          content: [{ type: 'text', text: '同じ見た目の本文' }],
        },
      ],
    };
    const pageB: RichDocContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
          content: [{ type: 'text', text: '同じ見た目の本文' }],
        },
      ],
    };
    const { rerender } = render(
      <RichTextEditor
        value={pageA}
        onCreate={(created) => {
          editor = created;
        }}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());

    rerender(<RichTextEditor value={pageB} />);

    await waitFor(() => {
      const ids = (editor!.getJSON().content ?? []).map((n) => (n.attrs as { id?: string })?.id);
      expect(ids).toEqual(['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']);
    });
  });

  // エコー抑止: 外部から value を差し替えた同期は onChange を再発火しない（常時「未保存」への退行防止）。
  it('外部 value の差し替えでは onChange を発火しない（エコー抑止）', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor value={emptyRichDoc()} onChange={onChange} />);
    const next: RichDocContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '外部から差し替え' }] }],
    };
    rerender(<RichTextEditor value={next} onChange={onChange} />);
    expect(await screen.findByText('外部から差し替え')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  // 数千段の入れ子でも sanitizeDocLinks / fillMissingBlockIdsInDoc がコールスタックを
  // 使い切らないことを、マウントの成功で end-to-end に確かめる（各関数の単体テストは
  // linkSafety.test.ts / stableBlockId.test.tsx 側にある）。
  it('数千段の入れ子を持つ value でもクラッシュせずマウントできる', async () => {
    let inner: RichDocContent['content'] = [{ type: 'paragraph', content: [{ type: 'text', text: '底' }] }];
    for (let i = 0; i < 5000; i += 1) inner = [{ type: 'blockquote', content: inner }];
    const deep: RichDocContent = { type: 'doc', content: inner };

    const { container } = render(<RichTextEditor value={deep} />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
  });

  // useMemo 本体（sanitizeDocLinks → fillMissingBlockIdsInDoc）が想定外の理由で例外を投げても、
  // React がエディタごと描画できず白画面になることを避け、空文書へ落として描画は続ける。
  it('value の読み取りで例外が起きても白画面にならず空文書で描画する', async () => {
    // getter が投げる Proxy で、useMemo の中で初めて例外を発生させる
    // （プロパティへ実際にアクセスするまでは通常の value と見分けが付かない）。
    const throwing = new Proxy(
      { type: 'doc' },
      {
        get(target, prop, receiver) {
          if (prop === 'content') throw new Error('boom');
          return Reflect.get(target, prop, receiver);
        },
      },
    ) as unknown as RichDocContent;

    const { container } = render(<RichTextEditor value={throwing} />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    // 空文書（段落 1 つ、中身なし）で描画されている。
    expect(container.querySelectorAll('.ProseMirror > p')).toHaveLength(1);
  });
});

describe('doc の同一性はキー順に依らない', () => {
  it('キー順が違うだけの value を読み込んでも onChange を発火しない（開いただけで保存させない）', async () => {
    // サーバーはページ参照の題名解決で doc を作り直し、キーがアルファベット順で返る。
    // 素の文字列比較だとマウント時のエコーが「変更」と誤判定され、閲覧しただけの人が
    // 本文の全置換 PUT を発行してしまう。
    const alphabetized = JSON.parse(
      '{"content":[{"content":[{"text":"本文","type":"text"}],"type":"paragraph"}],"type":"doc"}',
    );
    const onChange = vi.fn();
    render(<RichTextEditor value={alphabetized} onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole('textbox', { name: '本文' })).toBeInTheDocument());
    // マウント直後のエコーを流し切っても発火しない。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange).not.toHaveBeenCalled();
  });
});

const PAGE_UUID = '01a045ef-35de-7e9d-b637-84a5eb6fad77';

/** 内部（相対・絶対）と外部のリンクを 1 段落に並べた doc。 */
function docWithLinks(): RichDocContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '内部リンク',
            marks: [{ type: 'link', attrs: { href: `/kb/${PAGE_UUID}` } }],
          },
          { type: 'text', text: ' / ' },
          {
            type: 'text',
            text: '共有URL',
            marks: [
              { type: 'link', attrs: { href: `${window.location.origin}/kb/${PAGE_UUID}` } },
            ],
          },
          { type: 'text', text: ' / ' },
          {
            type: 'text',
            text: '外部リンク',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }],
          },
        ],
      },
    ],
  };
}

describe('リンクのクリック', () => {
  it('内部ページリンクは編集中でもクリックでアプリ内遷移する', async () => {
    const navigateToPage = vi.fn();
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }));

    expect(navigateToPage).toHaveBeenCalledWith(`/kb/${PAGE_UUID}`);
  });

  it('同一オリジンの絶対 URL（共有 URL の貼り付け）もアプリ内遷移に畳む', async () => {
    const navigateToPage = vi.fn();
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '共有URL' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '共有URL' }));

    expect(navigateToPage).toHaveBeenCalledWith(`/kb/${PAGE_UUID}`);
  });

  it('外部リンクは新しいタブで開く（rel で opener を渡さない）', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const navigateToPage = vi.fn();
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '外部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '外部リンク' }));

    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    expect(navigateToPage).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('文字を選んだだけのクリックでは開かない（リンクの文言を選べる）', async () => {
    // リンクをドラッグで選ぶと mouseup のときに click も発火する。ここで開くと
    // リンクの文言を打ち直す・リンクを外す、といった編集がマウスでできなくなる。
    const navigateToPage = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(screen.getByRole('link', { name: '内部リンク' }));
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }));

    expect(navigateToPage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    selection?.removeAllRanges();
    open.mockRestore();
  });

  it('編集中の Shift+クリックは選択を伸ばす操作なので、新しいタブを開かない', async () => {
    const navigateToPage = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }), { shiftKey: true });

    expect(open).not.toHaveBeenCalled();
    expect(navigateToPage).toHaveBeenCalledWith(`/kb/${PAGE_UUID}`);
    open.mockRestore();
  });

  it('読み取り専用の Shift+クリックは新しいタブで開く（選択を伸ばす操作が無い面）', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<RichTextEditor value={docWithLinks()} editable={false} onNavigateToPage={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }), { shiftKey: true });

    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });

  it('修飾キー付きのクリックは内部リンクでも新しいタブで開く', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const navigateToPage = vi.fn();
    render(
      <RichTextEditor value={docWithLinks()} editable onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }), { metaKey: true });

    expect(open).toHaveBeenCalled();
    expect(navigateToPage).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('読み取り専用でもクリックでアプリ内遷移する（素の全画面リロードにしない）', async () => {
    const navigateToPage = vi.fn();
    render(
      <RichTextEditor value={docWithLinks()} editable={false} onNavigateToPage={navigateToPage} />,
    );
    await waitFor(() => expect(screen.getByRole('link', { name: '内部リンク' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: '内部リンク' }));

    expect(navigateToPage).toHaveBeenCalledWith(`/kb/${PAGE_UUID}`);
  });
});

describe('focusSignal（題名で Enter → 本文へ）', () => {
  it('合図が増えたら本文へフォーカスが移る', async () => {
    const { rerender } = render(
      <RichTextEditor value={emptyRichDoc()} editable focusSignal={0} />,
    );
    const textbox = await screen.findByRole('textbox', { name: '本文' });
    expect(document.activeElement).not.toBe(textbox);

    rerender(<RichTextEditor value={emptyRichDoc()} editable focusSignal={1} />);

    await waitFor(() => expect(document.activeElement).toBe(textbox));
  });

  it('マウント時の値では動かない（ページを開いただけで本文が奪わない）', async () => {
    render(<RichTextEditor value={emptyRichDoc()} editable focusSignal={5} />);
    const textbox = await screen.findByRole('textbox', { name: '本文' });

    expect(document.activeElement).not.toBe(textbox);
  });
});

describe('コメント件数バッジ（commentBadges の Decoration.widget）', () => {
  const blockId = '11111111-1111-4111-8111-111111111111';
  const docWithBlockId: RichDocContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: blockId },
        content: [{ type: 'text', text: '本文' }],
      },
    ],
  };

  it('件数が1以上のブロックにだけバッジが実際にDOMへ挿入される', async () => {
    const { container, rerender } = render(
      <RichTextEditor value={docWithBlockId} commentBadgeCounts={{ [blockId]: 3 }} />,
    );

    await waitFor(() =>
      expect(container.querySelector('.rte-comment-badge')).toHaveTextContent('3'),
    );

    // 件数を渡さなければバッジも出ない。
    rerender(<RichTextEditor value={docWithBlockId} commentBadgeCounts={{}} />);
    await waitFor(() => expect(container.querySelector('.rte-comment-badge')).toBeNull());
  });

  it('件数が渡らない（commentBadgeCounts 未指定）ときはバッジを出さない', () => {
    const { container } = render(<RichTextEditor value={docWithBlockId} />);
    expect(container.querySelector('.rte-comment-badge')).toBeNull();
  });

  it('バッジをクリックすると onCommentBadgeClick にブロックIDが渡る', async () => {
    const onCommentBadgeClick = vi.fn();
    const { container } = render(
      <RichTextEditor
        value={docWithBlockId}
        commentBadgeCounts={{ [blockId]: 1 }}
        onCommentBadgeClick={onCommentBadgeClick}
      />,
    );

    await waitFor(() => expect(container.querySelector('.rte-comment-badge')).not.toBeNull());
    fireEvent.click(container.querySelector('.rte-comment-badge')!);

    expect(onCommentBadgeClick).toHaveBeenCalledWith(blockId);
  });

  // React state（外部）の変化はエディタ自身の transaction では拾えないため、
  // useCommentBadgeSync が meta 付き transaction を dispatch して再計算を強制する
  // （commentBadges.ts のコメント参照）。この経路が生きているかをここで確かめる。
  it('commentBadgeCounts が変わったら、再描画で既存エディタのバッジ件数も更新される', async () => {
    const { container, rerender } = render(
      <RichTextEditor value={docWithBlockId} commentBadgeCounts={{ [blockId]: 1 }} />,
    );
    await waitFor(() =>
      expect(container.querySelector('.rte-comment-badge')).toHaveTextContent('1'),
    );

    rerender(<RichTextEditor value={docWithBlockId} commentBadgeCounts={{ [blockId]: 5 }} />);

    await waitFor(() =>
      expect(container.querySelector('.rte-comment-badge')).toHaveTextContent('5'),
    );
  });
});
