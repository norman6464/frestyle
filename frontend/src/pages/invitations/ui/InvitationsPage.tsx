import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { kbRoleLabel, type KbInvitation } from '@/entities/kb';
import { useEmailVerification } from '@/features/auth';
import { Button, ConfirmModal, FsIcon } from '@/shared/ui';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useMyInvitations } from '../model/useMyInvitations';
import EmailVerificationPanel from './EmailVerificationPanel';
import InvitationCard from './InvitationCard';
import InvitationJoinedCard from './InvitationJoinedCard';
import InvitationStateCard from './InvitationStateCard';

/** 参加・辞退の失敗を、カードに出す見出しと説明にする（backend の respondKbInvitationErr に対応）。 */
function actionFailure(cause: unknown, action: '参加' | '辞退'): { title: string; description: string } {
  const { status } = getApiError(cause);
  if (status === 404) {
    return { title: 'この招待は現在利用できません', description: '宛先が違うか、取り消された招待です。一覧を更新してください。' };
  }
  if (status === 409) {
    return {
      title: 'この招待は現在利用できません',
      description: '期限が切れたか、招いた人が管理者でなくなりました。一覧を更新してください。',
    };
  }
  if (status === 403) {
    return { title: 'メールアドレスの確認が必要です', description: '一覧を更新すると、確認の手順が出ます。' };
  }
  if (status === undefined || status >= 500) {
    return {
      title: `${action}できたか確認できません`,
      description: '通信が途切れました。結果はまだ確認できていません。一覧を更新して確かめてください。',
    };
  }
  return { title: `${action}できませんでした`, description: 'もう一度お試しください。' };
}

/**
 * あなたへの招待（/invitations。設計ボード ST15・ST17・ST18・ST22）。自分（確認済みの email）宛の
 * 未決だけが並ぶ。通知（type=workspace_invitation）とアカウントメニューの飛び先で、招待リンク
 * （/invite）からログインした後の戻り先でもある。
 *
 * - 参加は自動で移動しない。参加完了のカード（ST17）を上に出し、「ワークスペースを開く」を選ばせる
 *   （ほかの招待にも続けて応答できる）
 * - 辞退は確認を挟む（ST22）。済んだら一覧の見出しへフォーカスを戻し、結果を status で知らせる
 * - 参加・辞退の失敗は、そのカードの中に理由と「一覧を更新」を出す（トーストにしない）
 * - 状態（読み込み中・0 件・取得失敗・メール未確認）にはどれも次の操作を置く（ST18）
 */
