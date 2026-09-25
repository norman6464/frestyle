import { useState, useEffect, useCallback, useRef } from 'react';
import { ProfileRepository } from '@/entities/user';
import type { FormMessage } from '@/shared/ui/FormMessage';
import type { Profile } from '@/entities/user';

/**
 * useProfileEdit — ProfilePage で「氏名 / 自己紹介 / アイコン / ステータス」
 * の編集を扱う。フォーム形は backend `domain.ProfileView` のサブセット。
 *
 * displayName は OIDC ログイン時に id_token の `name` claim を初期値として
 * セットするため（auth_handler.upsertUserFromIDToken）、 通常は氏名がそのまま入る。
 * ユーザは ProfilePage 上で自由に書き換え可能。
 *
 * 最後に保存できた値（saved）を持ち、フォームとの差で「保存していない変更」を判定する。
 * 画像は選んだ時点で保存する（アップロードだけ済んで保存されないまま離れる、を無くす）。
 * そのとき文字の欄の書きかけは一緒に保存しない（保存済みの値に画像だけを差し替えて送る）。
 */
type ProfileForm = Pick<Profile, 'displayName' | 'bio' | 'avatarUrl' | 'status'>;

const EMPTY_FORM: ProfileForm = {
  displayName: '',
  bio: '',
  avatarUrl: '',
  status: '',
};

/** 保存しました、を出しておく時間。 */
const SAVED_VISIBLE_MS = 4000;

function sameText(a: ProfileForm, b: ProfileForm): boolean {
  return a.displayName === b.displayName && a.bio === b.bio && a.status === b.status;
}

export function useProfileEdit() {
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saved, setSaved] = useState<ProfileForm>(EMPTY_FORM);
  // 取得や通信の失敗はフォームの上に出す（欄の直しで解けるもの＝氏名の空は欄のそばに出す）。
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 保存できたことを、押した保存ボタンのそばに少しの間だけ出す。
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const data = await ProfileRepository.fetchProfile();
        const loaded = {
          displayName: data.displayName ?? '',
          bio: data.bio ?? '',
          avatarUrl: data.avatarUrl ?? '',
          status: data.status ?? '',
        };
        setForm(loaded);
        setSaved(loaded);
      } catch {
        setMessage({ type: 'error', text: 'プロフィール取得に失敗しました。' });
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const showSaved = useCallback(() => {
    setJustSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_VISIBLE_MS);
  }, []);

  const updateField = useCallback(<K extends keyof ProfileForm>(field: K, value: ProfileForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setJustSaved(false);
    if (field === 'displayName') setNameError(null);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!form.displayName.trim()) {
      setNameError('氏名を入力してください。');
      return;
    }
    setSubmitting(true);
    try {
      await ProfileRepository.updateProfile(form);
      setSaved(form);
      setMessage(null);
      showSaved();
    } catch {
      setMessage({ type: 'error', text: '通信エラーが発生しました。' });
    } finally {
      setSubmitting(false);
    }
  }, [form, showSaved]);

  /**
   * 画像だけを保存する（選んだ時点で呼ぶ）。保存済みの値に画像を差し替えて送るので、文字の欄の
   * 書きかけは保存しない。成功したら true。
   */
  const saveAvatar = useCallback(
    async (avatarUrl: string): Promise<boolean> => {
      try {
        const next = { ...saved, avatarUrl };
        await ProfileRepository.updateProfile(next);
        setSaved(next);
        setForm((prev) => ({ ...prev, avatarUrl }));
        return true;
      } catch {
        return false;
      }
    },
    [saved],
  );

  return {
    form,
    message,
    setMessage,
    nameError,
    loading,
    submitting,
    justSaved,
    /** 文字の欄に保存していない変更がある。 */
    dirty: !loading && !sameText(form, saved),
    updateField,
    handleUpdate,
    saveAvatar,
  };
}
