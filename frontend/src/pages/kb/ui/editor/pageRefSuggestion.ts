import { Extension, ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import PageRefMenuList, { type PageRefMenuListHandle, type PageRefMenuListProps } from './PageRefMenuList';

/** 候補 1 件。題名の検索の結果から、参照に要るものだけ。 */
export interface PageRefCandidate {
  id: string;
  title: string;
}

/** 題名で探す口。画面側（KbPage）が、いまのワークスペースの検索 API を包んで渡す。 */
export type SearchPagesForRef = (query: string) => Promise<PageRefCandidate[]>;

/** `[[` に続けて題名を打つと候補が出る（Notion / Obsidian の作法）。 */
export const PAGE_REF_TRIGGER = '[[';

// '/' コマンド（既定の共有キー）と同じエディタに載せるので、キーを分けて衝突を避ける
// （バックログの @ と同じ理由）。
const pageRefPluginKey = new PluginKey('kbPageRefSuggestion');

// 複数エディタが同居しても aria-controls が衝突しないよう、開くたびに一意 id を振る。
let listboxSeq = 0;

export interface PageRefSuggestionOptions {
  /** 題名で探す口。無ければ `[[` を打っても何も起こらない（素の文字として残る）。 */
  searchPages: SearchPagesForRef | null;
}

export interface PageRefSuggestionStorage {
  /**
   * 題名で探す口。拡張一式は生成時に固定されるので、画面側が後から口を差し替えられるよう
   * options ではなく storage に置く（tiptap の「実行時に変わる値は storage」という分担）。
   */
  searchPages: SearchPagesForRef | null;
}

declare module '@tiptap/core' {
  interface Storage {
    pageRefSuggestion: PageRefSuggestionStorage;
  }
}

/**
 * PageRefSuggestion は `[[` でページを探して参照（pageRef）を入れる拡張。
 *
 * 候補は画面側が渡す検索の口から取る（既存の題名検索 API）。選ぶと `[[題名` の打ちかけを消し、
 * pageRef（インラインの atom。題名はサーバーが読み出しのたびに解決する）と続けて打つための
 * 空白 1 つを入れる。候補が出ている間の Enter は確定で、改行にはならない。
 */
export const PageRefSuggestion = Extension.create<PageRefSuggestionOptions, PageRefSuggestionStorage>({
  name: 'pageRefSuggestion',

  addOptions() {
    return { searchPages: null };
  },

  addStorage() {
    return { searchPages: this.options.searchPages };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const searchPages = () => editor.storage.pageRefSuggestion.searchPages;

    return [
      Suggestion<PageRefCandidate, PageRefCandidate>({
        editor,
        pluginKey: pageRefPluginKey,
        char: PAGE_REF_TRIGGER,
        // 題名には空白が入るので、空白で打ち切らない。
        allowSpaces: true,
        startOfLine: false,
        // 1 文字ごとに検索の API を叩かないよう、打ち終わりを少し待つ。
        debounce: 150,
        allow: () => searchPages() !== null,
        items: async ({ query }) => {
          const search = searchPages();
          if (!search) return [];
          try {
            return await search(query.trim());
          } catch {
            // 探せなかったときは候補を出さないだけにする（本文の入力を止めない）。
            return [];
          }
        },
        command: ({ editor: currentEditor, range, props: page }) => {
          currentEditor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'pageRef', attrs: { pageId: page.id, title: page.title } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let renderer: ReactRenderer<PageRefMenuListHandle, PageRefMenuListProps> | null = null;
          let unmount: (() => void) | null = null;
          let listboxId = '';

          // textbox に付けられるのは aria-controls（どの要素でも可）と aria-activedescendant だけ。
          // aria-expanded は textbox の役割では許されない（axe の aria-allowed-attr）。
          const setMenuAria = (dom: HTMLElement) => {
            dom.setAttribute('aria-controls', listboxId);
          };
          const clearMenuAria = (dom: HTMLElement) => {
            dom.removeAttribute('aria-controls');
            dom.removeAttribute('aria-activedescendant');
          };
          const close = (dom: HTMLElement) => {
            clearMenuAria(dom);
            unmount?.();
            unmount = null;
            renderer?.destroy();
            renderer = null;
          };
          const menuProps = (props: SuggestionProps<PageRefCandidate, PageRefCandidate>): PageRefMenuListProps => ({
            items: props.items,
            query: props.query,
            onSelect: (item) => props.command(item),
            listboxId,
            onActiveChange: (optionId) => {
              props.editor.view.dom.setAttribute('aria-activedescendant', optionId);
            },
          });

          return {
            onStart: (props) => {
              listboxSeq += 1;
              listboxId = `rte-pageref-listbox-${listboxSeq}`;
              renderer = new ReactRenderer(PageRefMenuList, {
                editor: props.editor,
                props: menuProps(props),
                className: 'rte-slash',
              });
              setMenuAria(props.editor.view.dom);
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => {
              renderer?.updateProps(menuProps(props));
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                close(editor.view.dom);
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: (props) => {
              close(props.editor.view.dom);
            },
          };
        },
      }),
    ];
  },
});
