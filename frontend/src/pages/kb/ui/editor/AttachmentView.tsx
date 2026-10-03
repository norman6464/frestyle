import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { FsIcon } from '@/shared/ui';
import { formatFileSize } from '@/shared/lib/formatFileSize';

/** 添付の ID からダウンロード用の期限付き URL を取る口（押すたびに呼ぶ）。 */
export type DownloadAttachment = (attachmentId: string) => Promise<string>;

type DownloadState = 'idle' | 'loading' | 'failed';

/**
 * AttachmentView は添付ノードの NodeView。種類の印・ファイル名・大きさ・「ダウンロード」を 1 行に出す。
 *
 * ダウンロードは押したときに downloadAttachment で期限付き URL を取り、新しいタブで開く（URL は
 * 元のファイル名で保存させる指定つきなので、開いたタブはそのまま保存になる）。URL は控えない
 * （期限がある）。チケット添付の TicketAttachmentRow と同じ作法。
 *
 * downloadAttachment は拡張の options 経由で渡る（RichTextEditor の `downloadAttachment` →
 * createEditorExtensions → withAttachmentView）。渡されていない画面（見本など）では押せない。
 * 表示の値（filename・size・contentType）はサーバーが保存のたびに行から書き直した写しで、
 * ここでは書き換えない。
 */
export default function AttachmentView({ node, extension, selected }: NodeViewProps) {
  const attachmentId = typeof node.attrs.attachmentId === 'string' ? node.attrs.attachmentId : null;
  const filename =
    typeof node.attrs.filename === 'string' && node.attrs.filename !== '' ? node.attrs.filename : '添付ファイル';
  const size = typeof node.attrs.size === 'number' ? formatFileSize(node.attrs.size) : '';
  const isImage = typeof node.attrs.contentType === 'string' && node.attrs.contentType.startsWith('image/');
  const downloadAttachment = (extension.options as { downloadAttachment?: DownloadAttachment } | undefined)
    ?.downloadAttachment;
  const [state, setState] = useState<DownloadState>('idle');

  const handleDownload = async () => {
    if (!downloadAttachment || attachmentId === null) return;
    setState('loading');
    try {
      const url = await downloadAttachment(attachmentId);
      window.open(url, '_blank', 'noopener,noreferrer');
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  return (
    <NodeViewWrapper
      className={`rte-attachment${selected ? ' is-selected' : ''}`}
      data-attachment-id={attachmentId ?? undefined}
    >
      <FsIcon name={isImage ? 'image' : 'document'} className="rte-attachment-icon" />
      <span className="rte-attachment-name" title={filename}>
        {filename}
      </span>
      {size !== '' && <span className="rte-attachment-size">{size}</span>}
      {state === 'failed' && (
        <span role="alert" className="rte-attachment-error">
          取得できませんでした
        </span>
      )}
      <button
        type="button"
        className="rte-attachment-download"
        onClick={() => void handleDownload()}
        disabled={!downloadAttachment || attachmentId === null || state === 'loading'}
        aria-label={`${filename} をダウンロード`}
      >
        {state === 'loading' ? '準備中…' : 'ダウンロード'}
      </button>
    </NodeViewWrapper>
  );
}
