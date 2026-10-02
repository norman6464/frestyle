import { INTERNAL_PAGE_LINK_PATTERN } from '@/shared/lib/linkSafety';
/**
 * クリックからリンクを開く（本文のリンクは編集中でもクリックで飛ぶ）。
 *
 * ProseMirror の handleClick に置かないのは 2 つの理由から:
 *   - あちらは座標からの位置計算（posAtCoords）を経由するため、レイアウトを持たない
 *     テスト環境（jsdom）では発火せず、検証できない振る舞いになる
 *   - 読み取り専用では ProseMirror がクリックを引き受けず、素の <a> の既定遷移
 *     （全画面リロード）に落ちる。ここで一元化すればどちらのモードも同じ動きになる
 */
export function openClickedLink(
  event: MouseEvent,
  navigateToPage?: (path: string) => void,
  options: { editable?: boolean } = {},
): boolean {
  if (!(event.target instanceof Element)) return false;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  const href = anchor.getAttribute('href');
  if (!href) return false;

  // **文字を選んだだけのクリックでは開かない。**
  // リンクの文字列をドラッグで選ぶと、ブラウザは mouseup のときに同じ要素の click も
  // 発火させる。ここで開いてしまうと、リンクの文言を打ち直す・リンクを外す、といった
  // 編集がマウスでは一切できなくなる（選んだ瞬間にページが変わる）。
  if (!isSelectionCollapsed()) return false;

  // 修飾キーは「新しいタブで」の意思。ただし編集中の Shift はキャレットからの
  // 選択の伸ばし方（文の途中からリンクの末尾まで選ぶ）で、新しいタブの意思ではない。
  const wantsNewTab =
    event.metaKey || event.ctrlKey || (event.shiftKey && !options.editable);
  const pagePath = internalPagePath(href);
  if (pagePath !== null && !wantsNewTab) {
    // アプリ内のページはアプリ内遷移（呼び出し側が router を持つ）。
    // 渡されていなければ素の遷移に落とす（shared は router を知らない）。
    if (navigateToPage) navigateToPage(pagePath);
    else window.location.assign(pagePath);
    return true;
  }
  // anchor.href は相対 href も絶対 URL へ解決済み。
  window.open(anchor.href, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * 内部リンク（ページ /kb/{id}・チケット /tickets/{id}）ならそのパスを返す。相対のパスに加え、
 * 共有 URL の貼り付けで入る「同一オリジンの絶対 URL」も同じ扱いにする
 * （毎回別タブが開くと、アプリ内の行き来なのに窓が増え続ける）。
 */
/**
 * いま文字が選ばれていないか（キャレットが 1 点に畳まれているか）を返す。
 * 選択の有無を読めない環境（getSelection が無い）では「選んでいない」に倒す —
 * ここで開かない方へ倒すと、リンクがどこでも押せなくなる。
 */
function isSelectionCollapsed(): boolean {
  const selection = window.getSelection?.();
  if (!selection) return true;
  return selection.isCollapsed;
}

/**
 * チケット参照の札（/tickets/{id}）もアプリ内遷移。ID の字面は pageRef と同じ UUID に固定する
 * （schemaExtensions の TicketRef が同じ検証をして href を組み立てる）。
 */
const INTERNAL_TICKET_LINK_PATTERN =
  /^\/tickets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isInternalPath(path: string): boolean {
  return INTERNAL_PAGE_LINK_PATTERN.test(path) || INTERNAL_TICKET_LINK_PATTERN.test(path);
}

export function internalPagePath(href: string): string | null {
  if (isInternalPath(href)) return href;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin === window.location.origin && isInternalPath(url.pathname)) {
      return url.pathname;
    }
  } catch {
    // URL として読めない値は外部リンク扱いへ落とす（開く側が絶対 URL で開く）。
  }
  return null;
}
