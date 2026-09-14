import { useCallback, useEffect, useState } from 'react';
import { ProjectVersionRepository, type ProjectVersion } from '@/entities/project-version';
import { TeamRepository, type Team } from '@/entities/team';
import { SprintRepository, type Sprint } from '@/entities/sprint';

/**
 * useTicketVocabulary はチケットの詳細で使う「プロジェクトの語彙」と、そのチケットに
 * 付いている分をまとめて引く。
 *
 * 版・チーム（選択肢）はプロジェクト単位なので、チケットを切り替えても引き直さない。
 * 付いている版・所属スプリントはチケットごとなので、切り替えのたびに引き直す。
 * 取れなくても画面は使える（fail-open。選択肢が空になるだけで、他の項目は読める）。
 */
export function useTicketVocabulary(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  ticketId: string | undefined,
  initialTeamId: string | null,
) {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [fixVersions, setFixVersions] = useState<ProjectVersion[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  // 担当チームはここが持つ。全置換（UpdateTicket）には載らない項目で、専用の口が
  // 差し替えた結果をそのまま反映したいため（親の再取得を待たない）。
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    let alive = true;
    void ProjectVersionRepository.fetchVersions(workspaceSlug, projectId)
      .then((list) => alive && setVersions(list))
      .catch(() => alive && setVersions([]));
    void TeamRepository.fetchTeams(workspaceSlug, projectId)
      .then((list) => alive && setTeams(list))
      .catch(() => alive && setTeams([]));
    return () => {
      alive = false;
    };
  }, [workspaceSlug, projectId]);

  useEffect(() => {
    if (!workspaceSlug || !ticketId) return;
    let alive = true;
    void ProjectVersionRepository.fetchTicketFixVersions(workspaceSlug, ticketId)
      .then((list) => alive && setFixVersions(list))
      .catch(() => alive && setFixVersions([]));
    setTeamId(initialTeamId);
    void SprintRepository.fetchTicketSprint(workspaceSlug, ticketId)
      .then((s) => alive && setSprint(s))
      .catch(() => alive && setSprint(null));
    return () => {
      alive = false;
    };
    // initialTeamId はチケットが変わったときの種。以降はこのフックが持つ値が正なので
    // 依存に入れない（入れると親の再描画のたびに手元の差し替えが巻き戻る）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, ticketId]);

  /** 版の付け外し。送るのは「どちらにしたいか」で、返ってきた一式をそのまま持ち直す。 */
  const setFixVersion = useCallback(
    async (versionId: string, attach: boolean) => {
      if (!workspaceSlug || !ticketId) return;
      const next = await ProjectVersionRepository.setTicketFixVersion(workspaceSlug, ticketId, versionId, attach);
      setFixVersions(next);
    },
    [workspaceSlug, ticketId],
  );

  /** 担当チームの差し替え（空文字で外す）。結果は手元にも反映する。 */
  const changeTeam = useCallback(
    async (next: string) => {
      if (!workspaceSlug || !ticketId) return;
      const updated = await TeamRepository.setTicketTeam(workspaceSlug, ticketId, next);
      setTeamId(updated.teamId ?? null);
    },
    [workspaceSlug, ticketId],
  );

  return { versions, teams, fixVersions, sprint, teamId, setFixVersion, changeTeam };
}
