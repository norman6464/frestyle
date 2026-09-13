import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import KbSidebar from '../KbSidebar';
import { emitKbTreeEvent, subscribeKbTreeEvents } from '@/entities/kb';
import type { KbMySpace, KbPage, KbPageTree, KbSpace, KbWorkspace } from '@/entities/kb';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchSpaces: vi.fn(),
  fetchMySpaces: vi.fn(),
  fetchPageTree: vi.fn(),
  createPage: vi.fn(),
  renamePage: vi.fn(),
  deletePage: vi.fn(),
  archivePage: vi.fn(),
  unarchivePage: vi.fn(),
  movePage: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  searchPages: vi.fn(),
  showToast: vi.fn(),
}));

// トーストは検査の対象。**失敗したときだけ知らせが出ること**を確かめるために捕まえる。
vi.mock('@/shared/lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: hoisted.showToast, toasts: [], removeToast: vi.fn() }),
}));

vi.mock('@/entities/kb', async () => {
  // ツリーの平坦化と祖先探索は本物を使う（そこは entities 側でテスト済みで、
  // ここで別実装を差し込むと「サイドバーは通るが本番は壊れる」形になる）。
  const actual = await vi.importActual<typeof import('@/entities/kb')>(
    '@/entities/kb',
  );
  return {
    ...actual,
    KbRepository: {
      fetchWorkspaces: hoisted.fetchWorkspaces,
      fetchSpaces: hoisted.fetchSpaces,
      fetchMySpaces: hoisted.fetchMySpaces,
      fetchPageTree: hoisted.fetchPageTree,
      createPage: hoisted.createPage,
      renamePage: hoisted.renamePage,
      deletePage: hoisted.deletePage,
      archivePage: hoisted.archivePage,
      unarchivePage: hoisted.unarchivePage,
      movePage: hoisted.movePage,
      createWorkspace: hoisted.createWorkspace,
      deleteWorkspace: hoisted.deleteWorkspace,
      createSpace: hoisted.createSpace,
      renameSpace: hoisted.renameSpace,
      searchPages: hoisted.searchPages,
    },
  };
});

function workspace(slug: string, name = slug, canManage = true): KbWorkspace {
  return { slug, name, createdAt: '2026-08-01T00:00:00Z', canManage };
}

function space(
  id: string,
  name = id,
  visibility: KbSpace['visibility'] = 'workspace',
): KbSpace {
  return { id, key: id, name, visibility, createdAt: '2026-08-01T00:00:00Z' };
}

function mySpace(id: string, name = id, role: KbMySpace['role'] = 'editor'): KbMySpace {
  return { id, name, role };
}

