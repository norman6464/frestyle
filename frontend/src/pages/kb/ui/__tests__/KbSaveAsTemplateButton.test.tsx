import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import KbSaveAsTemplateButton from '../KbSaveAsTemplateButton';

const hoisted = vi.hoisted(() => ({ createPageTemplate: vi.fn(), showToast: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { createPageTemplate: hoisted.createPageTemplate },
}));

vi.mock('@/shared/lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: hoisted.showToast, toasts: [], removeToast: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KbSaveAsTemplateButton', () => {
  it('保存したら、どのスペースのテンプレートの一覧も取り直させる（ワークスペース全体のテンプレートはどこにも出る）', async () => {
    hoisted.createPageTemplate.mockResolvedValue({ id: 't-1', name: '議事録', spaceId: null, createdAt: '' });
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.spaceTemplates('acme', 's-1'), []);
    client.setQueryData(kbKeys.spaceTemplates('acme', 's-2'), []);
    render(<KbSaveAsTemplateButton workspaceSlug="acme" pageId="p-1" spaceId="s-1" />, {
      wrapper: queryWrapper(client),
    });

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートとして保存' }));
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '議事録' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(hoisted.showToast).toHaveBeenCalledWith('success', 'テンプレートとして保存しました'));
    expect(client.getQueryState(kbKeys.spaceTemplates('acme', 's-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.spaceTemplates('acme', 's-2'))?.isInvalidated).toBe(true);
  });

  it('保存に失敗したら、一覧はそのまま', async () => {
    hoisted.createPageTemplate.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.spaceTemplates('acme', 's-1'), []);
    render(<KbSaveAsTemplateButton workspaceSlug="acme" pageId="p-1" spaceId="s-1" />, {
      wrapper: queryWrapper(client),
    });

    fireEvent.click(screen.getByRole('button', { name: 'テンプレートとして保存' }));
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '議事録' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(hoisted.createPageTemplate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('テンプレート名')).toBeInTheDocument());
    expect(client.getQueryState(kbKeys.spaceTemplates('acme', 's-1'))?.isInvalidated).toBe(false);
  });
});
