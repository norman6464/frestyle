import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KbTemplatePickerModal from '../KbTemplatePickerModal';

const templates = [{ id: 't-1', name: '議事録', createdAt: '2026-09-01T00:00:00Z' }];

describe('KbTemplatePickerModal の片付け', () => {
  it('閉じた描画の中で打ちかけを捨て、次に開いたときは一覧の頭から始まる', () => {
    const commits = { count: 0 };
    const ui = (isOpen: boolean) => (
      <Profiler
        id="picker"
        onRender={() => {
          commits.count += 1;
        }}
      >
        <KbTemplatePickerModal
          isOpen={isOpen}
          templates={templates}
          loading={false}
          error={null}
          canManageTemplates={false}
          onConfirm={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </Profiler>
    );
    const view = render(ui(true));
    fireEvent.click(screen.getByRole('button', { name: /議事録/ }));
    expect(screen.getByLabelText('新しいページの題名')).toHaveValue('議事録');
    commits.count = 0;

    view.rerender(ui(false));
    // 片付けのためにもう 1 回描き直さない。
    expect(commits.count).toBe(1);

    view.rerender(ui(true));
    expect(screen.getByRole('button', { name: /議事録/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('新しいページの題名')).not.toBeInTheDocument();
  });
});
