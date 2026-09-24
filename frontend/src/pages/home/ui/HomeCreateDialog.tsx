import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { KbRepository, type KbWorkspace } from '@/entities/kb';
import { TicketRepository } from '@/entities/ticket';
import { Button, FsIcon } from '@/shared/ui';
import { createFailureMessage } from '../lib/createFailure';
import { useCreatableSpaces, usePageTemplates, useProjectReady, useProjects } from '../model/useCreateTargets';

type CreateKind = 'page' | 'ticket';

/** タイトルの上限（backend の binding と同じ）。 */
const TITLE_MAX = 200;

const FIELD_CLASS =
  'min-h-12 w-full rounded-lg border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-4 text-base text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50';

const LABEL_CLASS = 'text-sm font-medium text-[var(--color-text-secondary)]';

export interface HomeCreateDialogProps {
  workspaces: KbWorkspace[];
  /** 初めに選んでおくワークスペース（ホームのお気に入りで選んでいるもの）。 */
  initialWorkspaceSlug: string | null;
  onClose: () => void;
}

/**
 * 新しくつくる（設計ボード DB03）。ページとチケットを切り替え、どちらも保存先を必ず見せてから作る。
 *
 * - ページはスペースへ、チケットはプロジェクトへ。候補は作れる場所だけ（見られるだけの場所は出さない）
 * - ワークスペースを替えたら、それに依る選択（スペース・テンプレート・プロジェクト）は外す
 * - 種別を切り替えても保存先を勝手に別のワークスペースへ移さない（種別ごとに選択を持つ）
 * - 作れない理由は「権限が無い」「入れ物が無い」「まだ使える状態でない」を分けて言う
 * - 作成ボタンを押すまで保存しない。二重送信しない。結果が分からない失敗は自動で送り直さない
 * - 作れたらその場で開く（ページは /kb/:pageId、チケットは /tickets/:ticketId）
 */
