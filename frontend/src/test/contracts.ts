import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * contractPath はリポジトリ直下の contracts/<name> の場所を返す（backend と突き合わせる契約ファイル）。
 *
 * 実行場所（vitest の cwd）は通常 frontend/ だが、リポジトリ直下から実行されることもあるので、
 * cwd から上へ向かって contracts/ を探す。`import.meta.url` から辿る形は、jsdom 環境では
 * file: 形式にならず使えない。
 */
export function contractPath(name: string): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(dir, 'contracts', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`contracts/${name} が見つかりません（実行場所: ${process.cwd()}）`);
}
