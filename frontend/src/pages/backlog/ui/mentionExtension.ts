import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Extension, ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { KbWorkspaceMember } from '@/entities/kb';
import { filterMentionCandidates } from '../lib/filterMentionCandidates';
import MentionMenuList, { type MentionMenuListHandle, type MentionMenuListProps } from './MentionMenuList';

/**
 * Suggestion のプラグイン状態のうち、こちらが読む分だけの最小の形
 * （`@tiptap/suggestion` は内部の `SuggestionPluginState` を export していないため、
 * 使う分だけをこちらで宣言する）。
 */
interface MentionSuggestionState {
  active: boolean;
}

/**
 * このコンポーザ専用の pluginKey を明示する。既定（undefined）だと Suggestion 内蔵の
 * 共有キーに乗り、将来どこかで別の Suggestion 拡張（本文エディタの '/' コマンド等）と
 * 同じエディタへ載せたときに衝突しうる（このコンポーザは今のところ独立したエディタ
 * インスタンスなので実害は無いが、寄せたときに踏まないよう先に分けておく）。
 * 加えて、CommentComposerEnter がこのキー越しに「候補一覧が開いているか」を読む
 * （下記参照）ため、型引数つきで作って getState() の戻り値に型を与える。
 */
const mentionPluginKey = new PluginKey<MentionSuggestionState>('ticketMentionSuggestion');

// 複数コンポーザが同時に開いても aria-controls が衝突しないよう、開くたびに一意 id を振る
// （slashCommandExtension.ts の listboxSeq と同じ理由）。
let listboxSeq = 0;

export interface MentionOptions {
  /** 拡張の生成時点の候補の全件（以降の更新は storage 経由。下記 addStorage 参照）。 */
  members: KbWorkspaceMember[];
}

export interface MentionStorage {
  /**
   * 候補の全件。members の読み込みは非同期で、エディタの拡張一覧は生成時に固定される
   * （読み込み中にコンポーザを開いて先に '@' を打たれることがある）ため、options では
   * なく storage に置いて呼び出し側が読み込み完了後に書き換えられるようにする
   * （tiptap の「実行時に変わる値は storage、初期設定は options」という分担）。
   */
  members: KbWorkspaceMember[];
}

// editor.storage.mention に型を与える（tiptap 公式の module augmentation。Storage は
// @tiptap/core が空 interface として宣言しているだけの、拡張ごとの型を合流させる場所）。
declare module '@tiptap/core' {
  interface Storage {
    mention: MentionStorage;
  }
}

/**
 * Mention は '@' で人を名指す拡張。
 *
 * ノードは 1 個の不可分な単位（atom）として振る舞う — Backspace で 1 文字ずつではなく
 * 名指し全体が消える。属性は userId（送信する値）と name（表示だけに使う。送信しない）。
 * `TicketCommentSegment.mention` との往復は mentionComposerContent.ts が担う。
 */
export const Mention = Node.create<MentionOptions, MentionStorage>({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { members: [] };
  },

  addStorage() {
    return { members: this.options.members };
  },

  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-user-id'),
        renderHTML: (attributes) => ({ 'data-user-id': attributes.userId }),
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name') ?? '',
        renderHTML: (attributes) => ({ 'data-name': attributes.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-mention': '', class: 'rounded bg-brand-50 px-1 text-brand-700' }, HTMLAttributes),
      `@${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.name}`;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<KbWorkspaceMember, KbWorkspaceMember>({
        editor: this.editor,
        char: '@',
        startOfLine: false,
        allowSpaces: false,
        pluginKey: mentionPluginKey,
        items: ({ query }) => filterMentionCandidates(this.storage.members, query),
        command: ({ editor: currentEditor, range, props: member }) => {
          currentEditor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { userId: String(member.userId), name: member.name } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let renderer: ReactRenderer<MentionMenuListHandle, MentionMenuListProps> | null = null;
          let unmount: (() => void) | null = null;
          let listboxId = '';

          const setMenuAria = (dom: HTMLElement) => {
            dom.setAttribute('aria-expanded', 'true');
            dom.setAttribute('aria-controls', listboxId);
          };
          const clearMenuAria = (dom: HTMLElement) => {
            dom.removeAttribute('aria-expanded');
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

          const menuProps = (props: SuggestionProps<KbWorkspaceMember, KbWorkspaceMember>): MentionMenuListProps => ({
            items: props.items,
            onSelect: (item) => props.command(item),
            listboxId,
            onActiveChange: (optionId) => {
              props.editor.view.dom.setAttribute('aria-activedescendant', optionId);
            },
          });

          return {
            onStart: (props: SuggestionProps<KbWorkspaceMember, KbWorkspaceMember>) => {
              listboxSeq += 1;
              listboxId = `ticket-mention-listbox-${listboxSeq}`;
              renderer = new ReactRenderer(MentionMenuList, {
                editor: props.editor,
                props: menuProps(props),
              });
              setMenuAria(props.editor.view.dom);
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props: SuggestionProps<KbWorkspaceMember, KbWorkspaceMember>) => {
              renderer?.updateProps(menuProps(props));
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                close(this.editor.view.dom);
                return true;
              }
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: (props: SuggestionProps<KbWorkspaceMember, KbWorkspaceMember>) => {
              close(props.editor.view.dom);
            },
          };
        },
      }),
    ];
  },
});

/**
 * CommentComposerEnter は Enter を「改行」に固定する（送信は別のボタン、という既存の
 * ふつうの textarea と同じ振る舞いを保つ）。既定のブロック分割（新しい段落）ではなく
 * hardBreak を挿入する — 段落を Enter で増やせてしまうと、書式バーに無い操作で本文の
 * 形が変わって読み手には区別が付かないため。
 *
 * 箇条書きの中だけは例外で、次の項目を作る（splitListItem）。ここを素通し（false）に
 * して ListItem 自身の Enter に任せる手もあるが、keymap どうしの評価順は拡張の優先度で
 * 決まって見えにくいので、この拡張の中で明示的に呼ぶ。項目の中で行を折りたいときは
 * Shift-Enter（常に hardBreak）。
 *
 * '@' の候補一覧が開いている間は何もしない（false を返す）。tiptap は
 * addKeyboardShortcuts（keymap）と Suggestion の handleKeyDown（生の ProseMirror
 * プラグイン）を同じ優先順位で扱わない — 拡張の登録順に関わらず keymap 側が先に
 * 評価されるため、素通しにすると「候補を Enter で確定する」が常にこちらに食われて
 * 改行になってしまう（実機で確認済み）。pluginKey を明示してあるのは、ここで
 * `getState` を呼んで開いているかどうかを見るため。
 */
export const CommentComposerEnter = Extension.create({
  name: 'commentComposerEnter',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (mentionPluginKey.getState(this.editor.state)?.active) return false;
        if (this.editor.isActive('listItem')) return this.editor.commands.splitListItem('listItem');
        return this.editor.commands.setHardBreak();
      },
      'Shift-Enter': () => {
        if (mentionPluginKey.getState(this.editor.state)?.active) return false;
        return this.editor.commands.setHardBreak();
      },
    };
  },
});

/**
 * setMentionMembers は候補の全件を後から書き換える（members の読み込みが遅れて、
 * 先にコンポーザが描画されていた場合に呼び出し側から使う）。
 */
export function setMentionMembers(editor: Editor, members: KbWorkspaceMember[]): void {
  editor.storage.mention.members = members;
}
