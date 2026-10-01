import { Mark, mergeAttributes } from '@tiptap/core';
import { isInlineMarkColor, type InlineMarkColor } from './inlineColors';

/**
 * 文字色（textStyle）と蛍光ペン（highlight）のマーク。値は色の名前だけ。
 *
 * 公式の @tiptap/extension-text-style（Color）・extension-highlight を使わないのは、どちらも
 * 生の CSS の値（style="color: …"・style="background-color: …"）をそのまま attrs に持ち、
 * 貼り付けた HTML の色もそのまま取り込む作りのため。ここでは名前だけを attrs に持ち、
 * 描画は data-color とクラスで行い、style 属性を書かない（色そのものは richTextEditor.css が決める）。
 *
 * マーク名は保存側（contracts/kb-inline-attrs.json）と同じ 'textStyle' / 'highlight'。
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      /** 選択範囲に文字色を掛ける。許していない名前なら何もせず false。 */
      setTextColor: (color: InlineMarkColor) => ReturnType;
      /** 選択範囲の文字色を外す。 */
      unsetTextColor: () => ReturnType;
    };
    highlightColor: {
      /** 選択範囲に蛍光ペンを掛ける。許していない名前なら何もせず false。 */
      setHighlight: (color: InlineMarkColor) => ReturnType;
      /** 選択範囲の蛍光ペンを外す。 */
      unsetHighlight: () => ReturnType;
    };
  }
}

export const TextColorMark = Mark.create({
  name: 'textStyle',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-color');
          return isInlineMarkColor(value) ? value : null;
        },
        renderHTML: (attributes) =>
          isInlineMarkColor(attributes.color) ? { 'data-color': attributes.color, class: `rte-color rte-color-${attributes.color}` } : {},
      },
    };
  },

  parseHTML() {
    // 名前付きの span だけを取り込む。style="color: …" の span（ほかのサイトからの貼り付け）は
    // マークにせず、文字だけが残る（生の色を持ち込まない）。
    return [
      {
        tag: 'span[data-color]',
        getAttrs: (element) => (isInlineMarkColor((element as HTMLElement).getAttribute('data-color')) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          isInlineMarkColor(color) ? commands.setMark(this.name, { color }) : false,
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

const DEFAULT_HIGHLIGHT: InlineMarkColor = 'yellow';

export const HighlightMark = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT,
        // 名前の無い <mark>（ほかのサイトからの貼り付け）や知らない名前は黄にする。
        // 「強調したい」という意図は保ち、色の値だけを持ち込まない。
        parseHTML: (element) => {
          const value = element.getAttribute('data-color');
          return isInlineMarkColor(value) ? value : DEFAULT_HIGHLIGHT;
        },
        renderHTML: (attributes) => {
          const color = isInlineMarkColor(attributes.color) ? attributes.color : DEFAULT_HIGHLIGHT;
          return { 'data-color': color, class: `rte-highlight rte-highlight-${color}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          isInlineMarkColor(color) ? commands.setMark(this.name, { color }) : false,
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      // 黄の蛍光ペンを掛ける／外す（ほかの色はパレットから）。
      'Mod-Shift-h': () =>
        this.editor.isActive(this.name) ? this.editor.commands.unsetHighlight() : this.editor.commands.setHighlight(DEFAULT_HIGHLIGHT),
    };
  },
});
