import { useEffect, useRef, useState, type Ref } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import { useToast } from '@/shared/lib/hooks/useToast';
import { NameCreateForm, FsIcon } from '@/shared/ui';
import { KbRepository, type KbMySpace, type KbSpace } from '@/entities/kb';

export interface KbSpaceSwitcherProps {
  space: KbSpace;
  workspaceSlug: string;
  /**
   * スペースを作る（一覧の下部から）。useKbTree の createSpace をそのまま渡す —
   * visibility の食い違いを検査する規則を、ここで二重に持たないため。
   */
  onCreateSpace: (input: { name: string; visibility?: 'workspace' | 'private' }) => Promise<KbSpace>;
}

/**
 * KbSpaceSwitcher はナレッジの文脈バーの「設計スペース ▾」（設計ボード ST03）。押すと自分が
 * 入っているスペースの一覧が開き、選ぶとそのスペースへ移る。スペースを作る入口と、全件の画面
 * （すべてのスペース）への入口もここに持つ。
 *
 * 自動採番の鍵（S-1A2B3C）や色の付いた角の印は出さない。人が読む名前だけで足り、鍵は
 * 人が覚える物ではない。プライベートのときだけ鍵の絵を添える（見られる人が限られると分かるように）。
 */
export default function KbSpaceSwitcher({ space, workspaceSlug, onCreateSpace }: KbSpaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, [triggerRef, menuRef], () => setOpen(false), { returnFocus: triggerRef });
  const isPrivate = space.visibility === 'private';

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        // 見えている名前を読み上げ名に含め、押すと何が起きるかを足す。
        aria-label={`スペース「${space.name}」${isPrivate ? '（プライベート）' : ''}を切り替える`}
        className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-md px-1.5 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
      >
        {isPrivate && <FsIcon name="lock" className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />}
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">{space.name}</span>
        <FsIcon name="chevron-down" className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
      </button>
      {open && (
        <KbSpaceSwitcherMenu
          ref={menuRef}
          workspaceSlug={workspaceSlug}
          activeSpaceId={space.id}
          onCreateSpace={onCreateSpace}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * KbSpaceSwitcherMenu は切替を押したときに出るスペースの一覧。開いたときだけ
 * 自分がアクセスできるスペース（/me/spaces）を取る。作成の入口もここに持つ
 * （スペースを作る手段が他に無くなるため、一覧と同じ場所に置く）。
 */
function KbSpaceSwitcherMenu({
  ref,
  workspaceSlug,
  activeSpaceId,
  onCreateSpace,
  onClose,
}: {
  /** ポップアップの枠。親が「外を押した」判定に使う。 */
  ref: Ref<HTMLDivElement>;
  workspaceSlug: string;
  activeSpaceId: string;
  onCreateSpace: (input: { name: string; visibility?: 'workspace' | 'private' }) => Promise<KbSpace>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [mySpaces, setMySpaces] = useState<KbMySpace[] | null>(null);
  // 取得の失敗を空の一覧（[]）に畳まない。空だと「スペースが無い」に見え、作り直してしまう。
  const [loadFailed, setLoadFailed] = useState(false);
  // 再試行の引き金（値に意味は無い。増えたら同じ問い合わせをもう一度投げる）。
  const [attempt, setAttempt] = useState(0);
  const [addingSpace, setAddingSpace] = useState(false);
  const [addingPrivateSpace, setAddingPrivateSpace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    KbRepository.fetchMySpaces(workspaceSlug)
      .then((list) => {
        if (!cancelled) setMySpaces(list);
      })
      .catch(() => {
        if (cancelled) return;
        setMySpaces(null);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, attempt]);

  const createSpace = async (input: { name: string; visibility?: 'workspace' | 'private' }) => {
    try {
      const space = await onCreateSpace(input);
      setAddingSpace(false);
      setAddingPrivateSpace(false);
      onClose();
      navigate(`/kb/spaces/${space.id}`);
    } catch {
      showToast('error', 'スペースを作成できませんでした');
      throw new Error('create space failed');
    }
  };

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-1 max-h-[70vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg"
    >
      {mySpaces === null && !loadFailed && <p className="px-3 py-1.5 text-sm text-[var(--color-text-muted)]">読み込み中…</p>}
      {loadFailed && (
        <div role="alert" className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-danger-ink">
          <span>スペースを読み込めませんでした</span>
          <button
            type="button"
            onClick={() => setAttempt((prev) => prev + 1)}
            className="shrink-0 rounded px-1.5 py-1 text-xs underline hover:no-underline"
          >
            再試行
          </button>
        </div>
      )}
      {mySpaces?.map((s) => (
        <Link
          key={s.id}
          to={`/kb/spaces/${s.id}`}
          onClick={onClose}
          // 今いるスペースの印。'page' にしないのは、同じスペースのメンバー画面などを開いていても
          // このリンク（概要）が「今のページ」だと読まれてしまうため。
          aria-current={s.id === activeSpaceId ? 'true' : undefined}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
            s.id === activeSpaceId
              ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
              : 'text-[var(--color-text-secondary)] hover:bg-surface-2'
          }`}
        >
          <FsIcon name="folder" className="h-4 w-4 shrink-0" />
          <span className="truncate">{s.name}</span>
        </Link>
      ))}
      {/* 一覧にはこのワークスペースで自分が入っているスペースしか出ない。ほかのスペースを
          探す・作る画面への入口をここに置く（ヘッダーから行ける場所は主な行き先だけのため）。
          対象のワークスペースは ?workspace= で持ち越す。無いと全件画面が所属の先頭を開く。 */}
      <Link
        to={`/kb/spaces?workspace=${encodeURIComponent(workspaceSlug)}`}
        onClick={onClose}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-surface-2"
      >
        <FsIcon name="grid" className="h-4 w-4 shrink-0" />
        <span className="truncate">すべてのスペース</span>
      </Link>
      <div className="mt-1 border-t border-surface-3 pt-1">
        {addingSpace ? (
          <div className="px-2 pb-1">
            <NameCreateForm what="スペース" onCreate={createSpace} onCancel={() => setAddingSpace(false)} autoFocus />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingSpace(true)}
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-surface-2"
          >
            スペースを作成
          </button>
        )}
        {addingPrivateSpace ? (
          <div className="px-2 pb-1">
            <NameCreateForm
              what="プライベートスペース"
              onCreate={(input) => createSpace({ ...input, visibility: 'private' })}
              onCancel={() => setAddingPrivateSpace(false)}
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingPrivateSpace(true)}
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-secondary)] hover:bg-surface-2"
          >
            プライベートスペースを作成
          </button>
        )}
      </div>
    </div>
  );
}