function page(id: string, title = id): KbPage {
  return {
    id,
    spaceId: 'space-1',
    title,
    createdByUserId: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function tree(
  nodes: {
    id: string;
    title?: string;
    hidden?: boolean;
    children?: string[];
    parentArchived?: boolean;
  }[],
  hiddenAtRoot = false,
): KbPageTree {
  return {
    pages: nodes.map((node) => ({
      page: page(node.id, node.title),
      hasHiddenChildren: node.hidden ?? false,
      parentArchived: node.parentArchived ?? false,
      children: (node.children ?? []).map((childId) => ({
        page: page(childId),
        hasHiddenChildren: false,
        // 一緒にアーカイブされた子は、その子だけを戻すことはできない。
        parentArchived: true,
        children: [],
      })),
    })),
    hasHiddenChildren: hiddenAtRoot,
  };
}

function renderSidebar(
  props: { workspaceSlug?: string; spaceId?: string; activePageId?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/kb']}>
      <KbSidebar spaceId="space-1" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社')]);
  hoisted.fetchSpaces.mockResolvedValue([space('space-1', '開発部')]);
  hoisted.fetchMySpaces.mockResolvedValue([mySpace('space-1', '開発部')]);
  hoisted.fetchPageTree.mockResolvedValue(tree([{ id: 'p1', title: '設計メモ' }]));
  hoisted.createPage.mockResolvedValue(page('new-1', '無題'));
  hoisted.renamePage.mockImplementation(async (_slug: string, id: string, title: string) =>
    page(id, title),
  );
  hoisted.archivePage.mockResolvedValue(undefined);
  hoisted.unarchivePage.mockResolvedValue(undefined);
  hoisted.movePage.mockResolvedValue(page('p1'));
  hoisted.createWorkspace.mockResolvedValue(workspace('new', '新しい会社'));
  hoisted.createSpace.mockResolvedValue(space('new-space', '新しい区画'));
  hoisted.renameSpace.mockImplementation(async (_slug: string, id: string, name: string) =>
    space(id, name),
  );
  hoisted.searchPages.mockResolvedValue([]);
});

/** 行の矩形を固定して、落とす位置（上端 / 中央 / 下端）を狙えるようにする。 */
function stubRowRect(row: HTMLElement) {
  row.getBoundingClientRect = () =>
    ({ top: 0, height: 100, left: 0, right: 0, bottom: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/**
 * dragRowOnto は from の行を to の行の指定位置へドラッグして落とす。
 *
 * dragOver / drop は **MouseEvent として作る**。fireEvent.drop(el, { clientY }) だと
 * jsdom に DragEvent が無いぶん素の Event に落ちて clientY が届かず、
 * 落下先が必ず「中央（子として）」になってしまう（実測で確認）。
 */
function rowOf(title: string): HTMLElement {
  // 行そのものは役割を持たない（木として名乗らない）。題名のリンクから辿る。
  const link = screen.getByRole('link', { name: title });
  const row = link.parentElement;
  if (!row) throw new Error('row not found: ' + title);
  return row;
}

function dragRowOnto(fromTitle: string, toTitle: string, clientY: number) {
  const from = rowOf(fromTitle);
  const to = rowOf(toTitle);
  stubRowRect(to);
  fireEvent.dragStart(from, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
  const withPosition = (type: string) => {
    const event = new MouseEvent(type, { bubbles: true, clientY });
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: '' } });
    return event;
  };
  fireEvent(to, withPosition('dragover'));
  fireEvent(to, withPosition('drop'));
}

describe('KbSidebar', () => {
  it('今いるスペースの木を出す', async () => {
    renderSidebar();

    expect(await screen.findByText('設計メモ')).toBeInTheDocument();
    expect(hoisted.fetchPageTree).toHaveBeenCalledWith('acme', 'space-1', { archived: false });
  });

  it('子を持つページはフォルダ、持たないページは紙にする', async () => {
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '親ページ', children: ['p1-child'] }, { id: 'p2', title: '葉ページ' }]),
    );
    renderSidebar();
    await screen.findByText('親ページ');

    // リンクとして引く。役割とアクセシブルな名前の崩れも一緒に捕まえられる。
    const iconOf = (title: string) =>
      screen.getByRole('link', { name: title }).querySelector('[data-icon]')?.getAttribute('data-icon');

    expect(iconOf('親ページ')).toBe('page-group');
    expect(iconOf('葉ページ')).toBe('page');
  });

  it('伏せた子しか居ないページはフォルダにしない', async () => {
    // 開閉の三角が無いのにフォルダ、という食い違った行になるうえ、
    // 「この下に何かある」ことを形からも二重に漏らすことになる。
    hoisted.fetchPageTree.mockResolvedValue(tree([{ id: 'p1', title: '設計メモ', hidden: true }]));
    renderSidebar();
    await screen.findByText('設計メモ');

    const icon = screen.getByRole('link', { name: '設計メモ' }).querySelector('[data-icon]');
    expect(icon?.getAttribute('data-icon')).toBe('page');
  });

  it('伏せた子が在ることだけを出し、枚数も題名も出さない', async () => {
    hoisted.fetchPageTree.mockResolvedValue(tree([{ id: 'p1', title: '設計メモ', hidden: true }]));

    renderSidebar();

    expect(await screen.findByText('表示できないページがあります')).toBeInTheDocument();
  });

  it('伏せた子しか居ない行に開閉ボタンを出さない', async () => {
    // 開いても何も出ない行に三角を出すと、押しても反応しない行になる。
    hoisted.fetchPageTree.mockResolvedValue(tree([{ id: 'p1', title: '設計メモ', hidden: true }]));

    renderSidebar();
    await screen.findByText('設計メモ');

    expect(screen.queryByRole('button', { name: /設計メモ を開く/ })).not.toBeInTheDocument();
  });

  it('子を開くと次の段が出る', async () => {
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '設計メモ', children: ['p1-child'] }]),
    );
    renderSidebar();
    await screen.findByText('設計メモ');

    expect(screen.queryByText('p1-child')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '設計メモ を開く' }));

    expect(await screen.findByText('p1-child')).toBeInTheDocument();
  });

  it('伏せた印は、開いた段の子より後ろに出す', async () => {
    // 平らにした配列では親の要素が子より先に来るので、ページの行に混ぜると
    // 印が子より前に出る。読み順として最後の子の後ろが正しい。
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '設計メモ', hidden: true, children: ['p1-child'] }]),
    );
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '設計メモ を開く' }));
    await screen.findByText('p1-child');

    const text = document.body.textContent ?? '';
    expect(text.indexOf('p1-child')).toBeLessThan(text.indexOf('表示できないページがあります'));
  });

  it('閉じている段では伏せた印を出さない', async () => {
    // 見える子も出していないのに伏せた分だけ出すと、閉じているのに何か書いてある行になる。
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '設計メモ', hidden: true, children: ['p1-child'] }]),
    );

    renderSidebar();
    await screen.findByText('設計メモ');

    expect(screen.queryByText('表示できないページがあります')).not.toBeInTheDocument();
  });

  it('現在位置のページの祖先を自動で開く', async () => {
    // リンクを辿って開いたページが、閉じた枝の中に隠れたままにならないこと。
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '設計メモ', children: ['p1-child'] }]),
    );

    renderSidebar({ activePageId: 'p1-child' });

    expect(await screen.findByText('p1-child')).toBeInTheDocument();
  });

  it('木の取得に失敗したら理由を出して再試行できる', async () => {
    // 黙って空にすると「ページが 1 枚も無い」と見分けが付かず、消えたと思われる。
    hoisted.fetchPageTree.mockRejectedValueOnce(new Error('boom'));
    renderSidebar();

    expect(await screen.findByText('ページを読み込めませんでした')).toBeInTheDocument();

    hoisted.fetchPageTree.mockResolvedValue(tree([{ id: 'p1', title: '設計メモ' }]));
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText('設計メモ')).toBeInTheDocument();
  });

  describe('ここから始める', () => {
    it('所属が無いときは、行き止まりにせずワークスペースを作らせる', async () => {
      // 作る手段が無いと、API があってもサイドバーには永久にたどり着けない
      // （実際そうなっていた）。
      hoisted.fetchWorkspaces.mockResolvedValue([]);
      renderSidebar();
      await screen.findByText(/まだワークスペースがありません/);

      // 見出しと入力欄は同時に出るとは限らない。欄そのものの出現を待ってから触る
      // （見出しだけ待って get で取ると、描画が一拍遅れた回にその場で落ちる）。
      fireEvent.change(await screen.findByLabelText('ワークスペースの名前'), {
        target: { value: 'Acme 社' },
      });
      fireEvent.click(await screen.findByRole('button', { name: 'ワークスペースを作る' }));

      await waitFor(() =>
        // URL に出る slug はサーバーが自動採番する。フロントから送るのは名前だけ。
        expect(hoisted.createWorkspace).toHaveBeenCalledWith({ name: 'Acme 社' }),
      );
    });

    it('未所属の常設フォームから作っても /kb へ戻る（入口ごとの差を作らない）', async () => {
      hoisted.fetchWorkspaces.mockResolvedValue([]);
      hoisted.createWorkspace.mockResolvedValue(workspace('w-new', '新チーム'));
      let entryPath = '';
      function EntryPathProbe() {
        entryPath = useLocation().pathname;
        return null;
      }
      render(
        <MemoryRouter initialEntries={['/kb/stale-page']}>
          <EntryPathProbe />
          <KbSidebar spaceId="" />
        </MemoryRouter>,
      );
      await screen.findByText(/まだワークスペースがありません/);

      fireEvent.change(screen.getByLabelText('ワークスペースの名前'), {
        target: { value: '新チーム' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを作る' }));

      await waitFor(() => expect(entryPath).toBe('/kb'));
    });

    it('スペースが無いときも行き止まりにしない', async () => {
      // ワークスペースを作っただけではスペースは付いてこない。
      hoisted.fetchSpaces.mockResolvedValue([]);
      renderSidebar({ spaceId: '' });
      await screen.findByText(/まだスペースがありません/);

      fireEvent.change(await screen.findByLabelText('スペースの名前'), { target: { value: '開発部' } });
      fireEvent.click(await screen.findByRole('button', { name: 'スペースを作る' }));

      await waitFor(() =>
        expect(hoisted.createSpace).toHaveBeenCalledWith('acme', { name: '開発部' }),
      );
    });

    it('URL に使う短い名前は人に入力させない（サーバーが自動採番する）', async () => {
      // 日本語の名前からは英数字が残らず、人に決めさせると先へ進めない。
      // 欄そのものを出さないことが仕様（うっかり復活したらこのテストが落ちる）。
      hoisted.fetchWorkspaces.mockResolvedValue([]);
      renderSidebar();
      await screen.findByText(/まだワークスペースがありません/);
      // 欄が出そろってから「無いこと」を見る。見出しだけ待って確かめると、
      // まだ描かれていないだけの状態を「出ていない」と読んでしまう。
      await screen.findByLabelText('ワークスペースの名前');

      expect(screen.queryByLabelText(/短い名前/)).not.toBeInTheDocument();
    });

    it('作成に失敗したら知らせを出し、入力は消さない', async () => {
      // 消すと打ち直しになるうえ、何が悪かったのかも分からない。
      hoisted.fetchWorkspaces.mockResolvedValue([]);
      hoisted.createWorkspace.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText(/まだワークスペースがありません/);

      fireEvent.change(screen.getByLabelText('ワークスペースの名前'), {
        target: { value: 'Acme 社' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを作る' }));

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith(
          'error',
          'ワークスペースを作成できませんでした',
        ),
      );
      expect(screen.getByLabelText('ワークスペースの名前')).toHaveValue('Acme 社');
    });
  });

  it('ワークスペースの取得に失敗したら理由を出して再試行できる', async () => {
    // 一度だけ走る effect の中に閉じ込めると、失敗後は画面を再読み込みするしか手が無くなる。
    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('boom'));
    renderSidebar();

    expect(await screen.findByText('ワークスペースを読み込めませんでした')).toBeInTheDocument();

    hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社')]);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText('設計メモ')).toBeInTheDocument();
  });

  it('ワークスペースを切り替えたら、前のスペースを先に捨てる', async () => {
    // 残したまま新しい応答を待つと、その間だけ「前のワークスペースのスペース」と
    // 「新しい slug」が組み合わさって表示され、そこを開くと別ワークスペースの
    // spaceId で木を取りに行ってしまう。
    hoisted.fetchSpaces.mockResolvedValue([space('space-1', '開発部')]);

    const { rerender } = render(
      <MemoryRouter initialEntries={['/kb/acme']}>
        <KbSidebar workspaceSlug="acme" spaceId="space-1" />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: '開発部 の操作' });

    // 切り替え先の一覧は保留にして、待っている間の表示を確かめる。
    hoisted.fetchSpaces.mockImplementationOnce(() => new Promise(() => {}));
    rerender(
      <MemoryRouter initialEntries={['/kb/beta']}>
        <KbSidebar workspaceSlug="beta" spaceId="space-1" />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '開発部 の操作' })).not.toBeInTheDocument(),
    );
  });

  it('木としては名乗らない（矢印キーを用意していないため）', async () => {
    // role="tree" を名乗ると矢印キーでの移動を約束することになるが、行の中に
    // リンクと操作ボタンが同居しているぶん、それは Tab とは別の操作体系になる。
    // 名乗りだけ残すのは嘘なので、名乗らないことを固定する。
    renderSidebar();
    await screen.findByText('設計メモ');

    // 木としては名乗らないので、段の深さは入れ子の ul が表す。
    // いま開いているページは aria-current が表す。
    expect(screen.getByRole('link', { name: '設計メモ' })).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem')).not.toBeInTheDocument();
  });

  describe('作る・名前を変える', () => {
    it('スペースの ＋ でスペース直下に作る', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '開発部 にページを追加' }));

      await waitFor(() =>
        expect(hoisted.createPage).toHaveBeenCalledWith('acme', 'space-1', {
          title: '無題',
          parentId: undefined,
        }),
      );
    });

    it('行の ＋ でその行の子として作る', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の下にページを追加' }));

      await waitFor(() =>
        expect(hoisted.createPage).toHaveBeenCalledWith('acme', 'space-1', {
          title: '無題',
          parentId: 'p1',
        }),
      );
    });

    it('作ったら木を取り直す（並び順を決めるのはサーバー）', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');
      const before = hoisted.fetchPageTree.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: '開発部 にページを追加' }));

      await waitFor(() =>
        expect(hoisted.fetchPageTree.mock.calls.length).toBeGreaterThan(before),
      );
    });

    it('作成に失敗したら知らせを出す', async () => {
      // 轍: 他の操作でも「失敗したのに成功の表示」を出してしまったことがある。
      hoisted.createPage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '開発部 にページを追加' }));

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', 'ページを作成できませんでした'),
      );
      expect(hoisted.showToast).not.toHaveBeenCalledWith('success', expect.anything());
    });

    it('名前を変えると、その行だけが書き換わる', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '名前を変更' }));

      const input = screen.getByRole('textbox', { name: 'ページの題名' });
      fireEvent.change(input, { target: { value: '新しい名前' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(await screen.findByText('新しい名前')).toBeInTheDocument();
      expect(hoisted.renamePage).toHaveBeenCalledWith('acme', 'p1', '新しい名前');
      // 木ごと取り直すと一瞬空になり、開いていた段も畳まれて見える。
      expect(hoisted.fetchPageTree).toHaveBeenCalledTimes(1);
    });

    it('名前の変更に失敗したら、知らせを出して入力欄を閉じない', async () => {
      // 閉じると、書いた文字は消えるのに元の題名が残り、保存されたのか分からなくなる。
      hoisted.renamePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '名前を変更' }));

      const input = screen.getByRole('textbox', { name: 'ページの題名' });
      fireEvent.change(input, { target: { value: '新しい名前' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', '名前を変更できませんでした'),
      );
      expect(screen.getByRole('textbox', { name: 'ページの題名' })).toHaveValue('新しい名前');
      expect(hoisted.showToast).not.toHaveBeenCalledWith('success', expect.anything());
    });

    it('Escape で取り消すと、サーバーへ投げない', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '名前を変更' }));

      const input = screen.getByRole('textbox', { name: 'ページの題名' });
      fireEvent.change(input, { target: { value: '書きかけ' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(await screen.findByText('設計メモ')).toBeInTheDocument();
      expect(hoisted.renamePage).not.toHaveBeenCalled();
    });

    it('空の題名はサーバーへ投げない', async () => {
      // サーバーも弾くが、往復させる意味が無い。
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '名前を変更' }));

      const input = screen.getByRole('textbox', { name: 'ページの題名' });
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(screen.getByText('設計メモ')).toBeInTheDocument());
      expect(hoisted.renamePage).not.toHaveBeenCalled();
    });
  });

  describe('アーカイブ', () => {
    const openArchive = () =>
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブしたページを表示' }));

    it('切り替えると、同じスペースをアーカイブ済みで取り直す', async () => {
      // 別の口ではなく同じ口のスコープ。権限の見方は現役とまったく同じ。
      renderSidebar();
      await screen.findByText('設計メモ');

      openArchive();

      await waitFor(() =>
        expect(hoisted.fetchPageTree).toHaveBeenCalledWith('acme', 'space-1', { archived: true }),
      );
    });

    it('切り替えたら前のスコープの木を捨てる', async () => {
      // 残すと、切り替えた直後だけ前のスコープの木が見える。
      hoisted.fetchPageTree.mockResolvedValueOnce(tree([{ id: 'p1', title: '現役のページ' }]));
      hoisted.fetchPageTree.mockImplementationOnce(() => new Promise(() => {}));
      renderSidebar();
      await screen.findByText('現役のページ');

      openArchive();

      await waitFor(() => expect(screen.queryByText('現役のページ')).not.toBeInTheDocument());
    });

    it('アーカイブ済みでは作る・名前を変えるを出さない', async () => {
      renderSidebar();
      await screen.findByText('設計メモ');
      openArchive();
      await screen.findByText('設計メモ');

      expect(screen.queryByRole('button', { name: '開発部 にページを追加' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '設計メモ の操作' })).not.toBeInTheDocument();
      // 切り替え自体は残り、押すと現役へ戻る。
      expect(screen.getByRole('button', { name: '現役のページに戻る' })).toBeInTheDocument();
    });

    it('復帰は、アーカイブの根にだけ出す', async () => {
      // 親がまだアーカイブ中の行に出すと、押せるのに必ず断られるボタンになる。
      hoisted.fetchPageTree.mockResolvedValue(
        tree([{ id: 'p1', title: 'アーカイブの根', children: ['p1-child'] }]),
      );
      renderSidebar();
      await screen.findByText('アーカイブの根');
      openArchive();
      await screen.findByText('アーカイブの根');

      fireEvent.click(screen.getByRole('button', { name: 'アーカイブの根 を開く' }));
      await screen.findByText('p1-child');

      // 子（parentArchived: true）には出ない。
      expect(screen.getAllByRole('button', { name: '復帰' })).toHaveLength(1);
    });

    it('メニューからアーカイブすると、木を取り直す', async () => {
      // 消えるのは 1 枚とは限らない（子孫ごと消える）ので、手元で抜くとずれる。
      renderSidebar();
      await screen.findByText('設計メモ');
      const before = hoisted.fetchPageTree.mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));

      await waitFor(() => expect(hoisted.archivePage).toHaveBeenCalledWith('acme', 'p1'));
      await waitFor(() =>
        expect(hoisted.fetchPageTree.mock.calls.length).toBeGreaterThan(before),
      );
    });

    it('操作中に切り替えても、取り直しは新しいスコープで走る', async () => {
      // アーカイブの完了は await をまたぐ。その間に切り替えられたとき、書き換えを
      // 始めた時点のスコープで取りに行くと、**古い木が新しい表示に入る**。
      let finishArchive: () => void = () => {};
      hoisted.archivePage.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishArchive = resolve;
          }),
      );
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));
      await waitFor(() => expect(hoisted.archivePage).toHaveBeenCalled());

      // まだ終わっていないうちに切り替える。
      openArchive();
      await waitFor(() =>
        expect(hoisted.fetchPageTree).toHaveBeenCalledWith('acme', 'space-1', { archived: true }),
      );
      hoisted.fetchPageTree.mockClear();

      await act(async () => {
        finishArchive();
      });

      await waitFor(() => expect(hoisted.fetchPageTree).toHaveBeenCalled());
      for (const call of hoisted.fetchPageTree.mock.calls) {
        expect(call[2]).toEqual({ archived: true });
      }
    });

    it('アーカイブに失敗したら知らせを出す', async () => {
      hoisted.archivePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }));

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', 'アーカイブできませんでした'),
      );
      expect(hoisted.showToast).not.toHaveBeenCalledWith('success', expect.anything());
    });

    it('復帰に失敗したら知らせを出す', async () => {
      hoisted.unarchivePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('設計メモ');
      openArchive();
      await screen.findByText('設計メモ');

      fireEvent.click(screen.getByRole('button', { name: '復帰' }));

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', '復帰できませんでした'),
      );
    });
  });

  describe('キーボードだけで動かす', () => {
    beforeEach(() => {
      hoisted.fetchPageTree.mockResolvedValue(
        tree([{ id: 'p1', title: '1番目' }, { id: 'p2', title: '2番目' }, { id: 'p3', title: '3番目' }]),
      );
    });

    async function openRowMenu(title: string) {
      fireEvent.click(screen.getByRole('button', { name: `${title} の操作` }));
    }

    it('上へ移動は、ひとつ上の兄弟の手前へ送る', async () => {
      renderSidebar();
      await screen.findByText('2番目');
      await openRowMenu('2番目');

      fireEvent.click(screen.getByRole('button', { name: '上へ移動' }));

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p2', { parentId: '', beforePageId: 'p1' }),
      );
    });

    it('下へ移動は、ひとつ下の兄弟の直後へ送る', async () => {
      renderSidebar();
      await screen.findByText('2番目');
      await openRowMenu('2番目');

      fireEvent.click(screen.getByRole('button', { name: '下へ移動' }));

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p2', { parentId: '', afterPageId: 'p3' }),
      );
    });

    it('ひとつ内側へは、ひとつ上の兄弟の子にする', async () => {
      renderSidebar();
      await screen.findByText('2番目');
      await openRowMenu('2番目');

      fireEvent.click(screen.getByRole('button', { name: 'ひとつ内側へ' }));

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p2', { parentId: 'p1' }),
      );
    });

    it('ひとつ外側へは、親の直後へ出す', async () => {
      hoisted.fetchPageTree.mockResolvedValue(
        tree([{ id: 'p1', title: '親', children: ['child'] }]),
      );
      renderSidebar();
      await screen.findByText('親');
      fireEvent.click(screen.getByRole('button', { name: '親 を開く' }));
      await screen.findByText('child');
      await openRowMenu('child');

      fireEvent.click(screen.getByRole('button', { name: 'ひとつ外側へ' }));

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'child', { parentId: '', afterPageId: 'p1' }),
      );
    });

    it('動かせない向きは項目自体を出さない', async () => {
      renderSidebar();
      await screen.findByText('1番目');
      await openRowMenu('1番目');

      expect(screen.queryByRole('button', { name: '上へ移動' })).not.toBeInTheDocument();
    });

    it('ドラッグと同じ経路を通るので、失敗の扱いも同じ', async () => {
      hoisted.movePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('2番目');
      await openRowMenu('2番目');

      fireEvent.click(screen.getByRole('button', { name: '上へ移動' }));

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', '移動できませんでした'),
      );
    });

    it('アーカイブ済みでは移動の項目を出さない', async () => {
      renderSidebar();
      await screen.findByText('1番目');
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブしたページを表示' }));
      await screen.findByText('1番目');

      expect(screen.queryByRole('button', { name: '1番目 の操作' })).not.toBeInTheDocument();
    });
  });

  describe('ドラッグで動かす', () => {
    beforeEach(() => {
      hoisted.fetchPageTree.mockResolvedValue(
        tree([{ id: 'p1', title: '1番目' }, { id: 'p2', title: '2番目' }]),
      );
    });

    it('行の下端に落とすと、その直後の兄弟として送る', async () => {
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 99);

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p1', { parentId: '', afterPageId: 'p2' }),
      );
    });

    it('行の上端に落とすと、その手前の兄弟として送る', async () => {
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('2番目', '1番目', 1);

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p2', { parentId: '', beforePageId: 'p1' }),
      );
    });

    it('行の中央に落とすと、その行の子として送る', async () => {
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() =>
        expect(hoisted.movePage).toHaveBeenCalledWith('acme', 'p1', { parentId: 'p2' }),
      );
    });

    it('返事を待たずに画面が動く', async () => {
      hoisted.movePage.mockImplementationOnce(() => new Promise(() => {}));
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() => expect(hoisted.movePage).toHaveBeenCalled());
    });

    it('断られたら元の並びへ戻し、知らせを出す', async () => {
      hoisted.movePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() =>
        expect(hoisted.showToast).toHaveBeenCalledWith('error', '移動できませんでした'),
      );
    });

    it('巻き戻しで木を取り直さない', async () => {
      hoisted.movePage.mockRejectedValueOnce(new Error('boom'));
      renderSidebar();
      await screen.findByText('2番目');
      const before = hoisted.fetchPageTree.mock.calls.length;

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() => expect(hoisted.showToast).toHaveBeenCalled());
      expect(hoisted.fetchPageTree.mock.calls.length).toBe(before);
    });

    it('成功しても木を取り直さない', async () => {
      renderSidebar();
      await screen.findByText('2番目');
      const before = hoisted.fetchPageTree.mock.calls.length;

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() => expect(hoisted.movePage).toHaveBeenCalled());
      expect(hoisted.fetchPageTree.mock.calls.length).toBe(before);
    });

    it('自分の子孫の中へは動かさない（サーバーへも投げない）', async () => {
      hoisted.fetchPageTree.mockResolvedValue(
        tree([{ id: 'p1', title: '親', children: ['child'] }]),
      );
      renderSidebar();
      await screen.findByText('親');
      fireEvent.click(screen.getByRole('button', { name: '親 を開く' }));
      await screen.findByText('child');

      dragRowOnto('親', 'child', 50);

      expect(hoisted.movePage).not.toHaveBeenCalled();
    });

    it('子として落としたら、その段を開いて動かしたページを見せる', async () => {
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);

      await waitFor(() => expect(hoisted.movePage).toHaveBeenCalled());
    });

    it('移動中に重ねて落としても、2 本目は投げない', async () => {
      hoisted.movePage.mockImplementationOnce(() => new Promise(() => {}));
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);
      dragRowOnto('1番目', '2番目', 50);

      expect(hoisted.movePage).toHaveBeenCalledTimes(1);
    });

    it('スコープが切り替わったあとの失敗では、新しい木を巻き戻さない', async () => {
      let rejectMove: (e: Error) => void = () => {};
      hoisted.movePage.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectMove = reject;
          }),
      );
      renderSidebar();
      await screen.findByText('2番目');

      dragRowOnto('1番目', '2番目', 50);
      await waitFor(() => expect(hoisted.movePage).toHaveBeenCalled());

      // 移動の返事を待っている間に、アーカイブへ切り替える（新しい木が入る）。
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブしたページを表示' }));
      await waitFor(() =>
        expect(hoisted.fetchPageTree).toHaveBeenCalledWith('acme', 'space-1', { archived: true }),
      );

      await act(async () => {
        rejectMove(new Error('boom'));
      });

      // 新しい木（アーカイブ側）が古い木で上書きされていないこと。
      await waitFor(() => expect(hoisted.showToast).toHaveBeenCalledWith('error', '移動できませんでした'));
    });

    it('アーカイブ済みでは並べ替えを受け付けない', async () => {
      renderSidebar();
      await screen.findByText('1番目');
      fireEvent.click(screen.getByRole('button', { name: 'アーカイブしたページを表示' }));
      await screen.findByText('1番目');

      dragRowOnto('1番目', '2番目', 50);

      expect(hoisted.movePage).not.toHaveBeenCalled();
    });
  });

  it('ワークスペースを切り替えると /kb に戻り、木は切り替え先を指す', async () => {
    // URL はワークスペースを持たない（ページの URL は /kb/{pageId} だけ）。
    // 開いていたページは前のワークスペースのものなので、本文画面には残さず一覧に戻す。
    hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社'), workspace('beta', 'Beta 社')]);
    let path = '';
    function PathProbe() {
      path = useLocation().pathname;
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/kb/p1']}>
        <PathProbe />
        <Routes>
          <Route path="/kb" element={<KbSidebar spaceId="" />} />
          <Route path="/kb/:pageId" element={<KbSidebar workspaceSlug="acme" spaceId="space-1" />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Beta 社' }));

    await waitFor(() => expect(path).toBe('/kb'));
    // 切り替え先のスペース一覧を取り直している（状態が新しいワークスペースを指す）。
    await waitFor(() => expect(hoisted.fetchSpaces).toHaveBeenCalledWith('beta'));
  });
});

