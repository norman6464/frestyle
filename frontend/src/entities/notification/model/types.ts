/**
 * 通知（notification）entity のドメイン型。
 */

/**
 * 通知（フロント表示用 view）。
 *
 * 項目名は backend の JSON と一致させること。かつて本文を `message` として読んでいたため、
 * backend が `body` で返す本文が画面に出ず、企業申請通知の申請者名・会社名が
 * 見えない状態だった。
 */
export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  /**
   * 通知の飛び先（アプリ内のパス。"/tickets/<id>" 等）。空文字は「飛び先なし」で、行は文字だけを出す。
   * backend の列が入る前の応答にはこの項目が無いので任意にしてある（無い＝'' と同じ扱い）。
   * repository では寄せない —— 一覧 repository は応答を素通しする契約
   * （entities/__tests__/listRepositoriesNullResponse.test.ts）なので、読む側（NotificationItem）で吸収する。
   */
  linkPath?: string;
  createdAt: string;
}
