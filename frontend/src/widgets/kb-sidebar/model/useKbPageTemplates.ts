import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWriteAll } from '@/shared/api/queryCache';
import { KbRepository, kbKeys, kbSpaceTemplatesQuery, type KbPage, type KbPageTemplate } from '@/entities/kb';

export interface KbPageTemplatesState {
  templates: KbPageTemplate[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
}

const NO_TEMPLATES: KbPageTemplate[] = [];

const LOAD_FAILED =
  'テンプレートを読み込めませんでした。通信が切れたか、このワークスペースを見る立場でなくなっています。';

/**
 * useKbPageTemplates はスペース 1 つぶんのテンプレート一覧（そのスペース専用 +
 * ワークスペース全体、両方込み）の読み取り・削除・「テンプレートから新しいページを作る」を持つ。
 *
 * サイドバーの「雛形から作る」と、本文の /template コマンドの両方から使われる想定
 * （widgets/kb-sidebar 側に置くのは、pages/kb からは import できても widgets からは
 * pages を import できない — FSD の依存方向のため）。
 *
 * **一覧の取得は open（ピッカーが開いているか）ゲート付き**。一覧は共有の問い合わせ
 * （kbSpaceTemplatesQuery）から読むので、ホームの作成の窓と同じ一覧を使い、閉じて開き直しても
 * 取ってある一覧を使い回す。スペースごとの鍵なので、別のスペースへ移ったら前のスペースの一覧は
 * 出ない。ページ作成（createPageFromTemplate）は一覧の状態に触れないので open に依存しない —
 * 呼び出し側が把握している workspaceSlug / spaceId をそのまま使う。
 *
 * **削除・作成はどちらも失敗を投げる**（呼び出し側のピッカーがフォーム内にエラーを出す）。
 */
export function useKbPageTemplates(workspaceSlug: string | undefined, spaceId: string | undefined, open: boolean) {
  const queryClient = useQueryClient();
  const shown = open && workspaceSlug !== undefined && spaceId !== undefined;
  const result = useQuery({ ...kbSpaceTemplatesQuery(workspaceSlug ?? '', spaceId ?? ''), enabled: shown });
  const missing = result.data === undefined;

  /**
   * deleteTemplate はテンプレートを削除する。成功したら、そのテンプレートを載せている一覧
   * （ワークスペース全体のテンプレートならすべてのスペースの一覧）から取り除く。
   * **失敗は投げる**（呼び出し側のピッカーがエラーを出す）。
   */
  const deleteTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      if (!workspaceSlug) throw new Error('workspace is not determined');
      await KbRepository.deletePageTemplate(workspaceSlug, templateId);
      await reflectWriteAll<KbPageTemplate[]>(queryClient, kbKeys.templates(workspaceSlug), (prev) =>
        prev.filter((template) => template.id !== templateId),
      );
    },
    [workspaceSlug, queryClient],
  );

  /**
   * createPageFromTemplate はテンプレートから新しいページを作る。**失敗は投げる**
   * （呼び出し側のピッカーがフォーム内にエラーを出す）。ここでの一覧の更新は行わない
   * （作られるのはページであってテンプレートではないため、このフックの状態に影響しない）。
   */
  const createPageFromTemplate = useCallback(
    async (input: { templateId: string; parentId?: string; title: string }): Promise<KbPage> => {
      if (!workspaceSlug || !spaceId) throw new Error('space is not determined');
      return KbRepository.createPageFromTemplate(workspaceSlug, spaceId, input);
    },
    [workspaceSlug, spaceId],
  );

  return {
    templates: shown ? (result.data ?? NO_TEMPLATES) : NO_TEMPLATES,
    // 一覧がまだ無い間だけ読み込み中・失敗を出す。持っている一覧は取り直しの間も失敗しても出し続ける。
    loading: shown && missing && (result.isPending || result.isFetching),
    error: shown && missing && result.isError && !result.isFetching ? LOAD_FAILED : null,
    deleteTemplate,
    createPageFromTemplate,
  };
}