describe('見た目の印（葉の点と開いたフォルダ）', () => {
  it('子が無い行は三角の位置に「・」が出て、子を持つ行には出ない', async () => {
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'parent', title: '親ページ', children: ['child-1'] }, { id: 'leaf', title: '葉ページ' }]),
    );
    renderSidebar();
    await screen.findByText('親ページ');

    const leafRow = screen.getByRole('link', { name: /葉ページ/ }).closest('div[draggable]') as HTMLElement;
    const parentRow = screen.getByRole('link', { name: /親ページ/ }).closest('div[draggable]') as HTMLElement;
    expect(leafRow.textContent).toContain('•');
    expect(parentRow.textContent).not.toContain('•');
  });

  it('子を持つ行のフォルダは、開くと開いた形のアイコンに変わる', async () => {
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'parent', title: '親ページ', children: ['child-1'] }]),
    );
    renderSidebar();
    await screen.findByText('親ページ');

    const row = () => screen.getByRole('link', { name: /親ページ/ }).closest('div[draggable]') as HTMLElement;
    expect(row().querySelector('[data-icon="page-group"]')).not.toBeNull();
    expect(row().querySelector('[data-icon="page-group-open"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '親ページ を開く' }));

    expect(row().querySelector('[data-icon="page-group-open"]')).not.toBeNull();
    expect(row().querySelector('[data-icon="page-group"]')).toBeNull();
  });
});

