import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpenIcon,
  ChevronUpDownIcon,
  ClipboardDocumentListIcon,
  EllipsisHorizontalIcon,
  FolderIcon,
  PlusIcon,
  Squares2X2Icon,
  StarIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { useToast } from '@/shared/lib/hooks/useToast';
import { NameCreateForm } from '@/shared/ui';
import { KbRepository, type KbMySpace, type KbPage, type KbSpace } from '@/entities/kb';
import KbInlineRename from './KbInlineRename';
import { useKbPageTemplates } from '../model/useKbPageTemplates';
import KbTemplatePickerModal from './KbTemplatePickerModal';

export interface KbSpaceFaceProps {
  space: KbSpace;
  workspaceSlug: string;
  workspaceCanManage: boolean;
  archivedMode: boolean;
  /** バックログの現役チケット数。まだ取れていなければ null（バッジを出さない）。 */
  ticketCount: number | null;
  /** ページをスペース直下に作る（作成後の題名入力・遷移は呼び出し側が持つ）。 */
  onCreatePage: () => void;
  /** テンプレートから作った直後のページへの遷移・木への反映は呼び出し側が持つ。 */
  onCreatedFromTemplate: (page: KbPage) => void;
  onRenameSpace: (name: string) => Promise<KbSpace>;
  /**
   * スペースを作る（切替ドロップダウンの下部から）。useKbTree の createSpace をそのまま
   * 渡す — visibility の食い違いを検査する規則を、ここで二重に持たないため。
   */
  onCreateSpace: (input: { name: string; visibility?: 'workspace' | 'private' }) => Promise<KbSpace>;
}

const VISIBILITY_LABEL: Record<KbSpace['visibility'], string> = {
  workspace: 'チームスペース',
  private: 'プライベートスペース',
};

/**
 * 角の印に出す 2 文字。スペースの鍵（チケットキーの接頭辞。FRESTYLE-12 の FRESTYLE）から
 * 取る — 名前と違って改名で変わらず、チケットのキーとも揃う。自動採番の鍵（s-1a2b3c）は
 * 先頭の "S-" だと見分けが付かないので、記号を落としてから 2 文字取る。
 */
function spaceInitials(key: string): string {
  const letters = key.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || key.slice(0, 2)).toUpperCase();
}

/**
 * KbSpaceFace は「今いるスペース」の顔。角の印・名前・種別と鍵を出し、そこを押すと
 * 他のスペースへ移れる（切替はこのサイドバーが持つ — ヘッダーには置かない）。
 * その下に固定ナビ 5 項目（概要・ナレッジ・お気に入り・バックログ・メンバー）を並べ、
 * バックログには現役チケット数のバッジを付ける。
 */
