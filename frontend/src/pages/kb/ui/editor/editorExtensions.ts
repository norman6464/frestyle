import type { Extensions } from '@tiptap/react';
import type CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type Heading from '@tiptap/extension-heading';
import type Image from '@tiptap/extension-image';
import type { ImageOptions } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { ReactNodeViewRenderer, textblockTypeInputRule } from '@tiptap/react';
import type { EditorCommand } from './editorCommands';
import CodeBlockView from './CodeBlockView';
import ImageView from './ImageView';
import { BlockOperations } from './blockOperations';
import { ListNormalization } from './listNormalization';
import { PageRefSuggestion } from './pageRefSuggestion';
import { TicketRefSuggestion } from './ticketRefSuggestion';
import { MarkdownShortcuts } from './markdownShortcuts';
import { createSchemaExtensions } from './schemaExtensions';
import { SlashCommand } from './slashCommandExtension';
import { StableBlockId } from './stableBlockId';

/**
 * withZenkakuHeadingInputRules は Heading（levels 1〜3）へ全角入力対応の input rule を上掛けする。
 *
 * 既定の input rule は半角の `#` ＋半角スペースのみ発火する。日本語 IME のまま打つと
 * `＃`（全角）や全角スペースになり変換されないため、全角 `＃`（半角と混在も可）＋
 * 半角/全角スペースでも同じ level に変換されるルールを追加する。スキーマ（ノード名・attrs）は
 * factory 側の Heading のまま変えない。
 */
function withZenkakuHeadingInputRules(heading: typeof Heading) {
  return heading.extend({
    addInputRules() {
      const defaultRules = this.parent?.() ?? [];
      const zenkakuRules = this.options.levels.map((level) =>
        textblockTypeInputRule({
          // \u3000 は全角スペース（リテラルで書くと no-irregular-whitespace に触れるためエスケープ表記）。
          find: new RegExp(`^([#\uFF03]{${level}})[ \u3000]$`),
          type: this.type,
          getAttributes: { level },
        }),
      );
      return [...defaultRules, ...zenkakuRules];
    },
  });
}

/**
 * withCodeBlockView は codeBlock へ右上の言語選択・コピー UI（CodeBlockView）の NodeView を
 * 上掛けする。ノード名は 'codeBlock' のままなので、スラッシュ（/codeblock）・バブルメニュー・
 * 既存 doc とそのまま互換。lowlight ハイライトの設定は factory 側が持つ。
 */
function withCodeBlockView(codeBlock: typeof CodeBlockLowlight) {
  return codeBlock.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  });
}

/**
 * withImageView は image へ、"kb/" で始まる src（S3 の key）を遅延解決する NodeView
 * （ImageView）を上掛けする。ノード名は 'image' のままなので、既存 doc・貼り付け・
 * ドラッグ&ドロップ挿入とそのまま互換。
 *
 * resolveImageSrc は addOptions で拡張の options に足す（configure() は Image 既定の
 * ImageOptions 型に縛られ、任意のキーを追加できないため）。ImageView は
 * `extension.options.resolveImageSrc` としてこれを読む。未指定なら undefined のままで、
 * ImageView 側は解決を試みず src をそのまま使う（story・他画面との後方互換）。
 */
function withImageView(image: typeof Image, resolveImageSrc?: (src: string) => Promise<string>) {
  return image.extend<ImageOptions & { resolveImageSrc?: typeof resolveImageSrc }>({
    addOptions() {
      // this.parent?.() は元の Image の既定値を必ず返す（未定義になるのは型上の都合だけ）。
      // spread の型推論では「未定義かもしれない」分だけ inline 等の必須項目が任意化されて
      // ImageOptions と噛み合わなくなるため、実体を保証してアサーションで丸める。
      return {
        ...this.parent?.(),
        resolveImageSrc,
      } as ImageOptions & { resolveImageSrc?: typeof resolveImageSrc };
    },
    addNodeView() {
      return ReactNodeViewRenderer(ImageView);
    },
  });
}

/** createEditorExtensions の組み立てオプション。拡張を増やすときはここに口を足す。 */
export interface CreateEditorExtensionsOptions {
  /** 空エディタに表示するプレースホルダ文言。 */
  placeholder?: string;
  /** 画像ノードを有効にするか（既定 true）。アップロードの配線は利用側が別途行う。 */
  image?: boolean;
  /**
   * '/' メニューに出すコマンド（英単語トリガ）。未指定ならスラッシュメニュー自体を付けない。
   * 利用側だけが知る操作（画像アップロード等）もこの配列に差し込める。
   */
  slashItems?: EditorCommand[];
  /**
   * "kb/" で始まる画像 src（S3 の key）を表示用の一時 URL へ解決する関数。
   * 渡さなければ ImageView は解決を試みず src をそのまま使う（story・他画面との後方互換）。
   */
  resolveImageSrc?: (src: string) => Promise<string>;
}

/**
 * createEditorExtensions は RichTextEditor が使う tiptap 拡張一式を組み立てる。
 *
 * スキーマを決める拡張は createSchemaExtensions()（スキーマの単一ソース）から
 * 受け取り、ここでは NodeView・input rule・プレースホルダ等の表示/入力の挙動だけを上掛けする。
 * バブルメニュー・スラッシュコマンド・ドラッグハンドルなどを足すときも、オプションを増やして
 * ここで合成する（＝拡張ポイントを 1 箇所に保つ）。
 */
export function createEditorExtensions(
  options: CreateEditorExtensionsOptions = {},
): Extensions {
  const { placeholder = '本文を入力…', image = true, slashItems, resolveImageSrc } = options;

  const extensions: Extensions = createSchemaExtensions({ image }).map((extension) => {
    if (extension.name === 'heading') {
      return withZenkakuHeadingInputRules(extension as typeof Heading);
    }
    if (extension.name === 'codeBlock') {
      return withCodeBlockView(extension as typeof CodeBlockLowlight);
    }
    if (extension.name === 'image') {
      return withImageView(extension as typeof Image, resolveImageSrc);
    }
    return extension;
  });

  extensions.push(
    // 隣接する同種リストを結合し、番号リストの番号リセットを防ぐ。
    ListNormalization,
    // いちばん外のブロック単位の上下移動・複製・削除（取っ手のメニュー・'/'・Alt+↑↓）。
    BlockOperations,
    // `[[` でページを探して参照を入れる。探す口（searchPages）は画面側が実行時に storage へ入れる
    // （拡張一式は生成時に固定されるため）。口が無ければ `[[` は素の文字のまま。
    PageRefSuggestion,
    // `#` でチケットを探して参照を入れる（探す口は searchTickets。同じく storage 経由）。
    TicketRefSuggestion,
    // IME（日本語入力）確定でも効く ＃ 見出し・``` コードブロック変換。
    MarkdownShortcuts,
    Placeholder.configure({ placeholder }),
    // 保存のたびに同じ id を送り続けられるよう、id を持たないブロックへ新規採番して埋める
    // （振る舞いなのでスキーマ本体＝schemaExtensions.ts ではなくここに置く）。
    StableBlockId,
  );

  if (slashItems && slashItems.length > 0) {
    extensions.push(SlashCommand.configure({ items: slashItems }));
  }

  return extensions;
}