describe('題名で検索（モーダル）', () => {
  let currentPath = '';
  function PathProbe() {
    currentPath = useLocation().pathname;
    return null;
  }

  /** openSearch は木の描画を待ってから検索モーダルを開き、入力欄を返す。 */
  async function openSearch() {
    currentPath = '';
    render(
      <MemoryRouter initialEntries={['/kb']}>
        <PathProbe />
        <KbSidebar spaceId="space-1" />
      </MemoryRouter>,
    );
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    return screen.getByRole('combobox', { name: 'ページを題名・本文で検索' });
  }

  it('入口を押すとモーダルが開き、入力にフォーカスが移る', async () => {
    const input = await openSearch();

    expect(screen.getByRole('dialog', { name: 'ページを検索' })).toBeInTheDocument();
    expect(input).toHaveFocus();
    // サイドバーの木はそのまま（検索が場所の面を奪わない）。
    expect(screen.getByRole('link', { name: /設計メモ/ })).toBeInTheDocument();
  });

  it('入力すると少し待ってからサーバーに問い合わせ、結果がスペースの見出し付きで出る', async () => {
    hoisted.searchPages.mockResolvedValue([
      { id: 'p9', title: 'ヒットしたページ', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
    ]);
    const input = await openSearch();

    fireEvent.change(input, { target: { value: 'ヒット' } });

    await waitFor(() => expect(hoisted.searchPages).toHaveBeenCalledWith('acme', 'ヒット'), {
      timeout: 2000,
    });
    expect(await screen.findByText('ヒットしたページ')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'ページを検索' });
    expect(within(dialog).getByText('開発部')).toBeInTheDocument();
  });

  it('結果を押すとそのページへ移り、モーダルが閉じる', async () => {
    hoisted.searchPages.mockResolvedValue([
      { id: 'p9', title: 'ヒットしたページ', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
    ]);
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'ヒット' } });
    await screen.findByText('ヒットしたページ');

    fireEvent.click(screen.getByRole('option', { name: /ヒットしたページ/ }));

    await waitFor(() => expect(currentPath).toBe('/kb/p9'));
    expect(screen.queryByRole('dialog', { name: 'ページを検索' })).not.toBeInTheDocument();
  });

  it('↑↓ で選び Enter で開ける（キーボードだけで完結する）', async () => {
    hoisted.searchPages.mockResolvedValue([
      { id: 'p9', title: '1件目', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
      { id: 'p10', title: '2件目', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
    ]);
    const input = await openSearch();
    fireEvent.change(input, { target: { value: '件' } });
    await screen.findByText('1件目');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(currentPath).toBe('/kb/p10'));
  });

  it('日本語入力の変換キャンセルの Escape ではモーダルを閉じない（打ちかけの検索語を守る）', async () => {
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'けんさく' } });

    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog', { name: 'ページを検索' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('dialog', { name: 'ページを検索' })).toBeInTheDocument();
  });

  it('Escape で閉じる', async () => {
    const input = await openSearch();

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'ページを検索' })).not.toBeInTheDocument(),
    );
  });

  it('入力を消した後に届いた古い応答は表示しない（空の入力に結果が湧かない）', async () => {
    let resolveSearch: (v: unknown[]) => void = () => {};
    hoisted.searchPages.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSearch = resolve; }),
    );
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'け' } });
    await waitFor(() => expect(hoisted.searchPages).toHaveBeenCalled());

    fireEvent.change(input, { target: { value: '' } });
    await act(async () => {
      resolveSearch([{ id: 'p9', title: 'ヒット', spaceId: 'space-1', spaceName: '開発部', excerpt: '' }]);
    });

    expect(screen.queryByText('ヒット')).not.toBeInTheDocument();
  });

  it('0 件なら「一致するページがありません」と伝える', async () => {
    hoisted.searchPages.mockResolvedValue([]);
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'なにも無い' } });

    expect(await screen.findByText('一致するページがありません')).toBeInTheDocument();
  });

  it('古い検索の応答が、後から届いても新しい結果を上書きしない', async () => {
    let resolveFirst: (v: unknown[]) => void = () => {};
    hoisted.searchPages.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const input = await openSearch();
    fireEvent.change(input, { target: { value: '古い' } });
    await waitFor(() => expect(hoisted.searchPages).toHaveBeenCalledTimes(1));

    hoisted.searchPages.mockResolvedValueOnce([
      { id: 'p-new', title: '新しい結果', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
    ]);
    fireEvent.change(input, { target: { value: '新しい' } });
    await screen.findByText('新しい結果');

    await act(async () => {
      resolveFirst([{ id: 'p-old', title: '古い結果', spaceId: 'space-1', spaceName: '開発部', excerpt: '' }]);
    });

    expect(screen.queryByText('古い結果')).not.toBeInTheDocument();
    expect(screen.getByText('新しい結果')).toBeInTheDocument();
  });

  it('検索に失敗したら再試行の導線を出し、押すともう一度問い合わせる', async () => {
    hoisted.searchPages.mockRejectedValueOnce(new Error('boom'));
    const input = await openSearch();
    fireEvent.change(input, { target: { value: 'け' } });

    expect(await screen.findByText('検索に失敗しました')).toBeInTheDocument();

    hoisted.searchPages.mockResolvedValue([
      { id: 'p9', title: 'ヒット', spaceId: 'space-1', spaceName: '開発部', excerpt: '' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText('ヒット')).toBeInTheDocument();
  });
});

describe('スペースの見出しの操作', () => {
  it('⋯ の「スペースの名前を変更」で見出しが書き換わる', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '開発部 の操作' }));
    fireEvent.click(screen.getByRole('button', { name: 'スペースの名前を変更' }));

    const input = screen.getByRole('textbox', { name: 'スペースの名前' });
    fireEvent.change(input, { target: { value: '技術部' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hoisted.renameSpace).toHaveBeenCalledWith('acme', 'space-1', '技術部'));
    expect(await screen.findByRole('button', { name: '技術部 の操作' })).toBeInTheDocument();
    expect(hoisted.showToast).not.toHaveBeenCalled();
  });

  it('変更に失敗したら知らせが出て、見出しは元のまま', async () => {
    hoisted.renameSpace.mockRejectedValue(new Error('forbidden'));
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '開発部 の操作' }));
    fireEvent.click(screen.getByRole('button', { name: 'スペースの名前を変更' }));
    const input = screen.getByRole('textbox', { name: 'スペースの名前' });
    fireEvent.change(input, { target: { value: '技術部' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', 'スペースの名前を変更できませんでした'),
    );
    // 入力欄は開いたまま・書いた文字も残る（閉じると、保存されたのか分からなくなる）。
    // ページの改名と同じ設計。
    const stillOpen = screen.getByRole('textbox', { name: 'スペースの名前' });
    expect(stillOpen).toHaveValue('技術部');
  });

  it('見出しの ＋ と ⋯ は常時見えている（行の操作はホバーで現れる）', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    const plus = screen.getByRole('button', { name: '開発部 にページを追加' });
    const menu = screen.getByRole('button', { name: '開発部 の操作' });
    // 行の操作（opacity-0 で隠れる）と違い、見出しの操作は常時表示のクラス構成。
    expect(plus.className).not.toContain('opacity-0');
    expect(menu.className).not.toContain('opacity-0');
  });

  it('行の ＋ には何が起きるかのツールチップが付いている', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    const rowPlus = screen.getByRole('button', { name: '設計メモ の下にページを追加' });
    expect(rowPlus).toHaveAttribute('title', '中にページを作成');
  });
});

