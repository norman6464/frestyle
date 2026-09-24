import { useRef, useState } from 'react';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import { useToast } from '@/shared/lib/hooks/useToast';
import { FsIcon } from '@/shared/ui';
import type { KbPage, KbSpace } from '@/entities/kb';
import KbInlineRename from './KbInlineRename';
import { useKbPageTemplates } from '../model/useKbPageTemplates';
import KbTemplatePickerModal from './KbTemplatePickerModal';

export interface KbPagePanelHeadingProps {
  space: KbSpace;
  workspaceSlug: string;
  workspaceCanManage: boolean;
  archivedMode: boolean;
  /** ページをスペース直下に作る（作成後の題名入力・遷移は呼び出し側が持つ）。 */
  onCreatePage: () => void;
  /** 雛形から作った直後のページへの遷移・木への反映は呼び出し側が持つ。 */
  onCreatedFromTemplate: (page: KbPage) => void;
  onRenameSpace: (name: string) => Promise<KbSpace>;
}

/**
 * KbPagePanelHeading は左の列の見出し「ページを探す ＋」（設計ボード ST03）。
 *
 * ＋ でスペース直下にページを作る。… にはスペースの名前の変更と雛形から作るを置く。
 * どちらも常に見せる（触れたときだけ出すと、タッチ端末では見つけられない）。
 * アーカイブの表示中は作る操作を出さない（アーカイブの木に新しいページは現れないため）。
 */
export default function KbPagePanelHeading({
  space,
  workspaceSlug,
  workspaceCanManage,
  archivedMode,
  onCreatePage,
  onCreatedFromTemplate,
  onRenameSpace,
}: KbPagePanelHeadingProps) {
  const { showToast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templates = useKbPageTemplates(workspaceSlug, space.id, templatePickerOpen);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  useDismissOnOutside(menuOpen, [menuTriggerRef, menuRef], () => setMenuOpen(false), { returnFocus: menuTriggerRef });

  const commitRename = async (name: string) => {
    try {
      await onRenameSpace(name);
      setRenaming(false);
    } catch {
      showToast('error', 'スペースの名前を変更できませんでした');
      // 入力欄は開いたままにする（閉じると書いた文字が消えるが、元の名前は保存されていない）。
      throw new Error('rename space failed');
    }
  };

  const createFromTemplate = async (templateId: string, title: string) => {
    const created = await templates.createPageFromTemplate({ templateId, title });
    setTemplatePickerOpen(false);
    onCreatedFromTemplate(created);
  };

  return (
    <div className="mb-2">
      {renaming ? (
        <div className="px-1 py-1">
          <KbInlineRename
            initialTitle={space.name}
            ariaLabel="スペースの名前"
            onCommit={commitRename}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <div className="relative flex items-center gap-0.5 px-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-700">
            {archivedMode ? 'アーカイブしたページ' : 'ページを探す'}
          </h2>
          {!archivedMode && (
            <>
              <button
                type="button"
                onClick={onCreatePage}
                aria-label={`${space.name} にページを追加`}
                title="ページを追加"
                className="ui-hit inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-brand-700 transition-colors hover:bg-surface-2"
              >
                <FsIcon name="plus" className="h-4 w-4" />
              </button>
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                aria-label={`${space.name} の操作`}
                className="ui-hit inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-surface-2"
              >
                <FsIcon name="more" className="h-4 w-4" />
              </button>
              {menuOpen && (
                <ul
                  ref={menuRef}
                  className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg"
                >
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setTemplatePickerOpen(true);
                      }}
                      className="flex min-h-9 w-full items-center px-3 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                    >
                      雛形から作る
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setRenaming(true);
                      }}
                      className="flex min-h-9 w-full items-center px-3 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                    >
                      スペースの名前を変更
                    </button>
                  </li>
                </ul>
              )}
            </>
          )}
        </div>
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