export default function InvitationsPage() {
  const navigate = useNavigate();
  const { invitations, loading, error, busyId, retry, accept, decline } = useMyInvitations();
  const verification = useEmailVerification();
  const [joined, setJoined] = useState<{ workspaceName: string; workspaceSlug: string; roleLabel: string } | null>(null);
  const [failures, setFailures] = useState<Record<string, { title: string; description: string }>>({});
  const [declining, setDeclining] = useState<KbInvitation | null>(null);
  const [declinePending, setDeclinePending] = useState(false);
  const [notice, setNotice] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const setFailure = (id: string, failure: { title: string; description: string } | null) =>
    setFailures((prev) => {
      const next = { ...prev };
      if (failure) next[id] = failure;
      else delete next[id];
      return next;
    });

  const refresh = () => {
    setFailures({});
    void retry();
  };

  const acceptInvitation = async (invitation: KbInvitation) => {
    setFailure(invitation.id, null);
    setNotice('');
    try {
      const accepted = await accept(invitation.id);
      setJoined({
        workspaceName: invitation.workspaceName,
        workspaceSlug: accepted.workspaceSlug,
        roleLabel: kbRoleLabel(invitation.role),
      });
    } catch (cause) {
      setFailure(invitation.id, actionFailure(cause, '参加'));
    }
  };

  const confirmDecline = () => {
    const target = declining;
    if (!target) return;
    setDeclinePending(true);
    setFailure(target.id, null);
    void decline(target.id)
      .then(() => {
        setNotice(`「${target.workspaceName}」への招待を辞退しました`);
        // 押した「辞退する」はカードごと消える。一覧の見出し（無くなったら画面の見出し）へ戻す。
        requestAnimationFrame(() => (listHeadingRef.current ?? titleRef.current)?.focus());
      })
      .catch((cause: unknown) => setFailure(target.id, actionFailure(cause, '辞退')))
      .finally(() => {
        setDeclinePending(false);
        setDeclining(null);
      });
  };

  const showList = !loading && error === null && invitations.length > 0;
  const showEmpty = !loading && error === null && invitations.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:pt-10">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <FsIcon name="chevron-left" className="h-4 w-4" />
        ホーム
      </Link>

      <header className="mb-8 mt-4">
        <p aria-hidden="true" className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-700">
          Join a workspace
        </p>
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="mt-2 rounded-md text-3xl font-bold tracking-tight text-[var(--color-text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:text-4xl"
        >
          あなたへの招待
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)]">
          参加する場所と役割を確認してから、ワークスペースに参加できます。
        </p>
      </header>

      {/* 辞退などの結果。領域は最初から置き、変わったときだけ文字を入れる。 */}
      <p role="status" aria-live="polite" className={notice ? 'mb-4 text-sm text-[var(--color-text-secondary)]' : 'sr-only'}>
        {notice}
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {joined && (
            <InvitationJoinedCard
              // 続けて別の招待に参加したら作り直し、見出しへのフォーカス移動をもう一度走らせる。
              key={joined.workspaceSlug}
              workspaceName={joined.workspaceName}
              roleLabel={joined.roleLabel}
              onOpen={() => navigate(`/kb/spaces?workspace=${encodeURIComponent(joined.workspaceSlug)}`)}
            />
          )}

          {loading && (
            <InvitationStateCard title="招待を確認しています" live>
              {/* 行の形を保った骨組み。0 件と取り違えないよう、文言でも読み込み中と言う。 */}
              <div aria-hidden="true" className="mt-4 space-y-3">
                <div className="h-5 w-full animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                <div className="h-5 w-2/5 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                <div className="h-5 w-1/4 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
              </div>
            </InvitationStateCard>
          )}

          {!loading && error === 'notVerified' && (
            <EmailVerificationPanel verification={verification} onVerified={refresh} />
          )}

          {!loading && error === 'unknown' && (
            <InvitationStateCard
              tone="danger"
              title="招待を取得できませんでした"
              description="通信状況を確認して、もう一度お試しください。"
              action={
                <Button variant="secondary" onClick={refresh}>
                  再読み込み
                </Button>
              }
            />
          )}

          {showEmpty && !joined && (
            <InvitationStateCard
              title="新しい招待はありません"
              description="未対応の招待が届くと、ここに表示されます。"
              action={
                <Button variant="secondary" onClick={() => navigate('/')}>
                  ホームへ
                </Button>
              }
            />
          )}

          {showList && (
            <section aria-labelledby="pending-invitations-heading">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2
                  id="pending-invitations-heading"
                  ref={listHeadingRef}
                  tabIndex={-1}
                  className="rounded-md text-lg font-bold text-[var(--color-text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  未対応の招待
                </h2>
                <span className="rounded-md bg-brand-50 px-2 py-1 text-sm tabular-nums text-brand-800">
                  {invitations.length}件
                </span>
              </div>
              <ul aria-label="未対応の招待" className="flex flex-col gap-4">
                {invitations.map((inv) => (
                  <li key={inv.id}>
                    <InvitationCard
                      invitation={inv}
                      accepting={busyId === inv.id && declining?.id !== inv.id}
                      locked={busyId !== null && busyId !== inv.id}
                      failure={failures[inv.id] ?? null}
                      onAccept={() => void acceptInvitation(inv)}
                      onDecline={() => setDeclining(inv)}
                      onRefresh={refresh}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            自分宛の招待だけが表示されます。知らないワークスペースからの招待には、応答する必要はありません。
          </p>
        </div>

        {/* 広い画面だけの添え書き（ST15）。 */}
        <aside aria-label="招待について" className="hidden lg:block">
          <FsIcon name="sparkles" className="h-8 w-8 text-brand-600" />
          <p className="mt-4 text-2xl font-bold leading-snug text-[var(--color-text-primary)]">
            一緒に進める、
            <br />
            次の場所。
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            招待を見ただけでは参加しません。参加するかどうかは、自分のペースで選べます。
          </p>
          <hr className="my-5 border-surface-3" />
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
            まだ所属がなくても応答できます。辞退しても、ほかのワークスペースの所属は変わりません。
          </p>
        </aside>
      </div>

      {declining && (
        <ConfirmModal
          isOpen
          title="この招待を辞退しますか？"
          message="この招待だけを辞退します。すでに参加しているワークスペースの所属は変わりません。"
          confirmText="招待を辞退する"
          cancelText="戻る"
          isDanger
          icon="login"
          pending={declinePending}
          onConfirm={confirmDecline}
          onCancel={() => setDeclining(null)}
        >
          <div className="rounded-lg bg-surface-2 p-4 text-left">
            <p className="font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{declining.workspaceName}</p>
            <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{declining.workspaceSlug}</p>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}