describe('スペースの切替（段14。W3でヘッダーへ正式に移すまでの繋ぎ）', () => {
  it('開くと自分がアクセスできるスペース一覧が出る', async () => {
    hoisted.fetchMySpaces.mockResolvedValue([
      mySpace('space-1', '開発部'),
      mySpace('space-2', '営業部'),
    ]);
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    expect(await screen.findByRole('link', { name: '営業部' })).toBeInTheDocument();
    expect(hoisted.fetchMySpaces).toHaveBeenCalledWith('acme');
  });

  it('「スペースを作成」から作れる', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    fireEvent.click(await screen.findByRole('button', { name: 'スペースを作成' }));
    hoisted.createSpace.mockResolvedValue(space('space-2', '営業部'));
    fireEvent.change(screen.getByLabelText('スペースの名前'), { target: { value: '営業部' } });
    fireEvent.click(screen.getByRole('button', { name: 'スペースを作る' }));

    await waitFor(() =>
      expect(hoisted.createSpace).toHaveBeenCalledWith('acme', { name: '営業部' }),
    );
  });

  it('やめるでフォームを畳める（作らない）', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    fireEvent.click(await screen.findByRole('button', { name: 'スペースを作成' }));
    expect(screen.getByLabelText('スペースの名前')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(screen.queryByLabelText('スペースの名前')).not.toBeInTheDocument();
    expect(hoisted.createSpace).not.toHaveBeenCalled();
  });

  it('失敗したら知らせを出し、入力は消さない', async () => {
    hoisted.createSpace.mockRejectedValue(new Error('forbidden'));
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    fireEvent.click(await screen.findByRole('button', { name: 'スペースを作成' }));
    fireEvent.change(screen.getByLabelText('スペースの名前'), { target: { value: '営業部' } });
    fireEvent.click(screen.getByRole('button', { name: 'スペースを作る' }));

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', 'スペースを作成できませんでした'),
    );
    expect(screen.getByLabelText('スペースの名前')).toHaveValue('営業部');
  });

  it('「プライベートスペースを作成」から visibility=private で作る', async () => {
    hoisted.createSpace.mockResolvedValue(space('space-9', '自分の下書き', 'private'));
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    fireEvent.click(await screen.findByRole('button', { name: 'プライベートスペースを作成' }));
    fireEvent.change(screen.getByLabelText('プライベートスペースの名前'), {
      target: { value: '自分の下書き' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'プライベートスペースを作る' }));

    await waitFor(() =>
      expect(hoisted.createSpace).toHaveBeenCalledWith('acme', {
        name: '自分の下書き',
        visibility: 'private',
      }),
    );
  });

  it('頼んだ見え方と違うスペースが返ったら失敗として知らせる', async () => {
    // 列が届く前のサーバーが相手だと visibility を持たない応答が返る。そのまま
    // 受け入れると、プライベートのつもりが全員に見えるスペースとして作られたまま
    // 「成功」に見えてしまう。
    hoisted.createSpace.mockResolvedValue(space('space-9', '自分の下書き'));
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: 'スペースを切り替える' }));

    fireEvent.click(await screen.findByRole('button', { name: 'プライベートスペースを作成' }));
    fireEvent.change(screen.getByLabelText('プライベートスペースの名前'), {
      target: { value: '自分の下書き' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'プライベートスペースを作る' }));

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', 'スペースを作成できませんでした'),
    );
  });
});

