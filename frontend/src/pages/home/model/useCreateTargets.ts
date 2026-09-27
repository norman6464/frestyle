import { useQuery } from '@tanstack/react-query';
import { KbRepository, kbMySpacesQuery, type KbMySpace, type KbPageTemplate } from '@/entities/kb';
import { ProjectRepository, type Project } from '@/entities/project';
import { TicketRepository } from '@/entities/ticket';
import { toHomeResource, useHomeResource, type HomeResource } from './useHomeResource';

const NO_SPACES: KbMySpace[] = [];
const NO_TEMPLATES: KbPageTemplate[] = [];
const NO_PROJECTS: Project[] = [];

/**
 * ページを作れるスペース（自分の実効の役割が編集者以上のもの）。見られるだけのスペースは
 * 作成先に出さない（押しても作れない先を並べない）。作るときはサーバーでも確かめる。
 */
export function useCreatableSpaces(workspaceSlug: string | null): HomeResource<KbMySpace[]> {
  return toHomeResource(
    useQuery({ ...kbMySpacesQuery(workspaceSlug ?? ''), enabled: workspaceSlug !== null, select: selectCreatable }),
    NO_SPACES,
  );
}

function selectCreatable(spaces: KbMySpace[]): KbMySpace[] {
  return spaces.filter((s) => s.role === 'editor' || s.role === 'admin');
}

/**
 * その場所で使えるテンプレート（ワークスペース全体のものと、選んだスペース専用のもの）。
 * ほかのスペース専用のテンプレートは出さない（そのスペースへは保存しない）。
 */
export function usePageTemplates(workspaceSlug: string | null, spaceId: string | null) {
  return useHomeResource(
    workspaceSlug && spaceId ? `templates:${workspaceSlug}/${spaceId}` : null,
    async () => {
      const templates = await KbRepository.listPageTemplates(workspaceSlug ?? '', spaceId ?? undefined);
      return templates.filter((t) => !t.spaceId || t.spaceId === spaceId);
    },
    NO_TEMPLATES,
  );
}

/** ワークスペースのプロジェクト（チケットの所属先）。 */
export function useProjects(workspaceSlug: string | null) {
  return useHomeResource(
    workspaceSlug ? `projects:${workspaceSlug}` : null,
    () => ProjectRepository.fetchProjects(workspaceSlug ?? ''),
    NO_PROJECTS,
  );
}

/**
 * プロジェクトでチケットを使える状態か（初期状態がある＝有効化済み）。作れる権限があることと、
 * プロジェクトの設定が済んでいることは別なので、権限不足とは分けて知らせる。
 */
export function useProjectReady(workspaceSlug: string | null, projectId: string | null) {
  return useHomeResource(
    workspaceSlug && projectId ? `ready:${workspaceSlug}/${projectId}` : null,
    async () => {
      const statuses = await TicketRepository.fetchTicketStatuses(workspaceSlug ?? '', projectId ?? '');
      return statuses.some((s) => s.isInitial);
    },
    false,
  );
}
