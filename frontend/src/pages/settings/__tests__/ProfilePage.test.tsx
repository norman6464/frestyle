import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProfilePage from '../ui/ProfilePage';
import { ProfileRepository } from '@/entities/user';

const mockUpload = vi.fn();
vi.mock('../model/useProfileImageUpload', () => ({
  useProfileImageUpload: () => ({
    upload: mockUpload,
    uploading: false,
  }),
}));

vi.mock('@/entities/user/api/profileRepository');

const mockedRepo = vi.mocked(ProfileRepository);

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ローディング中はスピナーが表示される', () => {
    mockedRepo.fetchProfile.mockReturnValue(new Promise(() => {}));
    render(<ProfilePage />);

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('プロファイル取得後にフォームが表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テストユーザー', bio: '自己紹介文', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'プロフィール' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeInTheDocument();
    });
  });

  it('プロファイル取得失敗時にエラーが表示される', async () => {
    mockedRepo.fetchProfile.mockRejectedValue(new Error('取得失敗'));

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('プロフィール取得に失敗しました。')).toBeInTheDocument();
    });
  });

  it('プロファイル取得後に氏名欄が表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テストユーザー', bio: '自己紹介文', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('テストユーザー')).toBeInTheDocument();
    });
  });

  it('プロファイル取得後に自己紹介欄が表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: 'テスト自己紹介', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('テスト自己紹介')).toBeInTheDocument();
    });
  });

  it('送信中はボタンが「保存しています...」になり無効化される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });
    mockedRepo.updateProfile.mockReturnValue(new Promise(() => {}));

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'プロフィールを保存' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'プロフィールを保存' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存しています...' })).toBeDisabled();
    });
  });

  it('氏名が空なら送らず、氏名の欄のそばに理由を出す', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    const name = await screen.findByDisplayValue('テスト');
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByText('保存していない変更があります')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'プロフィールを保存' }));

    await waitFor(() => {
      expect(screen.getByLabelText('氏名')).toHaveAttribute('aria-invalid', 'true');
    });
    expect(screen.getByText('氏名を入力してください。')).toBeInTheDocument();
    expect(mockedRepo.updateProfile).not.toHaveBeenCalled();
  });

  it('アバターのイニシャルが表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テストユーザー', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('テ')).toBeInTheDocument();
    });
  });

  it('カメラボタンが表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByLabelText('プロフィール画像を変更')).toBeInTheDocument();
    });
  });

  it('画像を選ぶと、その場で保存してアバターが更新される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });
    // 前のテストで返らない応答にした設定を持ち越さない（clearAllMocks は実装を残す）。
    mockedRepo.updateProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: 'https://cdn.example.com/profiles/1/avatar.png', status: '', updatedAt: '2026-04-28T00:00:00Z' });
    mockUpload.mockResolvedValue('https://cdn.example.com/profiles/1/avatar.png');

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByLabelText('プロフィール画像を変更')).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId('profile-image-input');
    const file = new File(['test'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(file);
    });
    // 選んだ時点で保存する（保存ボタンを押さなくても反映される）。
    await waitFor(() => {
      expect(mockedRepo.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ avatarUrl: 'https://cdn.example.com/profiles/1/avatar.png' }),
      );
    });
    expect(await screen.findByText('画像を保存しました。')).toBeInTheDocument();
  });

  it('画像アップロード失敗時にエラーメッセージが表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '', updatedAt: '2026-04-28T00:00:00Z' });
    mockUpload.mockResolvedValue(null);

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByLabelText('プロフィール画像を変更')).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId('profile-image-input');
    const file = new File(['test'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('画像のアップロードに失敗しました。')).toBeInTheDocument();
    });
  });

  it('ステータス入力フィールドが表示される', async () => {
    mockedRepo.fetchProfile.mockResolvedValue({ userId: 1, displayName: 'テスト', bio: '', avatarUrl: '', status: '学習中', updatedAt: '2026-04-28T00:00:00Z' });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('学習中')).toBeInTheDocument();
    });
  });
});
