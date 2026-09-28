import type { WorkspaceMember } from '@/entities/workspace';

/**
 * filterMentionCandidates は '@' 直後に入力された query で候補を絞り込む。
 *
 * 前方一致を優先し、次いで部分一致を並べる（slashItems.ts の filterSlashItems と同じ形）。
 * 名前を引けなかった行（空文字）は候補として選びようがないので外す。
 */
export function filterMentionCandidates(members: WorkspaceMember[], query: string): WorkspaceMember[] {
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
