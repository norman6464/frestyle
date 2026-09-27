import { useCallback, useEffect, useRef, useState } from 'react';
import { KbRepository, type KbPage, type KbPageTemplate } from '@/entities/kb';

export interface KbPageTemplatesState {
  templates: KbPageTemplate[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
}

const EMPTY: KbPageTemplatesState = { templates: [], loading: false, error: null };
const LOADING: KbPageTemplatesState = { templates: [], loading: true, error: null };

const LOAD_FAILED =
  'テンプレートを読み込めませんでした。通信が切れたか、このワークスペースを見る立場でなくなっています。開き直すと最新の状態が出ます。';

/** 一覧取得の宛先。応答が着地してよいかの判定にこれを使う（useKbPageVersions と同じ形）。 */
interface TemplatesTarget {
  key: string;
  workspaceSlug: string;
  spaceId: string;
}

function targetOf(
  workspaceSlug: string | undefined,
  spaceId: string | undefined,
  open: boolean,
): TemplatesTarget | null {
  // ピッカーが開いている間だけ取りに行く。「雛形から作る」（サイドバー）・/template
  // （本文）のどちらも、ピッカーを開いたときにしか一覧を必要としないため
  // （useKbPageVersions と同じ理由 — 版一覧に常設のバッジが無いのと同じく、
  // テンプレート一覧にも常設の表示が無い）。
  if (!open || !workspaceSlug || !spaceId) return null;
  return { key: `${workspaceSlug} ${spaceId}`, workspaceSlug, spaceId };
}

/**
 * useKbPageTemplates はスペース 1 つぶんのテンプレート一覧（そのスペース専用 +
 * ワークスペース全体、両方込み）の読み取り・削除・「テンプレートから新しいページを作る」を持つ。
 *
 * サイドバーの「雛形から作る」と、本文の /template コマンドの両方から使われる想定
 * （widgets/kb-sidebar 側に置くのは、pages/kb からは import できても widgets からは
 * pages を import できない — FSD の依存方向のため）。
 *
 * **一覧の取得は open（ピッカーが開いているか）ゲート付き**。ページ作成
 * （createPageFromTemplate）は一覧の状態に触れないので open に依存しない —
 * 呼び出し側が把握している workspaceSlug / spaceId をそのまま使う。
 *
 * **削除・作成はどちらも失敗を投げる**（呼び出し側のピッカーがフォーム内にエラーを出す）。
 */
export function useKbPageTemplates(
  workspaceSlug: string | undefined,
  spaceId: string | undefined,
  open: boolean,
) {
  // 宛先の鍵。閉じている・宛先が未確定なら null。
  const targetKey = targetOf(workspaceSlug, spaceId, open)?.key ?? null;
  const [state, setState] = useState<KbPageTemplatesState>(() => (targetKey ? LOADING : EMPTY));
  // 宛先が変わったら（開いた・閉じた・スペースが変わった）、描いている途中で一覧を合わせる
  // （閉じたら畳む・開いたら読み込み中）。effect で合わせると、前の一覧のまま 1 回描いてから
  // もう 1 回描き直すことになる。前回の宛先を state に持って比べる（React が勧める形）。
  const [stateKey, setStateKey] = useState(targetKey);
  if (targetKey !== stateKey) {
    setStateKey(targetKey);
    setState(targetKey ? LOADING : EMPTY);
  }

  // いま見ている宛先。応答が着地してよいかをこれで判定する。
  const active = useRef<TemplatesTarget | null>(null);
  // 要求の連番。同じ宛先への 2 本目が飛んでいる最中に 1 本目が着地して
  // 古い一覧で上書きされる取り違えを見分ける（useKbComments と同じ理由）。
  const seq = useRef(0);

  const load = useCallback((to: TemplatesTarget) => {
    const request = ++seq.current;
    // state は応答が届いてから書く（読み込み中の印は、宛先が変わったときに描いている途中で立ててある）。
    KbRepository.listPageTemplates(to.workspaceSlug, to.spaceId)
      .then((templates) => {
        if (active.current?.key !== to.key || seq.current !== request) return;
        setState({ templates, loading: false, error: null });
      })
      .catch(() => {
        if (active.current?.key !== to.key || seq.current !== request) return;
        setState({ ...EMPTY, error: LOAD_FAILED });
      });
  }, []);

  // 宛先は effect の中で組み立てる（描画ごとに作り直すオブジェクトを依存に入れると毎回走る）。
  // 依存は宛先を決める 3 つの値そのもの。
  useEffect(() => {
    const target = targetOf(workspaceSlug, spaceId, open);
    active.current = target;
    if (!target) {
      // ピッカーを閉じた（または宛先が未確定）。連番を進めて、飛んでいる応答を無効にする
      // （一覧はもう描いている途中で畳んである）。
      seq.current += 1;
      return;
    }
    load(target);
  }, [workspaceSlug, spaceId, open, load]);

  /**
   * deleteTemplate はテンプレートを削除する。成功したら一覧から該当行を取り除く。
   * **失敗は投げる**（呼び出し側のピッカーがエラーを出す）。
   */
  const deleteTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      if (!workspaceSlug) throw new Error('workspace is not determined');
      await KbRepository.deletePageTemplate(workspaceSlug, templateId);
      setState((prev) => ({
        ...prev,
        templates: prev.templates.filter((template) => template.id !== templateId),
      }));
    },
    [workspaceSlug],
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

  return { ...state, deleteTemplate, createPageFromTemplate };
}
