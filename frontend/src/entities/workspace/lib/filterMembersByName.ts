import type { WorkspaceMember } from '../model/types';

/**
 * filterMembersByName は '@' 直後に打った文字で名指しの候補を絞り込む（チケットの発言と
 * ナレッジの本文が共有する。どちらも相手はワークスペースの一員）。
 *
 * 前方一致を優先し、次いで部分一致を並べる。名前を引けなかった行（空文字）は候補として
 * 選びようがないので外す。query が空なら名前を引けた全員。
 */
export function filterMembersByName(members: WorkspaceMember[], query: string): WorkspaceMember[] {
  const named = members.filter((m) => m.name !== '');
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return named;

  const prefix: WorkspaceMember[] = [];
  const partial: WorkspaceMember[] = [];
  for (const member of named) {
    const name = member.name.toLowerCase();
    if (name.startsWith(normalizedQuery)) prefix.push(member);
    else if (name.includes(normalizedQuery)) partial.push(member);
  }
  return [...prefix, ...partial];
}
