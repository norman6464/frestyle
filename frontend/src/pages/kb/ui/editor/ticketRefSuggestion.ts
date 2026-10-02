import { Extension, ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import TicketRefMenuList, { type TicketRefMenuListHandle, type TicketRefMenuListProps } from './TicketRefMenuList';
import type { TicketRefStatusCategory } from './schemaExtensions';

/** 候補 1 件。検索の応答そのもの（本文の ticketRef の attrs と同じ形）。 */
export interface TicketRefCandidate {
  id: string;
  /** 表示キー（例 ENG-12）。サーバーが組み立てる。 */
  key: string;
  title: string;
  statusName: string;
  statusCategory: TicketRefStatusCategory;
}

/** 鍵か題名で探す口。画面側（KbPage）が、いまのワークスペースの検索 API を包んで渡す。 */
export type SearchTicketsForRef = (query: string) => Promise<TicketRefCandidate[]>;

/** `#` に続けて鍵か題名を打つと候補が出る（Linear / GitHub の作法）。 */
export const TICKET_REF_TRIGGER = '#';

// '/' コマンド（既定の共有キー）・`[[` と同じエディタに載せるので、キーを分けて衝突を避ける。
const ticketRefPluginKey = new PluginKey('kbTicketRefSuggestion');

// 複数エディタが同居しても aria-controls が衝突しないよう、開くたびに一意 id を振る。
let listboxSeq = 0;

export interface TicketRefSuggestionOptions {
  /** 鍵か題名で探す口。無ければ `#` を打っても何も起こらない（素の文字として残る）。 */
  searchTickets: SearchTicketsForRef | null;
}

export interface TicketRefSuggestionStorage {
  /**
   * 鍵か題名で探す口。拡張一式は生成時に固定されるので、画面側が後から口を差し替えられるよう
   * options ではなく storage に置く（PageRefSuggestion と同じ分担）。
   */
  searchTickets: SearchTicketsForRef | null;
}

declare module '@tiptap/core' {
  interface Storage {
    ticketRefSuggestion: TicketRefSuggestionStorage;
  }
}

/**
 * TicketRefSuggestion は `#` でチケットを探して参照（ticketRef）を入れる拡張。
 *
 * 候補は画面側が渡す検索の口から取る（ワークスペース横断のチケット検索 API）。選ぶと `#語` の
 * 打ちかけを消し、ticketRef（インラインの atom。鍵・題名・状態はサーバーが読み出しのたびに
 * 解決する）と続けて打つための空白 1 つを入れる。候補が出ている間の Enter は確定で、改行には
 * ならない。
 *
 * 空白で打ち切る（鍵に空白は無く、題名の途中の空白で候補を出し続けると `C# は` のような
 * 文中の # で候補が居座る）。コードの中では開かない（# はコメントや色の記法で頻出する）。
 */
export const TicketRefSuggestion = Extension.create<TicketRefSuggestionOptions, TicketRefSuggestionStorage>({
  name: 'ticketRefSuggestion',

  addOptions() {
    return { searchTickets: null };
  },

  addStorage() {
    return { searchTickets: this.options.searchTickets };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const searchTickets = () => editor.storage.ticketRefSuggestion.searchTickets;

    return [
      Suggestion<TicketRefCandidate, TicketRefCandidate>({
        editor,
        pluginKey: ticketRefPluginKey,
        char: TICKET_REF_TRIGGER,
        allowSpaces: false,
        startOfLine: false,
        // 1 文字ごとに検索の API を叩かないよう、打ち終わりを少し待つ。
        debounce: 150,
        // 判定は Suggestion が渡す state で行う（editor.isActive は変更の適用前の状態を見るため、
        // 打った直後の判定がひとつ遅れる）。コードブロック（spec.code）とコードのマークの中では開かない。
        allow: ({ state, range }) => {
          if (searchTickets() === null) return false;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const codeMark = state.schema.marks.code;
          return !(codeMark && codeMark.isInSet($from.marks()));
        },
        items: async ({ query }) => {
          const search = searchTickets();
          if (!search) return [];
          try {
            return await search(query.trim());
          } catch {
            // 探せなかったときは候補を出さないだけにする（本文の入力を止めない）。
            return [];
          }
        },
        command: ({ editor: currentEditor, range, props: ticket }) => {
          currentEditor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'ticketRef',
                attrs: {
                  ticketId: ticket.id,
                  key: ticket.key,
                  title: ticket.title,
                  statusName: ticket.statusName,
                  statusCategory: ticket.statusCategory,
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let renderer: ReactRenderer<TicketRefMenuListHandle, TicketRefMenuListProps> | null = null;
          let unmount: (() => void) | null = null;
          let listboxId = '';

          // textbox に付けられるのは aria-controls と aria-activedescendant だけ
          // （aria-expanded は textbox の役割では許されない。PageRefSuggestion と同じ）。
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
          const menuProps = (
            props: SuggestionProps<TicketRefCandidate, TicketRefCandidate>,
          ): TicketRefMenuListProps => ({
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
              listboxId = `rte-ticketref-listbox-${listboxSeq}`;
              renderer = new ReactRenderer(TicketRefMenuList, {
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
