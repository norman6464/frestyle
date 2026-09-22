import { useId, useState } from 'react';

export interface NameCreateFormProps {
  /** 何を作るのか（「ワークスペース」「スペース」）。ラベルと文言に使う。 */
  what: string;
  /** 確定。**失敗は投げてくる**ので、握り潰さない限り必ず表に出る。 */
  onCreate: (input: { name: string }) => Promise<void>;
}

/**
 * NameCreateForm は「名前だけ」で何かを作る小さな入力欄（例: ワークスペース / スペース）。
 *
 * 受け取るのは名前だけ。URL に出る短い名前はサーバーが自動で採番する
 * （人に決めさせると日本語の名前から作れず先へ進めないし、URL の重複衝突も人が踏む）。
 *
 * 失敗しても入力を消さない。消すと、打ち直しになるうえ「何が悪かったのか」も分からない。
 */
export default function NameCreateForm({ what, onCreate }: NameCreateFormProps) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim() !== '' && !saving;

  return (
    <form
      className="space-y-2 px-2 py-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSaving(true);
        try {
          await onCreate({ name: name.trim() });
        } catch {
          // 入力はそのまま残す。知らせは呼び出し側が出す。
          setSaving(false);
          return;
        }
        setSaving(false);
        setName('');
      }}
    >
      <div>
        <label htmlFor={nameId} className="mb-0.5 block text-xs text-[var(--color-text-muted)]">
          {what}の名前
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded border border-surface-3 bg-surface-1 px-2 py-1 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
      >
        {saving ? '作成中…' : `${what}を作る`}
      </button>
    </form>
  );
}