export default function KbSpaceFace({
  space,
  workspaceSlug,
  workspaceCanManage,
  archivedMode,
  ticketCount,
  onCreatePage,
  onCreatedFromTemplate,
  onRenameSpace,
  onCreateSpace,
}: KbSpaceFaceProps) {
  const { showToast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templates = useKbPageTemplates(workspaceSlug, space.id, templatePickerOpen);

  const commitRename = async (name: string) => {
    try {
      await onRenameSpace(name);
      setRenaming(false);
    } catch {
      showToast('error', 'スペースの名前を変更できませんでした');
      // 入力欄は開いたままにする（閉じると書いた文字が消えるが、元の題名は保存されていない）。
      throw new Error('rename space failed');
    }
  };

  const createFromTemplate = async (templateId: string, title: string) => {
    const created = await templates.createPageFromTemplate({ templateId, title });
    setTemplatePickerOpen(false);
    onCreatedFromTemplate(created);
  };

  // 14px・#4A4945 相当。12px の淡い灰色だと「押せる行」に見えず、コントラストも足りない。
  const navItemClass = (isActive: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
      isActive
        ? 'bg-brand-500/10 font-medium text-brand-700'
        : 'text-[var(--color-text-tertiary)] hover:bg-surface-2'
    }`;

  return (
    <div className="mb-2">
      <div className="group relative flex items-center gap-0.5 rounded-md pr-1 hover:bg-surface-2">
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1.5">
            <KbInlineRename
              initialTitle={space.name}
              ariaLabel="スペースの名前"
              onCommit={commitRename}
              onCancel={() => setRenaming(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSwitcherOpen((prev) => !prev)}
            aria-expanded={switcherOpen}
            aria-label="スペースを切り替える"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-xs font-semibold text-white"
            >
              {spaceInitials(space.key)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
                {space.name}
              </span>
              <span className="block truncate text-xs text-[var(--color-text-muted)]">
                {VISIBILITY_LABEL[space.visibility]}・{space.key.toUpperCase()}
              </span>
            </span>
            <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
          </button>
        )}
        {!archivedMode && !renaming && (
          <>
            <button
              type="button"
              onClick={onCreatePage}
              aria-label={`${space.name} にページを追加`}
              title="ページを追加"
              className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-surface-3"
            >
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-label={`${space.name} の操作`}
              className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-surface-3"
            >
              <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            {menuOpen && (
              <ul className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setRenaming(true);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                  >
                    スペースの名前を変更
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setTemplatePickerOpen(true);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                  >
                    雛形から作る
                  </button>
                </li>
              </ul>
            )}
          </>
        )}

        {switcherOpen && (
          <KbSpaceSwitcherMenu
            workspaceSlug={workspaceSlug}
            activeSpaceId={space.id}
            onCreateSpace={onCreateSpace}
            onClose={() => setSwitcherOpen(false)}
          />
        )}
      </div>

      {!archivedMode && (
        <nav aria-label={`${space.name} の画面`} className="mt-2 flex flex-col gap-0.5">
          <NavLink to={`/kb/spaces/${space.id}`} end className={({ isActive }) => navItemClass(isActive)}>
            <Squares2X2Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">概要</span>
          </NavLink>
          <NavLink to={`/kb/spaces/${space.id}/pages`} className={({ isActive }) => navItemClass(isActive)}>
            <BookOpenIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">ナレッジ</span>
          </NavLink>
          <NavLink to={`/kb/spaces/${space.id}/favorites`} className={({ isActive }) => navItemClass(isActive)}>
            <StarIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">お気に入り</span>
          </NavLink>
          <NavLink to={`/kb/backlog/${space.id}`} className={({ isActive }) => navItemClass(isActive)}>
            <ClipboardDocumentListIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">バックログ</span>
            {ticketCount !== null && (
              <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">{ticketCount}</span>
            )}
          </NavLink>
          <NavLink to={`/kb/spaces/${space.id}/members`} className={({ isActive }) => navItemClass(isActive)}>
            <UsersIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">メンバー</span>
          </NavLink>
        </nav>
      )}

      <KbTemplatePickerModal
        isOpen={templatePickerOpen}
        templates={templates.templates}
        loading={templates.loading}
        error={templates.error}
        canManageTemplates={workspaceCanManage}
        onConfirm={createFromTemplate}
        onDelete={templates.deleteTemplate}
        onClose={() => setTemplatePickerOpen(false)}
      />
    </div>
  );
}

/**
 * KbSpaceSwitcherMenu は「顔」を押したときに出るスペースの一覧。開いたときだけ
 * 自分がアクセスできるスペース（/me/spaces）を取る。作成の入口もここに持つ
 * （スペースを作る手段が他に無くなるため、一覧と同じ場所に置く）。
 */
function KbSpaceSwitcherMenu({
  workspaceSlug,
  activeSpaceId,
  onCreateSpace,
  onClose,
}: {
  workspaceSlug: string;
  activeSpaceId: string;
  onCreateSpace: (input: { name: string; visibility?: 'workspace' | 'private' }) => Promise<KbSpace>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [mySpaces, setMySpaces] = useState<KbMySpace[] | null>(null);
  const [addingSpace, setAddingSpace] = useState(false);
  const [addingPrivateSpace, setAddingPrivateSpace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    KbRepository.fetchMySpaces(workspaceSlug)
      .then((list) => {
        if (!cancelled) setMySpaces(list);
      })
      .catch(() => {
        if (!cancelled) setMySpaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

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
    <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg">
      {mySpaces === null && <p className="px-3 py-1.5 text-sm text-[var(--color-text-muted)]">読み込み中…</p>}
      {mySpaces?.map((s) => (
        <Link
          key={s.id}
          to={`/kb/spaces/${s.id}`}
          onClick={onClose}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-surface-2 ${
            s.id === activeSpaceId
              ? 'font-semibold text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          <FolderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{s.name}</span>
        </Link>
      ))}
      <div className="mt-1 border-t border-surface-3 pt-1">
        {addingSpace ? (
          <div className="px-2 pb-1">
            <NameCreateForm what="スペース" onCreate={createSpace} />
            <button
              type="button"
              onClick={() => setAddingSpace(false)}
              className="w-full px-2 pb-1 text-left text-xs text-[var(--color-text-muted)] hover:underline"
            >
              やめる
            </button>
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
            />
            <button
              type="button"
              onClick={() => setAddingPrivateSpace(false)}
              className="w-full px-2 pb-1 text-left text-xs text-[var(--color-text-muted)] hover:underline"
            >
              やめる
            </button>
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
