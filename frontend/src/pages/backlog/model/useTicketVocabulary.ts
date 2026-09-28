import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import { reflectTicket } from '@/features/ticket-cache';
import {
  ProjectVersionRepository,
  projectVersionsQuery,
  ticketFixVersionsQuery,
  type ProjectVersion,
} from '@/entities/project-version';
import { TeamRepository, teamsQuery, type Team } from '@/entities/team';
import { ticketSprintQuery } from '@/entities/sprint';

const NO_VERSIONS: ProjectVersion[] = [];
const NO_TEAMS: Team[] = [];

/**
 * useTicketVocabulary はチケットの詳細で使う「プロジェクトの語彙」と、そのチケットに
 * 付いている分をまとめて引く。
 *
 * どれも共有の問い合わせから読む。版・チーム（選択肢）はプロジェクトごとの鍵なので、チケットを
 * 切り替えても取り直さない。付いている版・入っているスプリントはチケットごとの鍵で、スプリントへ
 * 入れた・外したら書き込みの側（useSprints）が古いものにする（詳細の欄のスプリントが古いまま
 * 残らない）。取れなくても画面は使える（fail-open。選択肢が空になるだけで、他の項目は読める）。
 *
 * 担当チームはチケットの項目（ticket.teamId）なので、ここでは持たない。専用の口で差し替えたら、
 * 応答をチケットを載せている控えへ映す（reflectTicket）。
 */
export function useTicketVocabulary(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  ticketId: string | undefined,
) {
  const queryClient = useQueryClient();
  const hasProject = workspaceSlug !== undefined && projectId !== undefined;
  const hasTicket = workspaceSlug !== undefined && ticketId !== undefined;
  const slug = workspaceSlug ?? '';

  const versionsResult = useQuery({ ...projectVersionsQuery(slug, projectId ?? ''), enabled: hasProject });
  const teamsResult = useQuery({ ...teamsQuery(slug, projectId ?? ''), enabled: hasProject });
  const fixVersionsResult = useQuery({ ...ticketFixVersionsQuery(slug, ticketId ?? ''), enabled: hasTicket });
  const sprintResult = useQuery({ ...ticketSprintQuery(slug, ticketId ?? ''), enabled: hasTicket });

  /** 版の付け外し。送るのは「どちらにしたいか」で、返ってきた一式をそのまま映す。 */
  const setFixVersion = useCallback(
    async (versionId: string, attach: boolean) => {
      if (!workspaceSlug || !ticketId) return;
      const next = await ProjectVersionRepository.setTicketFixVersion(workspaceSlug, ticketId, versionId, attach);
      await reflectWrite(queryClient, ticketFixVersionsQuery(workspaceSlug, ticketId).queryKey, () => next);
    },
    [workspaceSlug, ticketId, queryClient],
  );

  /** 担当チームの差し替え（空文字で外す）。応答のチームをチケットを載せている控えへ映す。 */
  const changeTeam = useCallback(
    async (next: string) => {
      if (!workspaceSlug || !projectId || !ticketId) return;
      const updated = await TeamRepository.setTicketTeam(workspaceSlug, ticketId, next);
      await reflectTicket(queryClient, workspaceSlug, projectId, ticketId, (ticket) => ({
        ...ticket,
        teamId: updated.teamId ?? null,
      }));
    },
    [workspaceSlug, projectId, ticketId, queryClient],
  );

  return {
    versions: queryShownState(versionsResult, hasProject).data ?? NO_VERSIONS,
    teams: queryShownState(teamsResult, hasProject).data ?? NO_TEAMS,
    fixVersions: queryShownState(fixVersionsResult, hasTicket).data ?? NO_VERSIONS,
    sprint: queryShownState(sprintResult, hasTicket).data ?? null,
    setFixVersion,
    changeTeam,
  };
}
