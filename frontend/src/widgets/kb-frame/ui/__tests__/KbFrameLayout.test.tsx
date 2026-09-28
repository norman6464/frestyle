import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import KbFrameLayout from '../KbFrameLayout';
import type { KbPageRowProps } from '../KbPageRow';
import { useKbFrameLocation } from '../../model/kbFrameLocation';
import type { KbPage, KbPageTree } from '@/entities/kb';
import { queryWrapper } from '@/test/queryClient';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchSpaces: vi.fn(),
  fetchMySpaces: vi.fn(),
  fetchPageTree: vi.fn(),
}));

// 木の行が何回描き直されたかを数える（描き直す範囲の検査に使う）。中身は本物をそのまま描く。
const rowRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../KbPageRow', async () => {
  const actual = await vi.importActual<typeof import('../KbPageRow')>('../KbPageRow');
  const Row = actual.default;
  return {
    ...actual,
    default: (props: KbPageRowProps) => {
      rowRenders.count += 1;
      return <Row {...props} />;
    },
  };
});

vi.mock('@/shared/lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn(), removeToast: vi.fn() }),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    fetchSpaces: hoisted.fetchSpaces,
    fetchMySpaces: hoisted.fetchMySpaces,
    fetchPageTree: hoisted.fetchPageTree,
  },
}));
vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: { fetchWorkspaces: hoisted.fetchWorkspaces },
}));

function page(id: string, title: string): KbPage {
  return {
    id,
    spaceId: 'space-1',
    title,
    createdByUserId: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

// 「親」の下に「子」が 1 枚。開閉が画面をまたいで残るかを見るため、子を持つ段を置く。
const TREE: KbPageTree = {
  pages: [
    {
      page: page('p1', '親'),
      hasHiddenChildren: false,
      parentArchived: false,
      children: [{ page: page('c1', '子'), hasHiddenChildren: false, parentArchived: false, children: [] }],
    },
    { page: page('p2', '2番目'), hasHiddenChildren: false, parentArchived: false, children: [] },
  ],
  hasHiddenChildren: false,
};

/** ページ画面の代わり。取得済みのページとして位置を知らせ、本文の中に自分の状態を持つ。 */
function FakePage() {
  const { pageId } = useParams<{ pageId: string }>();
  useKbFrameLocation({ workspaceSlug: 'acme', spaceId: 'space-1', activePageId: pageId });
  const [edits, setEdits] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setEdits((n) => n + 1)}>
        本文を書き換える（{edits}）
      </button>
      <Link to="/kb/loading/p9">読み込み中のページへ</Link>
      <Link to="/kb/acme/members">ワークスペースのメンバー画面へ</Link>
      <Link to="/kb/beta/members">別のワークスペースのメンバー</Link>
    </div>
  );
}

/** 取得を待っている間のページ画面の代わり。まだスペースが分からないので知らせない。 */
function FakeLoadingPage() {
  const { pageId } = useParams<{ pageId: string }>();
  useKbFrameLocation({ activePageId: pageId });
  return <p>ページを読み込んでいます</p>;
}

function FakeAllPages() {
  const { spaceId } = useParams<{ spaceId: string }>();
  useKbFrameLocation({ workspaceSlug: 'acme', spaceId });
  return <h1>すべてのページの本文</h1>;
}

function FakeMembers() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  useKbFrameLocation({ workspaceSlug, showPagePanel: false });
  return (
    <div>
      <h1>メンバーの本文</h1>
      <Link to="/kb/p2">ページへ戻る</Link>
    </div>
  );
}

function renderLayout(path = '/kb/p2') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<KbFrameLayout />}>
          <Route path="/kb/:pageId" element={<FakePage />} />
          <Route path="/kb/loading/:pageId" element={<FakeLoadingPage />} />
          <Route path="/kb/spaces/:spaceId/pages" element={<FakeAllPages />} />
          <Route path="/kb/:workspaceSlug/members" element={<FakeMembers />} />
        </Route>
      </Routes>
    </MemoryRouter>, { wrapper: queryWrapper() },
  );
}

