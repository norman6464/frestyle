import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import RichTextEditor from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
const doc: RichDocContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
};

const resolveImageSrc = (src: string) => Promise.resolve(src);
const onChange = () => {};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RichTextEditor の設定の固定', () => {
  it('親が同じ props のまま描き直しても、tiptap に設定を入れ直さない', async () => {
    const setOptions = vi.spyOn(Editor.prototype, 'setOptions');
    const { rerender, container } = render(
      <RichTextEditor value={doc} onChange={onChange} resolveImageSrc={resolveImageSrc} ariaLabel="本文" />,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    setOptions.mockClear();

    rerender(<RichTextEditor value={doc} onChange={onChange} resolveImageSrc={resolveImageSrc} ariaLabel="本文" />);
    rerender(<RichTextEditor value={doc} onChange={onChange} resolveImageSrc={resolveImageSrc} ariaLabel="本文" />);

    expect(setOptions).not.toHaveBeenCalled();
  });

  it('読み上げの名前が変わったときは入れ直す（題名の変更が本文の名前に届く）', async () => {
    const { rerender, container } = render(
      <RichTextEditor value={doc} onChange={onChange} resolveImageSrc={resolveImageSrc} ariaLabel="設計メモ の本文" />,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());

    rerender(<RichTextEditor value={doc} onChange={onChange} resolveImageSrc={resolveImageSrc} ariaLabel="議事録 の本文" />);

    await waitFor(() =>
      expect(container.querySelector('.ProseMirror')).toHaveAttribute('aria-label', '議事録 の本文'),
    );
  });
});
