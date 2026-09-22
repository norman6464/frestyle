/**
 * 認可の設定が揃っていないことを画面に出す。
 *
 * ボタンを消すのではなく、押せない状態のまま理由を添える。消してしまうと、
 * 外から見て「壊れているのか、意図的に止めているのか」が区別できない。
 *
 * 欠けている設定の名前は文には出さず `data-missing` に載せる。
 * 利用者にとって環境変数の名前は意味が無く、運用する側は要素を見れば分かる。
 */
export default function AuthUnavailableNotice({ missing }: { missing: readonly string[] }) {
  return (
    <p
      role="status"
      data-missing={missing.join(',')}
      className="mb-4 rounded-lg border border-warning-border bg-warning-soft p-3 text-center text-sm font-medium text-warning"
    >
      現在ログインを受け付けていません。認証の設定が完了していないためです。
    </p>
  );
}
