import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FsIcon from '../FsIcon';
import { fsIcon } from '../fsIconFactory';
import { FS_ICON_NAMES } from '../fsIconParts';
import FsIllustration from '../FsIllustration';

describe('FsIcon', () => {
  it('既定は飾り。読み上げから隠し、テスト用に名前を data-icon で持つ', () => {
    const { container } = render(<FsIcon name="home" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).toHaveAttribute('data-icon', 'home');
  });

  it('title を渡すと意味を持つ絵になり、名前で引ける', () => {
    render(<FsIcon name="alert-circle" title="失敗" />);
    const img = screen.getByRole('img', { name: '失敗' });
    expect(img).not.toHaveAttribute('aria-hidden');
    expect(img.querySelector('title')).toHaveTextContent('失敗');
  });

  it('全部の名前が 1 本以上の線を持ち、線の設定は共通', () => {
    for (const name of FS_ICON_NAMES) {
      const { container, unmount } = render(<FsIcon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.querySelectorAll('path').length, name).toBeGreaterThan(0);
      expect(svg).toHaveAttribute('stroke-width', '1.75');
      expect(svg).toHaveAttribute('stroke-linecap', 'round');
      unmount();
    }
  });

  it('塗りの部分は線ではなく面（stroke なし・fill あり）', () => {
    const { container } = render(<FsIcon name="status-progress" />);
    const filled = container.querySelector('path[fill="currentColor"]');
    expect(filled).not.toBeNull();
    expect(filled).toHaveAttribute('stroke', 'none');
  });

  it('大きさと色は className と style で決まる', () => {
    const { container } = render(<FsIcon name="check" className="h-3 w-3" style={{ color: '#4d7c0f' }} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('h-3', 'w-3');
    expect(svg).toHaveStyle({ color: '#4d7c0f' });
  });

  it('fsIcon は className を受け取る部品として使える', () => {
    const Bound = fsIcon('inbox');
    const { container } = render(<Bound className="h-8 w-8" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-icon', 'inbox');
    expect(container.querySelector('svg')).toHaveClass('h-8');
  });
});

describe('FsIllustration', () => {
  it('飾りとして隠し、名前を data-illustration で持つ', () => {
    const { container } = render(<FsIllustration name="empty-backlog" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-illustration', 'empty-backlog');
    expect(svg.children.length).toBeGreaterThan(2);
  });

  it('色はトークン。生の色値を持たない', () => {
    const { container } = render(<FsIllustration name="load-error" />);
    const html = container.innerHTML;
    expect(html).toContain('var(--fs-action-soft)');
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