describe('ページ画面からの通知に木が追従する', () => {
  it('page-created で親を開き、そのスペースの木を取り直す', async () => {
    hoisted.fetchPageTree.mockResolvedValue(
      tree([{ id: 'p1', title: '設計メモ', children: ['p1-child'] }]),
    );
    renderSidebar();
    await screen.findByText('設計メモ');
    const before = hoisted.fetchPageTree.mock.calls.length;

    act(() => {
      emitKbTreeEvent({
        type: 'page-created',
        page: page('p1-new', '新しいページ'),
      });
    });

    await waitFor(() =>
      expect(hoisted.fetchPageTree.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('page-updated が未読込のスペース宛でも壊れない（何も起きない）', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    expect(() =>
      act(() => {
        emitKbTreeEvent({
          type: 'page-updated',
          page: { ...page('other-page', '別スペース'), spaceId: 'space-999' },
        });
      }),
    ).not.toThrow();
  });

  it('page-updated で木の題名が差し替わる', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    act(() => {
      emitKbTreeEvent({ type: 'page-updated', page: page('p1', '書き換わった題名') });
    });

    expect(await screen.findByText('書き換わった題名')).toBeInTheDocument();
  });

  it('workspace-created で他インスタンスが作った所属を一覧へ足す', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    act(() => {
      emitKbTreeEvent({ type: 'workspace-created', workspace: workspace('other', '別会社') });
    });

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    expect(await screen.findByRole('button', { name: '別会社' })).toBeInTheDocument();
  });

  it('workspace-deleted で他インスタンスが消した所属を一覧から外す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社'), workspace('beta', 'Beta 社')]);
    renderSidebar();
    await screen.findByText('設計メモ');

    act(() => {
      emitKbTreeEvent({ type: 'workspace-deleted', workspaceSlug: 'beta' });
    });

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    expect(screen.queryByRole('button', { name: 'Beta 社' })).not.toBeInTheDocument();
  });
});

