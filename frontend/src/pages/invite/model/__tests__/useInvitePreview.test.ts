import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KbRepository } from '@/entities/kb';
import { useInvitePreview } from '../useInvitePreview';

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return { ...actual, KbRepository: { ...actual.KbRepository, previewInvitation: vi.fn() } };
});

const preview = vi.mocked(KbRepository.previewInvitation);

beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = 'fs_signed_in=; path=/; max-age=0';
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useInvitePreview', () => {
  it('フラグメントのトークンで案内を引き、URL からはすぐ消す', async () => {
    window.history.replaceState(null, '', '/invite#t=abc%2Bdef');
    preview.mockResolvedValue({ status: 'pending', workspaceName: 'Acme 社', email: 'taro@example.com', role: 'editor', scope: 'workspace' });

    const { result } = renderHook(() => useInvitePreview());

    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');
    await waitFor(() => expect(result.current.state.status).toBe('pending'));
    expect(preview).toHaveBeenCalledWith('abc+def');
    expect(result.current.signedIn).toBe(false);
  });

  it('トークンが無ければ API を呼ばず「使えない」', async () => {
    window.history.replaceState(null, '', '/invite');
    const { result } = renderHook(() => useInvitePreview());
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(preview).not.toHaveBeenCalled();
  });

  it('unavailable の応答はそのまま「使えない」、通信の失敗は「確かめられない」', async () => {
    window.history.replaceState(null, '', '/invite#t=x');
    preview.mockResolvedValue({ status: 'unavailable' });
    const first = renderHook(() => useInvitePreview());
    await waitFor(() => expect(first.result.current.state.status).toBe('unavailable'));

    window.history.replaceState(null, '', '/invite#t=y');
    preview.mockRejectedValue(new Error('network'));
    const second = renderHook(() => useInvitePreview());
    await waitFor(() => expect(second.result.current.state.status).toBe('error'));
  });

  it('ログイン済みの目印 Cookie があれば signedIn', () => {
    document.cookie = 'fs_signed_in=1; path=/';
    window.history.replaceState(null, '', '/invite');
    const { result } = renderHook(() => useInvitePreview());
    expect(result.current.signedIn).toBe(true);
  });
});
