import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import KbSpaceLayout from '../KbSpaceLayout';
import { useKbSpaceOutlet } from '../../model/kbSpaceOutlet';

const hoisted = vi.hoisted(() => ({
  useKbSpaceEntry: vi.fn(),
  navigate: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return { ...actual, useKbSpaceEntry: hoisted.useKbSpaceEntry };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => hoisted.navigate };
});

const EMPTY = { workspaceSlug: null, space: null, noSpaces: false, notFound: false, loading: false, error: null };

function Child() {
  const { workspaceSlug, space } = useKbSpaceOutlet();
  return <p>{`${workspaceSlug} / ${space.name}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<KbSpaceLayout />}>
          <Route path="/kb/spaces" element={<Child />} />
          <Route path="/kb/spaces/:spaceId" element={<Child />} />
          <Route path="/kb/spaces/:spaceId/pages" element={<Child />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KbSpaceLayout', () => {
  it('子の画面の URL からスペースを解決し、解決したスペースを子へ渡す', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({
      ...EMPTY,
      workspaceSlug: 'acme',
      space: { id: 'space-1', name: '開発部', role: 'editor' },
      retry: hoisted.retry,
    });
    renderAt('/kb/spaces/space-1/pages');

    expect(hoisted.useKbSpaceEntry.mock.calls[0][0]).toBe('space-1');
    expect(screen.getByText('acme / 開発部')).toBeInTheDocument();
  });

  it('別のスペースへ移った直後、前のスペースの中身を新しい URL の下に描かない', () => {
    // URL は space-2 に変わったが、解決はまだ前の space-1 のまま（解決し直す effect の前の描画）。
    hoisted.useKbSpaceEntry.mockReturnValue({
      ...EMPTY,
      workspaceSlug: 'acme',
      space: { id: 'space-1', name: '開発部', role: 'editor' },
      retry: hoisted.retry,
    });
    renderAt('/kb/spaces/space-2/pages');

    expect(screen.queryByText(/開発部/)).toBeNull();
    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
  });

  it('スペースが見つからなければ、行き止まりにせずスペースの入口へ戻れる', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({ ...EMPTY, notFound: true, retry: hoisted.retry });
    renderAt('/kb/spaces/space-9');

    expect(screen.getByRole('heading', { level: 1, name: 'このスペースは見つかりませんでした' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'スペース一覧へ戻る' }));
    expect(hoisted.navigate).toHaveBeenCalledWith('/kb/spaces');
  });

  it('読み込めなければ「見つからない」とは言わず、取り直せる', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({ ...EMPTY, error: 'スペースを読み込めませんでした。', retry: hoisted.retry });
    renderAt('/kb/spaces/space-1');

    expect(screen.getByRole('alert')).toHaveTextContent('スペースを読み込めませんでした。');
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(hoisted.retry).toHaveBeenCalledOnce();
  });

  it('読み込み中は子の画面を描かない', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({ ...EMPTY, loading: true, retry: hoisted.retry });
    renderAt('/kb/spaces/space-1');

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.queryByText(/開発部/)).toBeNull();
  });

  it('アクセスできるスペースが無ければ、作る場所を案内する', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({ ...EMPTY, noSpaces: true, retry: hoisted.retry });
    renderAt('/kb/spaces');

    expect(screen.getByRole('heading', { level: 1, name: 'アクセスできるスペースがありません' })).toBeInTheDocument();
  });

  it('素の /kb/spaces では ?workspace= の対象を入口へ渡す', () => {
    hoisted.useKbSpaceEntry.mockReturnValue({ ...EMPTY, loading: true, retry: hoisted.retry });
    renderAt('/kb/spaces?workspace=acme');

    expect(hoisted.useKbSpaceEntry.mock.calls[0][0]).toBeUndefined();
    expect(hoisted.useKbSpaceEntry.mock.calls[0][2]).toBe('acme');
  });
});