describe('ワークスペース切替ポップアップ', () => {
  let popPath = '';
  function PopPathProbe() {
    popPath = useLocation().pathname;
    return null;
  }

  it('所属が 1 つでも開け、追加の入口から名前だけで作れる', async () => {
    popPath = '';
    render(
      <MemoryRouter initialEntries={['/kb/p1']}>
        <PopPathProbe />
        <KbSidebar workspaceSlug="acme" spaceId="space-1" activePageId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText('設計メモ');

    // 1 件でも見出しではなくボタン（ポップアップに追加の入口があるため）。
    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    hoisted.createWorkspace.mockResolvedValue(workspace('w-new', '新チーム'));

    fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを追加' }));
    fireEvent.change(screen.getByLabelText('ワークスペースの名前'), {
      target: { value: '新チーム' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを作る' }));

    await waitFor(() =>
      expect(hoisted.createWorkspace).toHaveBeenCalledWith({ name: '新チーム' }),
    );
    // 成功したらポップアップは閉じ、一覧（/kb）へ戻る — 開いていた旧ワークスペースの
    // ページと、新ワークスペースを指すサイドバーが食い違ったまま残らないように。
    await waitFor(() =>
      expect(screen.queryByLabelText('ワークスペースの名前')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(popPath).toBe('/kb'));
  });

  it('日本語入力の変換キャンセルの Escape ではポップアップを閉じない（打ちかけの名前を守る）', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');
    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを追加' }));
    const input = screen.getByLabelText('ワークスペースの名前');
    fireEvent.change(input, { target: { value: '開発ちー' } });

    // 変換中の Escape（isComposing=true）は document のリスナーに届いても無視される。
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByLabelText('ワークスペースの名前')).toHaveValue('開発ちー');

    // Safari は変換中を keyCode 229 で伝える。こちらの分岐でも閉じない。
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(screen.getByLabelText('ワークスペースの名前')).toHaveValue('開発ちー');

    // 変換していない Escape では従来どおり閉じる。
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByLabelText('ワークスペースの名前')).not.toBeInTheDocument(),
    );
  });

  it('失敗したら知らせを出し、入力は消さない', async () => {
    hoisted.createWorkspace.mockRejectedValue(new Error('boom'));
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを追加' }));
    fireEvent.change(screen.getByLabelText('ワークスペースの名前'), {
      target: { value: '新チーム' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ワークスペースを作る' }));

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', 'ワークスペースを作成できませんでした'),
    );
    expect(screen.getByLabelText('ワークスペースの名前')).toHaveValue('新チーム');
  });
});

/** 削除確認モーダル（アプリの ConfirmModal）の中のボタンを押す。 */
function clickInDeleteDialog(name: '削除' | 'キャンセル') {
  const dialog = screen.getByRole('dialog', { name: 'ページを削除' });
  fireEvent.click(within(dialog).getByRole('button', { name }));
}

describe('ページの削除', () => {
  it('⋯ の「削除」で確認してから消し、木を取り直す', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');
    const before = hoisted.fetchPageTree.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    clickInDeleteDialog('削除');

    await waitFor(() => expect(hoisted.deletePage).toHaveBeenCalledWith('acme', 'p1'));
    await waitFor(() =>
      expect(hoisted.fetchPageTree.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('確認で「キャンセル」を選んだら消さない（戻せない操作は必ず確かめる）', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    clickInDeleteDialog('キャンセル');

    expect(hoisted.deletePage).not.toHaveBeenCalled();
  });

  it('失敗したら知らせを出す', async () => {
    hoisted.deletePage.mockRejectedValueOnce(new Error('boom'));
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    clickInDeleteDialog('削除');

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', '削除できませんでした'),
    );
  });

  it('消したら木の通知（page-deleted）を出す — 開いている画面の退避はページ側が判定する', async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeKbTreeEvents(handler);
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    clickInDeleteDialog('削除');

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith({ type: 'page-deleted', pageId: 'p1' }),
    );
    unsubscribe();
  });

  it('削除前に投げた古い木の応答が後から届いても、消したページを蘇らせない', async () => {
    let resolveTree: (t: KbPageTree) => void = () => {};
    hoisted.fetchPageTree.mockImplementationOnce(
      () => new Promise((resolve) => { resolveTree = resolve; }),
    );
    renderSidebar();
    await waitFor(() => expect(hoisted.fetchPageTree).toHaveBeenCalledTimes(1));

    hoisted.fetchPageTree.mockResolvedValue(tree([]));
    await act(async () => {
      resolveTree(tree([{ id: 'p1', title: '設計メモ' }]));
    });
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: '設計メモ の操作' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    clickInDeleteDialog('削除');

    await waitFor(() => expect(hoisted.deletePage).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('設計メモ')).not.toBeInTheDocument());
  });

  it('右クリック → 外側クリックで閉じ、もう一度右クリックで開き直せる', async () => {
    renderSidebar();
    const row = await screen.findByText('設計メモ');

    fireEvent.contextMenu(row);
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument());

    fireEvent.contextMenu(row);
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
  });

  it('右クリック → 名前を変更 → 取消、でメニューが勝手に開き直らない', async () => {
    renderSidebar();
    const row = await screen.findByText('設計メモ');

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('button', { name: '名前を変更' }));
    const input = screen.getByRole('textbox', { name: 'ページの題名' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  });

  it('行の右クリックでも同じ操作メニューが開く', async () => {
    renderSidebar();
    const link = await screen.findByRole('link', { name: '設計メモ' });
    const row = link.parentElement as HTMLElement;

    fireEvent.contextMenu(row);

    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
  });
});

describe('ワークスペースの削除', () => {
  it('確認してから消し、開いていたものを消したら残りの先頭へ移る', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社'), workspace('beta', 'Beta 社')]);
    renderSidebar({ workspaceSlug: 'acme' });
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Acme 社 を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    await waitFor(() => expect(hoisted.deleteWorkspace).toHaveBeenCalledWith('acme'));
  });

  it('やめたら消さない', async () => {
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Acme 社 を削除' }));
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(hoisted.deleteWorkspace).not.toHaveBeenCalled();
  });

  it('失敗したら知らせを出す（会社のワークスペースはサーバーが断る）', async () => {
    hoisted.deleteWorkspace.mockRejectedValue(new Error('forbidden'));
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Acme 社 を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));

    await waitFor(() =>
      expect(hoisted.showToast).toHaveBeenCalledWith('error', 'ワークスペースを削除できませんでした'),
    );
  });

  it('admin でない所属には削除アイコンを出さない（押しても403になるだけの操作を並べない）', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([workspace('acme', 'Acme 社', false)]);
    renderSidebar();
    await screen.findByText('設計メモ');

    fireEvent.click(screen.getByRole('button', { name: /Acme 社/ }));

    expect(screen.queryByRole('button', { name: 'Acme 社 を削除' })).not.toBeInTheDocument();
  });
});
