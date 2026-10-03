import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_ATTACHMENT_CONTENT_TYPES,
  ACCEPTED_ATTACHMENT_ACCEPT_ATTR,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  isAcceptedAttachmentContentType,
} from '../attachmentUpload';

describe('attachmentUpload', () => {
  it('許可リストに含まれる MIME を受け入れる', () => {
    expect(isAcceptedAttachmentContentType('application/pdf')).toBe(true);
    expect(isAcceptedAttachmentContentType('image/png')).toBe(true);
  });

  it('実行可能形式・マークアップは許可リストに無い', () => {
    expect(isAcceptedAttachmentContentType('application/x-msdownload')).toBe(false);
    expect(isAcceptedAttachmentContentType('text/html')).toBe(false);
    expect(isAcceptedAttachmentContentType('image/svg+xml')).toBe(false);
  });

  it('accept 属性はカンマ区切りで許可リスト全件を含む', () => {
    for (const type of ACCEPTED_ATTACHMENT_CONTENT_TYPES) {
      expect(ACCEPTED_ATTACHMENT_ACCEPT_ATTR.split(',')).toContain(type);
    }
  });

  it('上限は 25 MiB', () => {
    expect(MAX_ATTACHMENT_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});
