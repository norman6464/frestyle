import { createContext, useContext, useLayoutEffect } from 'react';

/**
 * 画面が枠（KbFrame）へ知らせる「今どこに居るか」。
 *
 * 枠は /kb 以下の画面に共通の親ルート（KbFrameLayout）が 1 回だけ描き、画面を移っても
 * 作り直さない。どのスペースの木を出すかは URL だけでは決まらない（ページの URL は
 * /kb/{pageId} だけで、スペースはページを取得して初めて分かる）ので、各画面がこれで知らせる。
 *
 * **まだ分からない値は undefined のまま渡す。枠は前の値のまま据え置く。** 読み込みの間に
 * 空で上書きすると、同じスペースの中を移っただけでも木を捨てて取り直すことになり、
 * 開いていたフォルダも閉じる。
 */
export interface KbFrameLocation {
  /** ワークスペース。undefined は「まだ分からない」（前のまま）。 */
  workspaceSlug?: string;
  /** 今いるスペース。undefined は「まだ分からない」（前のまま）。 */
  spaceId?: string;
  /** 開いているページ。現在位置の強調・祖先の自動展開・「この場所だけ」に使う。開いていなければ undefined。 */
  activePageId?: string;
  /** 左の列（ページの木）を出すか。スペースを持たない画面（メンバーと招待）は false。既定は true。 */
  showPagePanel?: boolean;
}

/** 枠が今描いている位置。KbFrame の props と同じ約束（spaceId の空文字は「決まっていない」）。 */
export interface KbFrameState {
  workspaceSlug?: string;
  spaceId: string;
  activePageId?: string;
  showPagePanel: boolean;
}

export const INITIAL_KB_FRAME_STATE: KbFrameState = { spaceId: '', showPagePanel: true };

/**
 * applyKbFrameLocation は画面からの知らせを、枠の位置へ重ねる。
 *
 * 何も変わらなければ前の値をそのまま返す（新しい値を作ると、同じ位置でも枠を描き直す）。
 */
export function applyKbFrameLocation(prev: KbFrameState, location: KbFrameLocation): KbFrameState {
  const workspaceSlug = location.workspaceSlug ?? prev.workspaceSlug;
  // ワークスペースが変わったのにスペースが知らされないときは、前のスペースを持ち越さない。
  // 持ち越すと、前のワークスペースのスペースの木を新しいワークスペースの中として取りに行く
  // （例: 別のワークスペースの「メンバーと招待」を開いたとき）。
  const spaceId = location.spaceId ?? (workspaceSlug === prev.workspaceSlug ? prev.spaceId : '');
  const activePageId = location.activePageId;
  const showPagePanel = location.showPagePanel ?? true;
  if (
    workspaceSlug === prev.workspaceSlug &&
    spaceId === prev.spaceId &&
    activePageId === prev.activePageId &&
    showPagePanel === prev.showPagePanel
  ) {
    return prev;
  }
  return { workspaceSlug, spaceId, activePageId, showPagePanel };
}

/** KbFrameLayout が画面へ配る「位置を知らせる口」。枠の外では null。 */
export const KbFrameLocationContext = createContext<((location: KbFrameLocation) => void) | null>(null);

/**
 * useKbFrameLocation は画面から枠へ「今どこに居るか」を知らせる。
 * 枠の外（画面だけを描く story・テスト）では何もしない。
 *
 * 画面に映る前（useLayoutEffect）に知らせる。useEffect だと、画面を移った直後の 1 回だけ
 * 枠が前の画面の位置のまま映る（前のページの強調や、出さないはずの左の列が一瞬見える）。
 */
export function useKbFrameLocation({ workspaceSlug, spaceId, activePageId, showPagePanel }: KbFrameLocation): void {
  const report = useContext(KbFrameLocationContext);
  useLayoutEffect(() => {
    report?.({ workspaceSlug, spaceId, activePageId, showPagePanel });
  }, [report, workspaceSlug, spaceId, activePageId, showPagePanel]);
}
