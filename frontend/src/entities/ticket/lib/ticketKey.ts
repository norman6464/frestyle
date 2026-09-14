/**
 * 表示キー（例 `FRESTYLE-457`）の組み立て・分解。
 *
 * backend の `domain.FormatTicketKey` / `domain.ParseTicketKey` と対になる純関数。
 * プロジェクトの key 自体にハイフンが含まれ得る（例 `my-app`）ため、分解は**最後の**
 * ハイフンで割る（`domain.ParseTicketKey` と同じ規則。最初のハイフンで割ると
 * `my-app-12` の projectKey が `my` になってしまう）。
 */

export function formatTicketKey(projectKey: string, number: number): string {
  return `${projectKey.toUpperCase()}-${number}`;
}

export interface ParsedTicketKey {
  projectKey: string;
  number: number;
}

/**
 * 表示キーを projectKey / number へ分解する。形が合わない（ハイフンが無い・末尾が数字でない・
 * 数字部分が空）場合は null を返す（呼び出し側が not-found 相当として扱う）。
 */
export function parseTicketKey(key: string): ParsedTicketKey | null {
  const lastHyphen = key.lastIndexOf('-');
  if (lastHyphen <= 0 || lastHyphen === key.length - 1) {
    return null;
  }
  const projectKey = key.slice(0, lastHyphen);
  const numberPart = key.slice(lastHyphen + 1);
  if (!/^\d+$/.test(numberPart)) {
    return null;
  }
  const number = Number(numberPart);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }
  return { projectKey, number };
}
