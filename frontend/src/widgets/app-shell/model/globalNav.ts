/**
 * GlobalNavItem はアプリ全体の行き先 1 つ。広い画面ではヘッダーに横に、狭い画面では
 * 下部ナビに並ぶ。
 *
 * 行き先の一覧はここだけが持つ（single source of truth）。ヘッダーと下部ナビが同じ表を
 * 読むので、項目を増やすときはここへ 1 行足す。
 */
export interface GlobalNavItem {
  id: string;
  label: string;
  to: string;
  /** 描画表（ui/navIcons.ts）に対する鍵。下部ナビが絵と名前を並べる。 */
  icon: 'home' | 'assigned' | 'kb' | 'backlog';
  matchExact?: boolean;
  /** 複数の URL 系統が同じ画面に属するときは配列で並べる。 */
  matchPrefix?: string | string[];
  /**
   * matchPrefix に一致しても、ここに挙げた接頭辞ならこの項目は光らせない。
   * バックログ（/backlog, /tickets）は URL 上 /kb の下にぶら下がるが
   * （設計 Ⅱ・チケットは既存の spaces に属する）、ナビでは別項目として持つため、
   * 「ナレッジ」側にこれを立てて二重に光るのを防ぐ。
   */
  excludePrefix?: string | string[];
}

/**
 * 毎日使う行き先（設計ボード ST02・ST03）。
 *
 * 通知と設定は**ここに無い**。通知はヘッダーのベル、設定はアカウントのメニューが唯一の
 * 常設入口。同じ目的地の入口を 2 か所に置かない。
 */
export const GLOBAL_NAV_PRIMARY: GlobalNavItem[] = [
  { id: 'home', label: 'ホーム', to: '/', icon: 'home', matchExact: true },
  // 自分の担当はワークスペース・プロジェクトを横断する面。バックログ（プロジェクト 1 つの
  // 中を捌く面）とは役割が違うので別項目にする。ナビでは短く「担当」（ボードの呼び名）。
  // 画面の見出しは「自分の担当」のまま。
  { id: 'assigned', label: '担当', to: '/assigned', icon: 'assigned', matchExact: true },
  // ナレッジは共有される木（workspaces → spaces → pages）。to の /kb はページ未選択の入口で、
  // resolveEntryPageId（pages/kb/model/resolveEntryPage.ts）が続きのページへ即座に移す。
  {
    id: 'kb',
    label: 'ナレッジ',
    to: '/kb',
    icon: 'kb',
    matchPrefix: '/kb',
    excludePrefix: ['/backlog', '/tickets'],
  },
  // バックログはチケットの一覧・詳細・設定。/backlog はプロジェクト未選択の入口
  // （直近に見たプロジェクトへ移す。ナレッジの入口解決と同じ形）。個票は /tickets/:id。
  { id: 'backlog', label: 'バックログ', to: '/backlog', icon: 'backlog', matchPrefix: ['/backlog', '/tickets'] },
];

/**
 * navActive は現在の pathname がその項目を指しているかを判定する。
 *
 * matchPrefix は**パスの区切りまで見る**。素の startsWith だと `/kb` が `/kb-other` にも
 * 一致し、名前が前方一致するだけの無関係な画面でナビが光る。
 * 一致してよいのは、そのものか、`/` で続く下の階層だけ。
 */
export function navActive(
  item: Pick<GlobalNavItem, 'to' | 'matchExact' | 'matchPrefix' | 'excludePrefix'>,
  pathname: string,
): boolean {
  if (item.excludePrefix) {
    const excluded = Array.isArray(item.excludePrefix) ? item.excludePrefix : [item.excludePrefix];
    if (excluded.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return false;
    }
  }
  if (item.matchExact) return pathname === item.to;
  if (item.matchPrefix) {
    const prefixes = Array.isArray(item.matchPrefix) ? item.matchPrefix : [item.matchPrefix];
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  }
  return pathname === item.to;
}