/** 木を読み込み、「親」の段を開いた状態にする。 */
async function openParentFolder() {
  await screen.findByText('親');
  fireEvent.click(screen.getByRole('button', { name: '親 を開く' }));
  expect(await screen.findByText('子')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  rowRenders.count = 0;
  hoisted.fetchWorkspaces.mockResolvedValue([
    { slug: 'acme', name: 'Acme 社', createdAt: '2026-08-01T00:00:00Z', canManage: true },
    { slug: 'beta', name: 'Beta 社', createdAt: '2026-08-01T00:00:00Z', canManage: true },
  ]);
  hoisted.fetchSpaces.mockImplementation(async (slug: string) =>
    slug === 'acme'
      ? [{ id: 'space-1', key: 'space-1', name: '開発部', visibility: 'workspace', createdAt: '2026-08-01T00:00:00Z' }]
      : [],
  );
  hoisted.fetchMySpaces.mockResolvedValue([]);
  hoisted.fetchPageTree.mockResolvedValue(TREE);
});

describe('KbFrameLayout', () => {
  it('画面を移っても枠を作り直さない（取り直さず、開いていたフォルダも開いたまま）', async () => {
    renderLayout();
    await openParentFolder();

    fireEvent.click(screen.getByRole('link', { name: 'すべてのページ' }));

    expect(await screen.findByRole('heading', { name: 'すべてのページの本文' })).toBeInTheDocument();
    expect(screen.getByText('子')).toBeInTheDocument();
    expect(hoisted.fetchWorkspaces).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchSpaces).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchPageTree).toHaveBeenCalledTimes(1);
  });

  it('スペースがまだ分からない画面へ移っても、前の木を捨てない', async () => {
    renderLayout();
    await openParentFolder();

    fireEvent.click(screen.getByRole('link', { name: '読み込み中のページへ' }));

    expect(await screen.findByText('ページを読み込んでいます')).toBeInTheDocument();
    expect(screen.getByText('子')).toBeInTheDocument();
    expect(hoisted.fetchPageTree).toHaveBeenCalledTimes(1);
  });

  it('本文の中で状態が変わっても、木の行は描き直さない', async () => {
    renderLayout();
    await openParentFolder();
    const settled = rowRenders.count;

    fireEvent.click(screen.getByRole('button', { name: /本文を書き換える/ }));
    fireEvent.click(screen.getByRole('button', { name: /本文を書き換える/ }));

    expect(screen.getByRole('button', { name: '本文を書き換える（2）' })).toBeInTheDocument();
    expect(rowRenders.count).toBe(settled);

    // 木そのものの操作（段を閉じる）では描き直す。数え方そのものが効いていることの確かめも兼ねる。
    fireEvent.click(screen.getByRole('button', { name: '親 を閉じる' }));
    expect(rowRenders.count).toBeGreaterThan(settled);
  });

  it('スペースを持たない画面では左の列もスペースも出さず、戻っても木を取り直さない', async () => {
    renderLayout();
    await openParentFolder();
    expect(screen.getByRole('navigation', { name: '開発部 の画面' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'ワークスペースのメンバー画面へ' }));
    expect(await screen.findByRole('heading', { name: 'メンバーの本文' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'ページ' })).not.toBeInTheDocument();
    // ワークスペース単位の画面なので、前に居たスペースを文脈バーで名乗らない。
    expect(screen.queryByRole('navigation', { name: '開発部 の画面' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'ページへ戻る' }));
    expect(await screen.findByRole('complementary', { name: 'ページ' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '開発部 の画面' })).toBeInTheDocument();
    expect(screen.getByText('子')).toBeInTheDocument();
    expect(hoisted.fetchPageTree).toHaveBeenCalledTimes(1);
  });

  it('別のワークスペースの画面へ移ったら、前のスペースの木をそのワークスペースの中として取りに行かない', async () => {
    renderLayout();
    await screen.findByText('親');

    fireEvent.click(screen.getByRole('link', { name: '別のワークスペースのメンバー' }));

    expect(await screen.findByRole('heading', { name: 'メンバーの本文' })).toBeInTheDocument();
    await waitFor(() => expect(hoisted.fetchSpaces).toHaveBeenCalledWith('beta'));
    expect(hoisted.fetchPageTree).not.toHaveBeenCalledWith('beta', 'space-1', expect.anything());
  });
});
