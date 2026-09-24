import { useId, useState } from 'react';

export interface NameCreateFormProps {
  /** 何を作るのか（「ワークスペース」「スペース」）。ラベルと文言に使う。 */
  what: string;
  /** 確定。**失敗は投げてくる**ので、握り潰さない限り必ず表に出る。 */
  onCreate: (input: { name: string }) => Promise<void>;
  /** 渡すと「やめる」を出す。開いた欄を閉じる手立てが無いと、戻る道が画面の外にしか無くなる。 */
  onCancel?: () => void;
  /** 最初から入れておく名前（連番の既定など）。 */
  initialName?: string;
  /** 押して開いた欄なら true。開いたのにもう一度欄を押させない。 */
  autoFocus?: boolean;
  /**
   * stacked は見出し付きで縦に積む（サイドバーや空の画面の真ん中）。
   * inline は 1 行に並べる（一覧の上の操作の帯）。見出しは読み上げにだけ残す。
   */
  layout?: 'stacked' | 'inline';
}

/**
 * NameCreateForm は「名前だけ」で何かを作る小さな入力欄（例: ワークスペース / スペース）。
 *
 * 受け取るのは名前だけ。URL に出る短い名前はサーバーが自動で採番する
 * （人に決めさせると日本語の名前から作れず先へ進めないし、URL の重複衝突も人が踏む）。
 *
 * 失敗しても入力を消さない。消すと、打ち直しになるうえ「何が悪かったのか」も分からない。
 */
export default function NameCreateForm({
  what,
  onCreate,
  onCancel,
  initialName = '',
  autoFocus = false,
  layout = 'stacked',
}: NameCreateFormProps) {
  const nameId = useId();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim() !== '' && !saving;
  const inline = layout === 'inline';

  return (
    <form
      className={inline ? 'flex w-full flex-wrap items-center gap-2' : 'space-y-2 px-2 py-3'}
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
      onKeyDown={(event) => {
        // 変換中の Esc は変換の取り消し。欄まで閉じると打ちかけの字が消える
        // （Safari は変換中の keydown を isComposing ではなく keyCode 229 で知らせる）。
        if (!onCancel || event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
        // 伝播は止めない。切替の一覧などの中に置いたときは、同じ Esc で外の一覧ごと閉じる。
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={inline ? 'min-w-0 flex-1 basis-48' : undefined}>
        <label
          htmlFor={nameId}
          className={inline ? 'sr-only' : 'mb-1 block text-xs text-[var(--color-text-muted)]'}
        >
          {what}の名前
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          // 押して開いた欄なので、開いた直後に打ち始められるようにする。
          autoFocus={autoFocus}
          placeholder={inline ? `${what}の名前` : undefined}
          className="ui-control w-full rounded-md border border-surface-3 bg-surface-1 px-2.5 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
      </div>
      <div className={inline ? 'flex items-center gap-2' : 'flex flex-col gap-1'}>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`ui-control rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40 ${
            inline ? '' : 'w-full'
          }`}
        >
          {saving ? '作成中…' : `${what}を作る`}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={`ui-control rounded-lg px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 ${
              inline ? '' : 'w-full'
            }`}
          >
            やめる
          </button>
        )}
      </div>
    </form>
  );
}
