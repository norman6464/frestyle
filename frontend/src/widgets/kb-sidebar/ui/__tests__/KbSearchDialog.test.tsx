import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import KbSearchDialog from '../KbSearchDialog';

const hoisted = vi.hoisted(() => ({ searchPages: vi.fn() }));

vi.mock('@/entities/kb', async () => {
  const actual = await vi.importActual<typeof import('@/entities/kb')>('@/entities/kb');
  return { ...actual, KbRepository: { searchPages: hoisted.searchPages } };
});

beforeEach(() => {
  vi.clearAllMocks();
  // 応答は返さない（打った直後の描画だけを見る）。
  hoisted.searchPages.mockImplementation(() => new Promise(() => {}));
});

/** 画面に反映された回数（React の commit）を数えながら描く。 */
function renderCounted() {
  const commits = { count: 0 };
  render(
    <Profiler
      id="search"
      onRender={() => {
        commits.count += 1;
      }}
    >
      <MemoryRouter>
        <KbSearchDialog workspaceSlug="acme" spaces={[]} onClose={vi.fn()} />
      </MemoryRouter>
    </Profiler>,
  );
  return commits;
}

describe('KbSearchDialog の描き直し', () => {
  it('打った描画の中で「検索中」にする（検索中にするためにもう 1 回描き直さない）', () => {
    const commits = renderCounted();
    commits.count = 0;

    fireEvent.change(screen.getByLabelText('ページを題名・本文で検索'), { target: { value: '設計' } });

    expect(screen.getByText('検索中…')).toBeInTheDocument();
    expect(commits.count).toBe(1);
  });

  it('空に戻した描画の中で、はじめの案内に戻す', () => {
    const commits = renderCounted();
    const input = screen.getByLabelText('ページを題名・本文で検索');
    fireEvent.change(input, { target: { value: '設計' } });
    commits.count = 0;

    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByText('ワークスペース全体から題名・本文で探します')).toBeInTheDocument();
    expect(commits.count).toBe(1);
  });
});
