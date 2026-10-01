import type { RichDocContent } from '@/shared/lib/richDoc';

interface TextBearingNode {
  text?: string;
  content?: TextBearingNode[];
}

/**
 * extractPlainText は tiptap ドキュメントのノードを辿り、text を連結しただけの
 * プレーンテキストを取り出す（装飾・改行構造を無視した文字数だけが要る用途向け。
 * 読了時間の見積り等）。
 */
export function extractPlainText(doc: RichDocContent): string {
  let text = '';
  const walk = (node: TextBearingNode): void => {
    if (typeof node.text === 'string') text += node.text;
    node.content?.forEach(walk);
  };
  walk(doc);
  return text;
}
