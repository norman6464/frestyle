import { useEffect, useRef, useState } from 'react';
import { ConfirmModal, FsIcon } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import type { KbDropTarget, KbMoveActions } from '@/entities/kb';

export interface KbRowActionsProps {
  /** 読み上げに使う対象の名前（「〜の下にページを追加」のように読ませる）。 */
  label: string;
  onCreateChild: () => void;
  /** 未指定ならメニュー自体を出さない（スペースの見出しなど、名前を変えられない行）。 */
  onRename?: () => void;
  onArchive?: () => void;
  /** 物理削除（戻せない）。確認は呼び出し側ではなくここで取る（口を 1 つにする）。 */
  onDelete?: () => void;
  /** 行の右クリックからメニューを開くための合図。増えたら開く（0 は無視）。 */
  openSignal?: number;
  /** 動かせる 4 つの向き。null の向きは項目自体を出さない（押せない項目を並べない）。 */
  moves?: KbMoveActions;
  onMove?: (target: KbDropTarget) => void;
}

/**
 * KbRowActions は行の右端に出る操作（＋ と ⋯）。
 *
 * 常に見えていると木の形が読みにくくなるので、**触れているときと、キーボードで
 * たどり着いたときだけ**濃くする。`opacity` で消しているだけで DOM からは外さない —
 * 外すと Tab の順序が触れるたびに変わり、キーボードでは追えなくなる。
 */
export default function KbRowActions({
  label,
  onCreateChild,
  onRename,
  onArchive,
  onDelete,
  moves,
  onMove,
  openSignal = 0,
}: KbRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // 削除の確認。ブラウザ標準の confirm ではなくアプリのモーダルで確かめる
  // （見た目が周りと揃い、文言・ボタンの並びをこちらで統べられる）。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // 右クリック（コンテキストメニュー）からも同じメニューを開く。別のメニューを
  // 作らないのは、項目と失敗の扱いを 2 つ持たないため。
  //
  // 「増えたときだけ」開く。マウント時の値では開かない — 合図は親（行）が持ち、
  // この部品は改名中にアンマウントされるため、素直に openSignal > 0 で開くと
  // 「一度でも右クリックした行は、改名を終えるたびにメニューが勝手に開く」。
  const seenSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal > seenSignal.current) setMenuOpen(true);
    seenSignal.current = openSignal;
  }, [openSignal]);

  // 外を押したら・Escape で閉じる。Escape のときは「…」へフォーカスを戻す。
  useDismissOnOutside(menuOpen, [containerRef], () => setMenuOpen(false), { returnFocus: menuTriggerRef });

  return (
    <div
      ref={containerRef}
      className={`relative flex shrink-0 items-center gap-0.5 transition-opacity ${
        // マウスを乗せられない端末（タッチ）では常に見せる。乗せたときだけ出す作りだと、
        // 名前変更・移動・アーカイブ・削除の入口がタッチ端末では一度も見えない。
        menuOpen ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
      }`}
    >
      {onRename && (
        <>
          <button
            ref={menuTriggerRef}
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-expanded={menuOpen}
            aria-label={`${label} の操作`}
            className="ui-hit inline-flex items-center justify-center rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-3"
          >
            <FsIcon name="more" className="h-4 w-4" />
          </button>

          {menuOpen && (
            // 素のボタンの一覧として出す（menu を名乗ると矢印キーでの移動を約束することになる）。
            <ul className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename();
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                >
                  名前を変更
                </button>
              </li>
              {/*
                動かす項目。**ドラッグと同じ行き先を、同じ経路で送る。**
                キーボードだけの人にはこれが唯一の並べ替えの手段になるので、
                押せない向きは項目ごと出さない（押しても何も起きない項目を並べない）。
              */}
              {moves &&
                onMove &&
                (
                  [
                    ['up', '上へ移動'],
                    ['down', '下へ移動'],
                    ['indent', 'ひとつ内側へ'],
                    ['outdent', 'ひとつ外側へ'],
                  ] as const
                ).map(([key, text]) => {
                  const target = moves[key];
                  if (!target) return null;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onMove(target);
                        }}
                        className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                      >
                        {text}
                      </button>
                    </li>
                  );
                })}
              {onArchive && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onArchive();
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                  >
                    アーカイブ
                  </button>
                </li>
              )}
              {onDelete && (
                <li className="border-t border-surface-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      // 戻せない操作なので、実行の前に必ず確かめる（アーカイブとの違い）。
                      setConfirmingDelete(true);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-danger-ink hover:bg-surface-2"
                  >
                    削除
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      <button
        type="button"
        onClick={onCreateChild}
        aria-label={`${label} の下にページを追加`}
        title="中にページを作成"
        className="ui-hit inline-flex items-center justify-center rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-3"
      >
        <FsIcon name="plus" className="h-4 w-4" />
      </button>

      {onDelete && (
        <ConfirmModal
          isOpen={confirmingDelete}
          title="ページを削除"
          message={`「${label}」を中のページごと削除します（アーカイブ済みの子ページも含みます）。元に戻せません。`}
          confirmText="削除"
          isDanger
          icon="trash"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
