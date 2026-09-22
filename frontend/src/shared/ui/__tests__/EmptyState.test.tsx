import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EmptyState from '../EmptyState';
import { fsIcon } from '../icons/fsIconFactory';

describe('EmptyState', () => {
  it('タイトルを表示する', () => {
    render(<EmptyState icon={fsIcon('chat')} title="データがありません" />);
    expect(screen.getByText('データがありません')).toBeDefined();
  });

  it('説明文を表示する', () => {
    render(
      <EmptyState
        icon={fsIcon('chat')}
        title="テスト"
        description="詳しい説明テキスト"
      />
    );
    expect(screen.getByText('詳しい説明テキスト')).toBeDefined();
  });

  it('アクションボタンを表示しクリックできる', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={fsIcon('chat')}
        title="テスト"
        action={{ label: 'ユーザーを追加', onClick }}
      />
    );
    const button = screen.getByText('ユーザーを追加');
    expect(button).toBeDefined();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('アクションなしの場合ボタンを表示しない', () => {
    render(<EmptyState icon={fsIcon('chat')} title="テスト" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('渡したアイコンが描かれる（別のアイコンでは通らない）', () => {
    const { container } = render(<EmptyState icon={fsIcon('chat')} title="テスト" />);
    // svg があるだけでは別の絵でも通ってしまう。FsIcon が持つ data-icon で名前まで見る。
    expect(container.querySelector('svg')).toHaveAttribute('data-icon', 'chat');
  });

  it('説明文なしの場合説明が表示されない', () => {
    const { container } = render(<EmptyState icon={fsIcon('chat')} title="テスト" />);
    const paragraphs = container.querySelectorAll('p');
    // タイトルのみ
    const texts = Array.from(paragraphs).map(p => p.textContent);
    expect(texts).not.toContain('詳しい説明テキスト');
  });

  it('異なるアイコンでも正しく表示される', () => {
    const { container } = render(
      <EmptyState icon={fsIcon('sparkles')} title="AIアシスタントへようこそ" description="質問や相談を何でも聞いてください" />
    );
    expect(screen.getByText('AIアシスタントへようこそ')).toBeDefined();
    expect(screen.getByText('質問や相談を何でも聞いてください')).toBeDefined();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('タイトルは見出し（既定は h3）として読み上げられる', () => {
    render(<EmptyState icon={fsIcon('chat')} title="見出しテスト" />);
    expect(screen.getByRole('heading', { level: 3, name: '見出しテスト' })).toBeInTheDocument();
  });

  it('アクションボタンに説明文とともに表示できる', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={fsIcon('chat')}
        title="テスト"
        description="説明テキスト"
        action={{ label: '操作', onClick }}
      />
    );
    expect(screen.getByText('説明テキスト')).toBeDefined();
    expect(screen.getByText('操作')).toBeDefined();
  });

  it('アイコンがページ背景と同色(bg-surface-2)の丸い背景内に表示される', () => {
    const { container } = render(<EmptyState icon={fsIcon('chat')} title="テスト" />);
    const iconWrapper = container.querySelector('.bg-surface-2.rounded-full');
    expect(iconWrapper).toBeTruthy();
    expect(iconWrapper?.querySelector('svg')).toBeTruthy();
  });
});
