import { Extension, ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import MentionMenuList, { type MentionMenuListHandle, type MentionMenuListProps } from './MentionMenuList';

/** 候補 1 件。ワークスペースの一員のうち、名指しに要るものだけ（users.id と表示名）。 */
export interface MentionCandidate {
  userId: number;
  name: string;
}

/** 名前で探す口。画面側（KbPage）が、いまのワークスペースの一員の一覧を包んで渡す。 */
export type SearchMembersForMention = (query: string) => Promise<MentionCandidate[]>;

/** `@` に続けて名前を打つと候補が出る（チケットの発言と同じ作法）。 */
export const MENTION_TRIGGER = '@';

// '/'・`[[`・`#` と同じエディタに載せるので、キーを分けて衝突を避ける。
const mentionPluginKey = new PluginKey('kbMentionSuggestion');

// 複数エディタが同居しても aria-controls が衝突しないよう、開くたびに一意 id を振る。
let listboxSeq = 0;

export interface MentionSuggestionOptions {
  /** 名前で探す口。無ければ `@` を打っても何も起こらない（素の文字として残る）。 */
  searchMembers: SearchMembersForMention | null;
}

export interface MentionSuggestionStorage {
  /**
   * 名前で探す口。拡張一式は生成時に固定されるので、画面側が後から口を差し替えられるよう
   * options ではなく storage に置く（PageRefSuggestion と同じ分担）。
   */
  searchMembers: SearchMembersForMention | null;
}

declare module '@tiptap/core' {
  interface Storage {
    mentionSuggestion: MentionSuggestionStorage;
  }
}

/**
 * MentionSuggestion は `@` で人を探して名指し（mention）を入れる拡張。
 *
 * 候補は画面側が渡す口から取る（ワークスペースの一員。読み込みは画面側の問い合わせの控えに
 * 乗る）。選ぶと `@名前` の打ちかけを消し、mention（インラインの atom。表示名はサーバーが
 * 読み出しのたびに解決する）と続けて打つための空白 1 つを入れる。候補が出ている間の Enter は
 * 確定で、改行にはならない。空白で打ち切る（名前の途中の空白は候補を閉じる）。
 * コードの中では開かない（メールアドレスやデコレータの @ で候補を出さない）。
 *
 * 通知は保存（公開）のときにサーバーが決める — 前の本文に無かった人のうち、ページを見られる
 * 一員へだけ届く。ここでは何も送らない。
 */
export const MentionSuggestion = Extension.create<MentionSuggestionOptions, MentionSuggestionStorage>({
  name: 'mentionSuggestion',

  addOptions() {
    return { searchMembers: null };
  },

  addStorage() {
    return { searchMembers: this.options.searchMembers };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const searchMembers = () => editor.storage.mentionSuggestion.searchMembers;

    return [
      Suggestion<MentionCandidate, MentionCandidate>({
        editor,
        pluginKey: mentionPluginKey,
        char: MENTION_TRIGGER,
        allowSpaces: false,
        startOfLine: false,
        // 判定は Suggestion が渡す state で行う（editor.isActive は変更の適用前の状態を見る）。
        allow: ({ state, range }) => {
          if (searchMembers() === null) return false;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const codeMark = state.schema.marks.code;
          return !(codeMark && codeMark.isInSet($from.marks()));
        },
        items: async ({ query }) => {
          const search = searchMembers();
          if (!search) return [];
          try {
            return await search(query.trim());
          } catch {
            // 探せなかったときは候補を出さないだけにする（本文の入力を止めない）。
            return [];
          }
        },
        command: ({ editor: currentEditor, range, props: member }) => {
          currentEditor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              // userId は users.id の 10 進文字列（サーバー・チケットの発言と同じ形）。
              { type: 'mention', attrs: { userId: String(member.userId), name: member.name } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let renderer: ReactRenderer<MentionMenuListHandle, MentionMenuListProps> | null = null;
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
          const menuProps = (props: SuggestionProps<MentionCandidate, MentionCandidate>): MentionMenuListProps => ({
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
              listboxId = `rte-mention-listbox-${listboxSeq}`;
              renderer = new ReactRenderer(MentionMenuList, {
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
