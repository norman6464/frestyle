import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SkeletonRows from '../SkeletonRows';

describe('SkeletonRows', () => {
  it('何を読み込んでいるかを status の名前で伝える（0 件と取り違えない）', () => {
    render(<SkeletonRows label="コメントを読み込み中" />);

    expect(screen.getByRole('status', { name: 'コメントを読み込み中' })).toBeInTheDocument();
  });

  it('骨組みの線は読み上げに出さない', () => {
    const { container } = render(<SkeletonRows label="読み込み中" rows={3} />);

    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.children).toHaveLength(3);
  });

  it('既定は 2 行（件数はまだ分からないので固定）', () => {
    const { container } = render(<SkeletonRows label="読み込み中" shape="blocks" />);

    expect(container.querySelector('[aria-hidden="true"]')?.children).toHaveLength(2);
  });
});
