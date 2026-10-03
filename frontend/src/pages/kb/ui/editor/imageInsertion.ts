import type { Editor } from '@tiptap/react';
import { sanitizeImageSrc } from '@/shared/lib/linkSafety';
/** ImageUploader は File を受け取り、表示用 URL を返す関数。 */
export type ImageUploader = (file: File) => Promise<string>;

// 画像かどうか・大きさの振り分けは attachmentInsertion.ts の classifyFiles がまとめて行う
// （ドロップ・貼り付け・ファイル選択のどの入口も同じ基準で分ける）。

/**
 * insertUploadedImages は画像ファイル群をアップロードして editor へ挿入する。
 *
 * - 選択順を保つため 1 つずつ順次（await）に処理する（並列だと URL 取得の早い順に並んでしまう）
 * - 各挿入の直前に isAlive() と editor.isDestroyed を確認し、別文書へ切り替え済みなら誤挿入しない
 * - alt にはファイル名を既定で入れる（代替テキストの土台。専用 UI は後続）
 *
 * アップロード失敗は握りつぶす（通知は呼び出し側の uploader 内の方針に委ねる）。
 * uploader が返す url も挿入前に検査する — uploader 自体はこの画面のコード（例:
 * KbRepository.uploadPageImage）で信頼できる形（"kb/…" の key）を返す前提だが、
 * doc へ実際に書き込む直前の検査を linkSafety.ts の許可リストへ揃えておくことで、
 * uploader の実装が将来変わっても doc 側の不変条件（sanitizeDocLinks が許す src だけを
 * 持つ）が保たれる。
 */
export async function insertUploadedImages(
  editor: Editor,
  files: File[],
  upload: ImageUploader,
  isAlive: () => boolean = () => true,
): Promise<void> {
  for (const file of files) {
    try {
      const url = await upload(file);
      const safeUrl = sanitizeImageSrc(url);
      if (safeUrl === null) continue;
      if (!isAlive() || editor.isDestroyed) continue;
      editor.chain().focus().setImage({ src: safeUrl, alt: file.name }).run();
    } catch {
      /* アップロード失敗は無視（通知は呼び出し側） */
    }
  }
}
