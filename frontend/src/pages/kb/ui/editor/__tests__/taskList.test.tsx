import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Editor, type JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { EDITOR_COMMANDS } from '../editorCommands';
import { buildSlashItems } from '../slashItems';

let editor: Editor | null = null;

function makeEditor(content: JSONContent = emptyRichDoc()): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

const item = (checked: boolean, text: string): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const taskDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [item(false, 'domain はフレームワークを import しない'), item(true, 'テストを書いた')],
    },
  ],
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('タスクリスト（TaskList / TaskItem）', () => {
  it('タスクリストを含む doc がスキーマに受理され、checked ごと往復する', () => {
    const e = makeEditor(taskDoc);
    const list = e.getJSON().content?.[0];
    expect(list?.type).toBe('taskList');
    expect(list?.content).toHaveLength(2);
    expect(list?.content?.[0]?.attrs?.checked).toBe(false);
    expect(list?.content?.[1]?.attrs?.checked).toBe(true);
  });

  it('タスクリストコマンド（レジストリ）で段落がタスクリストに変換される', () => {
    const e = makeEditor();
    e.chain().focus('end').insertContent('やること').run();
    const command = EDITOR_COMMANDS.find((c) => c.id === 'taskList');
    expect(command).toBeDefined();
    command!.run(e);
    const list = e.getJSON().content?.find((node) => node.type === 'taskList');
    expect(list).toBeDefined();
    expect(list?.content?.[0]?.type).toBe('taskItem');
    expect(command!.isActive?.(e)).toBe(true);
  });

  it("'/' メニューの候補にタスクリスト（/tasklist）が含まれ、todo でも引ける", () => {
    const items = buildSlashItems();
    const task = items.find((i) => i.id === 'taskList');
    expect(task).toBeDefined();
    expect(task!.keywords).toContain('todo');
  });

  it('親が完了でも入れ子の未完了項目は data-checked=false で描画される（取り消し線の継承対象外）', () => {
    const nestedDoc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '親タスク（完了）' }] },
                { type: 'taskList', content: [item(false, '子タスク（未完了）')] },
              ],
            },
          ],
        },
      ],
    };
    const { container } = render(<RichTextEditor value={nestedDoc as never} editable={false} />);
    const parent = container.querySelector("li[data-checked='true']");
    expect(parent).not.toBeNull();
    const child = parent!.querySelector("li[data-checked='false']");
    expect(child).not.toBeNull();
    // textContent はチェックボックスの aria-label を含むため、本文段落だけを見る。
    expect(child!.querySelector('div > p')!.textContent).toBe('子タスク（未完了）');
  });

  it('読み取り専用（editable=false）でもチェック状態つきで描画される', () => {
    const { container } = render(<RichTextEditor value={taskDoc as never} editable={false} />);
    expect(screen.getByText('domain はフレームワークを import しない')).toBeInTheDocument();
    const list = container.querySelector("ul[data-type='taskList']");
    expect(list).not.toBeNull();
    const checkboxes = list!.querySelectorAll("input[type='checkbox']");
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
    // 完了項目は data-checked で CSS の取り消し線対象になる。
    expect(list!.querySelectorAll("li[data-checked='true']")).toHaveLength(1);
  });
});
