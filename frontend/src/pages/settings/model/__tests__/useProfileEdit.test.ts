import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProfileEdit } from '../useProfileEdit';

const mockFetchProfile = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock('@/entities/user/api/profileRepository', () => ({
  default: {
    fetchProfile: (...args: unknown[]) => mockFetchProfile(...args),
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  },
}));

const fixtureProfile = {
  userId: 1,
  displayName: 'テスト太郎',
  bio: '自己紹介文',
  avatarUrl: '',
  status: '学習中',
  updatedAt: '2026-04-28T00:00:00Z',
};

describe('useProfileEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchProfile.mockResolvedValue({ ...fixtureProfile });
    mockUpdateProfile.mockResolvedValue({ ...fixtureProfile });
  });

  it('プロフィール取得成功時にフォームに値がセットされる', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.form.displayName).toBe('テスト太郎');
    expect(result.current.form.bio).toBe('自己紹介文');
    expect(result.current.form.status).toBe('学習中');
  });

  it('プロフィール取得失敗時にエラーメッセージが表示される', async () => {
    mockFetchProfile.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.message?.type).toBe('error');
    expect(result.current.message?.text).toBe('プロフィール取得に失敗しました。');
  });

  it('updateFieldでフォームの値が更新される', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '新しい名前');
    });

    expect(result.current.form.displayName).toBe('新しい名前');
  });

  it('handleUpdate が成功したら、その場に「保存しました」を出し、未保存の変更は無くなる', async () => {
    const { result } = renderHook(() => useProfileEdit());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '新しい名前');
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(result.current.message).toBeNull();
    expect(result.current.justSaved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('氏名が空なら送らず、氏名の欄のエラーにする', async () => {
    const { result } = renderHook(() => useProfileEdit());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '   ');
    });
    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(result.current.nameError).toBe('氏名を入力してください。');
    expect(result.current.message).toBeNull();

    // 書き直したら欄のエラーは消える。
    act(() => {
      result.current.updateField('displayName', '太郎');
    });
    expect(result.current.nameError).toBeNull();
  });

  it('画像だけを保存するときは、文字の欄の書きかけを一緒に送らない', async () => {
    const { result } = renderHook(() => useProfileEdit());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('bio', 'まだ保存していない自己紹介');
    });
    let ok = false;
    await act(async () => {
      ok = await result.current.saveAvatar('https://img.example.com/a.png');
    });

    expect(ok).toBe(true);
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      displayName: 'テスト太郎',
      bio: '自己紹介文',
      avatarUrl: 'https://img.example.com/a.png',
      status: '学習中',
    });
    expect(result.current.form.avatarUrl).toBe('https://img.example.com/a.png');
    // 自己紹介の書きかけは残り、未保存のまま。
    expect(result.current.form.bio).toBe('まだ保存していない自己紹介');
    expect(result.current.dirty).toBe(true);
  });

  it('handleUpdate失敗時にエラーメッセージが表示される', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('Server Error'));

    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(result.current.message?.type).toBe('error');
    expect(result.current.message?.text).toBe('通信エラーが発生しました。');
  });

  it('loading状態が初期trueからfalseに変化する', async () => {
    const { result } = renderHook(() => useProfileEdit());
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('updateFieldでbioフィールドも更新できる', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('bio', '新しい自己紹介');
    });

    expect(result.current.form.bio).toBe('新しい自己紹介');
    expect(result.current.form.displayName).toBe('テスト太郎');
  });

  it('handleUpdate中はsubmittingがtrueになる', async () => {
    let resolveUpdate: (value: unknown) => void;
    mockUpdateProfile.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; })
    );

    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.submitting).toBe(false);

    let updatePromise: Promise<void>;
    act(() => {
      updatePromise = result.current.handleUpdate();
    });

    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolveUpdate!({ ...fixtureProfile });
      await updatePromise!;
    });

    expect(result.current.submitting).toBe(false);
  });

  it('handleUpdate時にupdateProfileにフォーム値が渡される', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '更新太郎');
    });

    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(mockUpdateProfile).toHaveBeenCalledWith({
      displayName: '更新太郎',
      bio: '自己紹介文',
      avatarUrl: '',
      status: '学習中',
    });
  });

  it('氏名が空の場合エラーメッセージが表示されAPIが呼ばれない', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '');
    });

    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(result.current.message?.type).toBe('error');
    expect(result.current.message?.text).toBe('氏名を入力してください。');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('氏名が空白のみの場合エラーメッセージが表示されAPIが呼ばれない', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('displayName', '   ');
    });

    await act(async () => {
      await result.current.handleUpdate();
    });

    expect(result.current.message?.type).toBe('error');
    expect(result.current.message?.text).toBe('氏名を入力してください。');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('updateFieldでstatusフィールドを更新できる', async () => {
    const { result } = renderHook(() => useProfileEdit());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateField('status', 'チャット可能');
    });

    expect(result.current.form.status).toBe('チャット可能');
  });
});