export default function HomeCreateDialog({ workspaces, initialWorkspaceSlug, onClose }: HomeCreateDialogProps) {
  const titleId = useId();
  const [kind, setKind] = useState<CreateKind>('page');

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup
          aria-labelledby={titleId}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[var(--fs-dialog-border)] bg-[var(--fs-dialog-surface)] p-6 shadow-xl focus:outline-none sm:p-8"
        >
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title id={titleId} className="text-2xl font-bold text-[var(--color-text-primary)]">
              新しくつくる
            </Dialog.Title>
            <Dialog.Close
              aria-label="閉じる"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <FsIcon name="x" className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Tabs.Root value={kind} onValueChange={(next) => setKind(next as CreateKind)}>
            <Tabs.List aria-label="つくるもの" className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {(['page', 'ticket'] as const).map((value) => (
                <Tabs.Tab
                  key={value}
                  value={value}
                  className="min-h-11 rounded-lg text-base font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 data-[selected]:bg-brand-100 data-[selected]:font-semibold data-[selected]:text-brand-800"
                >
                  {value === 'page' ? 'ページ' : 'チケット'}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {/* 切り替えても入力と選んだ保存先を保つ（種別を替えただけで選び直しにしない）。 */}
            <Tabs.Panel value="page" keepMounted className="focus:outline-none data-[hidden]:hidden">
              <PageForm workspaces={workspaces} initialWorkspaceSlug={initialWorkspaceSlug} />
            </Tabs.Panel>
            <Tabs.Panel value="ticket" keepMounted className="focus:outline-none data-[hidden]:hidden">
              <TicketForm workspaces={workspaces} initialWorkspaceSlug={initialWorkspaceSlug} />
            </Tabs.Panel>
          </Tabs.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 日本語入力の変換を確定する Enter で送信しない。 */
function preventComposingSubmit(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
}

function validateTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'タイトルを入力してください。';
  if (trimmed.length > TITLE_MAX) return `タイトルは ${TITLE_MAX} 文字までです。`;
  return null;
}

/** 作れない理由。操作の代わりに置き、次に何をすればよいかを 1 つ添える。 */
function Blocked({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
      {children}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const inlineLink =
  'inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/** 作成先（ワークスペース / スペース・プロジェクト）と送信。 */
function SubmitArea({
  destination,
  label,
  disabled,
  pending,
  failure,
}: {
  destination: string | null;
  label: string;
  disabled: boolean;
  pending: boolean;
  failure: string | null;
}) {
  return (
    <div className="mt-6 border-t border-surface-3 pt-5">
      <p className="text-sm text-[var(--color-text-muted)]">作成先</p>
      <p className="mt-1 font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
        {destination ?? '未選択'}
      </p>
      {failure && (
        <p role="alert" className="mt-4 flex gap-2 rounded-lg border border-danger-soft bg-danger-soft p-3 text-sm text-danger-ink">
          <FsIcon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{failure}</span>
        </p>
      )}
      <Button type="submit" size="lg" fullWidth loading={pending} disabled={disabled} className="mt-5">
        {pending ? '作成しています…' : label}
        {!pending && <FsIcon name="arrow-right" className="h-5 w-5" />}
      </Button>
    </div>
  );
}

function WorkspaceField({
  id,
  workspaces,
  value,
  onChange,
  disabled,
}: {
  id: string;
  workspaces: KbWorkspace[];
  value: string;
  onChange: (slug: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        ワークスペース
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={FIELD_CLASS}>
        {value === '' && <option value="">選んでください</option>}
        {workspaces.map((w) => (
          <option key={w.slug} value={w.slug}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function TitleField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={preventComposingSubmit}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={FIELD_CLASS}
      />
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-sm text-danger-ink">
          <FsIcon name="alert-circle" className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function PageForm({ workspaces, initialWorkspaceSlug }: { workspaces: KbWorkspace[]; initialWorkspaceSlug: string | null }) {
  const navigate = useNavigate();
  const ids = { ws: useId(), space: useId(), title: useId(), template: useId() };
  const [workspaceSlug, setWorkspaceSlug] = useState(initialWorkspaceSlug ?? workspaces[0]?.slug ?? '');
  const [spaceId, setSpaceId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const workspace = workspaces.find((w) => w.slug === workspaceSlug) ?? null;
  const spaces = useCreatableSpaces(workspaceSlug || null);
  const templates = usePageTemplates(workspaceSlug || null, spaceId || null);
  const space = spaces.data.find((s) => s.id === spaceId) ?? null;

  // スペースの候補が読めたら先頭を選ぶ。ワークスペースを替えたときは下の changeWorkspace が外してある。
  useEffect(() => {
    if (spaces.status === 'ready' && spaceId === '' && spaces.data.length > 0) setSpaceId(spaces.data[0].id);
  }, [spaces.status, spaces.data, spaceId]);

  const changeWorkspace = (slug: string) => {
    setWorkspaceSlug(slug);
    setSpaceId('');
    setTemplateId('');
    setFailure(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !workspace || !space) return;
    const error = validateTitle(title);
    setTitleError(error);
    if (error) {
      titleRef.current?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const page = templateId
        ? await KbRepository.createPageFromTemplate(workspace.slug, space.id, { templateId, title: title.trim() })
        : await KbRepository.createPage(workspace.slug, space.id, { title: title.trim() });
      navigate(`/kb/${encodeURIComponent(page.id)}`);
    } catch (cause) {
      setFailure(createFailureMessage(cause, 'page'));
      setPending(false);
    }
  };

  const noSpaces = spaces.status === 'ready' && spaces.data.length === 0;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 flex flex-col gap-5">
      <p className="text-sm text-[var(--color-text-muted)]">考え・手順・決めたことを、チームの知識に。</p>
      <WorkspaceField id={ids.ws} workspaces={workspaces} value={workspaceSlug} onChange={changeWorkspace} disabled={pending} />

      {spaces.status === 'error' && (
        <Blocked action={<button type="button" onClick={spaces.retry} className={inlineLink}>再試行</button>}>
          スペースを取得できませんでした。
        </Blocked>
      )}
      {noSpaces && (
        <Blocked
          action={
            workspace?.canManage ? (
              <Link to="/kb" className={inlineLink}>
                ナレッジでスペースを作成 <FsIcon name="arrow-right" className="h-4 w-4" />
              </Link>
            ) : undefined
          }
        >
          このワークスペースには、ページを作れるスペースがありません。
          {!workspace?.canManage && ' スペースの編集者に加えてもらうと作れます。'}
        </Blocked>
      )}
      {spaces.status === 'ready' && spaces.data.length > 0 && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.space} className={LABEL_CLASS}>
              保存先のスペース
            </label>
            <select
              id={ids.space}
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setTemplateId('');
                setFailure(null);
              }}
              disabled={pending}
              aria-describedby={`${ids.space}-hint`}
              className={FIELD_CLASS}
            >
              {spaces.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p id={`${ids.space}-hint`} className="text-xs text-[var(--color-text-muted)]">
              スペースの直下にページを作成します。
            </p>
          </div>
          <TitleField
            id={ids.title}
            label="ページのタイトル"
            value={title}
            onChange={(v) => {
              setTitle(v);
              setTitleError(null);
            }}
            error={titleError}
            disabled={pending}
            inputRef={titleRef}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.template} className={LABEL_CLASS}>
              はじめ方
            </label>
            <select
              id={ids.template}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={pending || templates.status !== 'ready'}
              aria-describedby={`${ids.template}-hint`}
              className={FIELD_CLASS}
            >
              <option value="">空のページ</option>
              {templates.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p id={`${ids.template}-hint`} className="text-xs text-[var(--color-text-muted)]">
              {templates.status === 'error'
                ? 'テンプレートを取得できませんでした。空のページからは作れます。'
                : 'この場所で利用できるテンプレートも選べます。'}
            </p>
          </div>
        </>
      )}

      <SubmitArea
        destination={workspace && space ? `${workspace.name} / ${space.name}` : null}
        label="ページを作成してひらく"
        disabled={!workspace || !space}
        pending={pending}
        failure={failure}
      />
    </form>
  );
}

function TicketForm({ workspaces, initialWorkspaceSlug }: { workspaces: KbWorkspace[]; initialWorkspaceSlug: string | null }) {
  const navigate = useNavigate();
  const ids = { ws: useId(), project: useId(), title: useId() };
  const creatable = workspaces.filter((w) => w.canCreateTickets);
  const initial = creatable.some((w) => w.slug === initialWorkspaceSlug) ? (initialWorkspaceSlug ?? '') : '';
  const [workspaceSlug, setWorkspaceSlug] = useState(initial || (creatable.length === 1 ? creatable[0].slug : ''));
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const workspace = creatable.find((w) => w.slug === workspaceSlug) ?? null;
  const projects = useProjects(workspace?.slug ?? null);
  const project = projects.data.find((p) => p.id === projectId) ?? null;
  const ready = useProjectReady(workspace?.slug ?? null, project?.id ?? null);

  useEffect(() => {
    if (projects.status === 'ready' && projectId === '' && projects.data.length > 0) setProjectId(projects.data[0].id);
  }, [projects.status, projects.data, projectId]);

  const changeWorkspace = (slug: string) => {
    setWorkspaceSlug(slug);
    setProjectId('');
    setFailure(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !workspace || !project || ready.status !== 'ready' || !ready.data) return;
    const error = validateTitle(title);
    setTitleError(error);
    if (error) {
      titleRef.current?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const ticket = await TicketRepository.createTicket(workspace.slug, project.id, { title: title.trim() });
      navigate(`/tickets/${encodeURIComponent(ticket.id)}`, { state: { from: '/' } });
    } catch (cause) {
      setFailure(createFailureMessage(cause, 'ticket'));
      setPending(false);
    }
  };

  if (creatable.length === 0) {
    return (
      <div className="mt-6 flex flex-col gap-5">
        <p className="text-sm text-[var(--color-text-muted)]">実行することを、チームの作業に。</p>
        <Blocked>
          チケットを作れるワークスペースがありません。ワークスペースの編集者に加えてもらうと作れます。
        </Blocked>
      </div>
    );
  }

  const noProjects = projects.status === 'ready' && projects.data.length === 0;
  const notReady = project !== null && ready.status === 'ready' && !ready.data;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 flex flex-col gap-5">
      <p className="text-sm text-[var(--color-text-muted)]">実行することを、チームの作業に。</p>
      <WorkspaceField id={ids.ws} workspaces={creatable} value={workspaceSlug} onChange={changeWorkspace} disabled={pending} />

      {projects.status === 'error' && (
        <Blocked action={<button type="button" onClick={projects.retry} className={inlineLink}>再試行</button>}>
          プロジェクトを取得できませんでした。
        </Blocked>
      )}
      {noProjects && (
        <Blocked
          action={
            workspace?.canManage ? (
              <Link to="/backlog" className={inlineLink}>
                バックログでプロジェクトを作成 <FsIcon name="arrow-right" className="h-4 w-4" />
              </Link>
            ) : undefined
          }
        >
          このワークスペースにはプロジェクトがありません。
          {!workspace?.canManage && ' 管理者がプロジェクトを作ると、チケットを作れるようになります。'}
        </Blocked>
      )}
      {projects.status === 'ready' && projects.data.length > 0 && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.project} className={LABEL_CLASS}>
              所属するプロジェクト
            </label>
            <select
              id={ids.project}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setFailure(null);
              }}
              disabled={pending}
              aria-describedby={`${ids.project}-hint`}
              className={FIELD_CLASS}
            >
              {projects.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p id={`${ids.project}-hint`} className="text-xs text-[var(--color-text-muted)]">
              このプロジェクトの既定の種類・初期状態で作成します。
            </p>
          </div>
          {ready.status === 'error' && (
            <Blocked action={<button type="button" onClick={ready.retry} className={inlineLink}>再試行</button>}>
              このプロジェクトの設定を確かめられませんでした。
            </Blocked>
          )}
          {notReady && project && (
            <Blocked
              action={
                <Link to={`/backlog/${encodeURIComponent(project.id)}`} className={inlineLink}>
                  バックログで有効にする <FsIcon name="arrow-right" className="h-4 w-4" />
                </Link>
              }
            >
              このプロジェクトは、まだチケットを使える状態になっていません（種類と状態の設定が必要です）。
            </Blocked>
          )}
          <TitleField
            id={ids.title}
            label="チケットのタイトル"
            value={title}
            onChange={(v) => {
              setTitle(v);
              setTitleError(null);
            }}
            error={titleError}
            disabled={pending}
            inputRef={titleRef}
          />
          <div className="rounded-xl bg-surface-2 p-5">
            <p className="font-bold text-[var(--color-text-primary)]">詳細は作成したあとで</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">作成したチケットで、担当者・期限・本文を編集できます。</p>
          </div>
        </>
      )}

      <SubmitArea
        destination={workspace && project ? `${workspace.name} / ${project.name}` : null}
        label="チケットを作成してひらく"
        disabled={!workspace || !project || ready.status !== 'ready' || !ready.data}
        pending={pending}
        failure={failure}
      />
    </form>
  );
}
