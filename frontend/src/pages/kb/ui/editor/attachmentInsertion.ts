import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isAcceptedImageMimeType, MAX_IMAGE_UPLOAD_BYTES } from '@/shared/config/imageUpload';
import { isAcceptedAttachmentContentType, MAX_ATTACHMENT_UPLOAD_BYTES } from '@/shared/config/attachmentUpload';
import { formatFileSize } from '@/shared/lib/formatFileSize';

/**
 * 記録した添付 1 件（KbRepository.uploadPageAttachment の戻り値と同じ形）。エディタはこの値を
 * そのまま attachment ノードの attrs に入れる（保存時にサーバーが同じ行から書き直す）。
 */
export interface UploadedAttachment {
  id: string;
  pageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** AttachmentUploader は File を保管庫へ送って記録し、記録した添付を返す。失敗は例外で返す。 */
export type AttachmentUploader = (file: File) => Promise<UploadedAttachment>;

/** 送る前に断ったファイルと、その理由（画面にそのまま出す文）。 */
export interface RejectedFile {
  file: File;
  reason: string;
}

/** classifyFiles の結果。images は画像として、attachments は添付として送る。 */
export interface ClassifiedFiles {
  images: File[];
  attachments: File[];
  rejected: RejectedFile[];
}

/**
 * classifyFiles はドロップ・貼り付け・ファイル選択で来たファイルを、画像・添付・断るものに分ける。
 *
 * - 画像（png・jpeg・gif・webp）は今までどおり本文に描く画像にする（添付の許可にも入っているが、
 *   本文に置くなら見える方がよい）。大きさは画像の上限（10 MiB）で見る
 * - それ以外で添付の許可にある種類は添付にする。大きさは添付の上限（25 MiB）で見る
 * - どちらにも入らない種類（html・svg・実行形式など）と上限を超えるものは送る前に断る。
 *   サーバーも同じ規則で断るが、待たされた末に失敗するより先に理由を出す方がよい
 *
 * imageUpload が false（画像の送り先が無い）なら画像も断る。attachmentUpload が false なら添付を断る。
 */
export function classifyFiles(
  files: FileList | File[] | null | undefined,
  options: { imageUpload: boolean; attachmentUpload: boolean },
): ClassifiedFiles {
  const result: ClassifiedFiles = { images: [], attachments: [], rejected: [] };
  for (const file of Array.from(files ?? [])) {
    if (isAcceptedImageMimeType(file.type)) {
      if (!options.imageUpload) {
        result.rejected.push({ file, reason: `「${file.name}」は画像を置けない場所なので送れません` });
      } else if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        result.rejected.push({
          file,
          reason: `「${file.name}」は画像の上限（${formatFileSize(MAX_IMAGE_UPLOAD_BYTES)}）を超えています`,
        });
      } else {
        result.images.push(file);
      }
      continue;
    }
    if (!options.attachmentUpload || !isAcceptedAttachmentContentType(file.type)) {
      result.rejected.push({ file, reason: `「${file.name}」はこの種類のファイルなので添付できません` });
      continue;
    }
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
      result.rejected.push({
        file,
        reason:
          file.size <= 0
            ? `「${file.name}」は中身が空なので添付できません`
            : `「${file.name}」は添付の上限（${formatFileSize(MAX_ATTACHMENT_UPLOAD_BYTES)}）を超えています`,
      });
      continue;
    }
    result.attachments.push(file);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 送っている間の仮の表示（本文には書かない。decoration だけで出す）
// ---------------------------------------------------------------------------

interface PendingUpload {
  uploadId: string;
  /** 添付を置く位置（ブロックの境目）。編集に合わせて動かす。 */
  pos: number;
  filename: string;
  /** 同じ位置に並べたときの順（1 から）。 */
  order: number;
}

/**
 * add は仮の表示を足す。remove は片づける（失敗・置けなかった）。placed は添付を置いた手順に付け、
 * その仮の表示を片づけつつ、同じ場所（from）で待っている仮の表示を置いた添付のすぐ後ろ（to）へ動かす。
 */
type PlaceholderMeta =
  | { add: PendingUpload[] }
  | { remove: { uploadId: string } }
  | { placed: { uploadId: string; from: number; to: number } }
  | { clear: true };

export const attachmentUploadPluginKey = new PluginKey<PendingUpload[]>('attachmentUpload');

function placeholderWidget(filename: string): () => HTMLElement {
  return () => {
    const element = document.createElement('div');
    element.className = 'rte-attachment rte-attachment-uploading';
    element.setAttribute('role', 'status');
    element.setAttribute('contenteditable', 'false');
    element.textContent = `「${filename}」を送信中…`;
    return element;
  };
}

/** findUploadPlaceholder は送信中の仮の表示が今どこにあるかを返す（片づいていれば null）。 */
export function findUploadPlaceholder(state: EditorState, uploadId: string): number | null {
  const pending = attachmentUploadPluginKey.getState(state) ?? [];
  return pending.find((item) => item.uploadId === uploadId)?.pos ?? null;
}

/**
 * clearAttachmentUploads は送信中の仮の表示をすべて片づける。エディタが本文を外から差し替えるとき
 * （別のページを開いた・版を戻した）に呼ぶ。片づけた分は、送り終えても本文に置かない。
 */
export function clearAttachmentUploads(editor: Editor): void {
  if (editor.isDestroyed || (attachmentUploadPluginKey.getState(editor.state) ?? []).length === 0) return;
  editor.view.dispatch(editor.state.tr.setMeta(attachmentUploadPluginKey, { clear: true } satisfies PlaceholderMeta));
}

/**
 * removeForeignAttachments は貼り付け・ドロップで入ってくる断片から、別のページの添付を取り除く。
 *
 * 添付はページに閉じた持ち物で、サーバーは「このページの添付」でないものを置いた本文の保存を断る
 * （自動保存が止まり続ける）。そこで入ってくる時点で、pageId が今のページと違う添付をファイル名だけの
 * 段落に置き換える（消すと何があったか分からなくなる。段落なら容器の中でも形が崩れない）。
 * 同じページの中での移動・複製は pageId が同じなのでそのまま通る。今のページが分からない（null）
 * ときはすべての添付を置き換える。
 */
export function removeForeignAttachments(
  slice: Slice,
  schema: Schema,
  pageId: string | null,
): { slice: Slice; removed: string[] } {
  const removed: string[] = [];
  const walk = (fragment: Fragment): Fragment => {
    let changed = false;
    const children: PMNode[] = [];
    fragment.forEach((child) => {
      if (child.type.name === 'attachment' && (pageId === null || child.attrs.pageId !== pageId)) {
        const filename = typeof child.attrs.filename === 'string' && child.attrs.filename !== '' ? child.attrs.filename : '添付ファイル';
        removed.push(filename);
        children.push(schema.nodes.paragraph.create(null, schema.text(filename)));
        changed = true;
        return;
      }
      if (child.content.size > 0) {
        const content = walk(child.content);
        if (content !== child.content) {
          children.push(child.copy(content));
          changed = true;
          return;
        }
      }
      children.push(child);
    });
    return changed ? Fragment.fromArray(children) : fragment;
  };
  const content = walk(slice.content);
  if (content === slice.content) return { slice, removed };
  return { slice: new Slice(content, slice.openStart, slice.openEnd), removed };
}

export interface AttachmentUploadsStorage {
  /** 今のページの ID。別のページの添付を貼り付けで持ち込まないために使う。 */
  pageId: string | null;
  /** 貼り付けで添付を置き換えたなど、書いている人へ知らせたいことがあったときに呼ぶ。 */
  onNotice: ((message: string) => void) | null;
}

declare module '@tiptap/core' {
  interface Storage {
    attachmentUploads: AttachmentUploadsStorage;
  }
}

/**
 * AttachmentUploads は添付の送信中の仮の表示（decoration）と、別のページの添付の持ち込み止めを担う。
 * 今のページの ID と知らせの口は画面側が実行時に storage へ入れる（拡張一式は生成時に固定されるため）。
 */
export const AttachmentUploads = Extension.create<Record<string, never>, AttachmentUploadsStorage>({
  name: 'attachmentUploads',

  addStorage() {
    return { pageId: null, onNotice: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<PendingUpload[]>({
        key: attachmentUploadPluginKey,
        state: {
          init: () => [],
          // 位置は装飾の写しに任せず、ここで自分で動かす。装飾は「すぐ後ろのブロックの属性が書き換わった」
          // （StableBlockId が新しい段落へ id を振る、など）だけで消えることがあり、送り終えた添付が
          // 本文に入らなくなる。位置は前へ寄せて写す（ちょうどその位置に何か置かれても動かない — 本文の
          // 末尾に足される空の段落の後ろへ流されない）。自分で添付を置いたときだけ、同じ場所で待っている
          // 仮の表示を置いた添付の後ろへ動かす（placed）。これで選んだ順のまま並ぶ。
          // 本文を外から差し替えたときは clearAttachmentUploads が片づける（clear）。
          apply(tr, pending) {
            const meta = tr.getMeta(attachmentUploadPluginKey) as PlaceholderMeta | undefined;
            const placed = meta && 'placed' in meta ? meta.placed : null;
            let next = pending;
            if (placed) {
              next = next
                .filter((item) => item.uploadId !== placed.uploadId)
                .map((item) =>
                  item.pos === placed.from
                    ? { ...item, pos: placed.to }
                    : { ...item, pos: Math.min(tr.mapping.map(item.pos, -1), tr.doc.content.size) },
                );
            } else if (tr.docChanged) {
              next = next.map((item) => ({ ...item, pos: Math.min(tr.mapping.map(item.pos, -1), tr.doc.content.size) }));
            }
            if (meta && 'clear' in meta) {
              next = [];
            } else if (meta && 'add' in meta) {
              next = [...next, ...meta.add];
            } else if (meta && 'remove' in meta) {
              next = next.filter((item) => item.uploadId !== meta.remove.uploadId);
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const pending = attachmentUploadPluginKey.getState(state) ?? [];
            if (pending.length === 0) return DecorationSet.empty;
            // 同じ位置の仮の表示は side（選んだ順）で並ぶ。key を付けて、描き直しのたびに要素を作り直さない。
            return DecorationSet.create(
              state.doc,
              pending.map((item) =>
                Decoration.widget(item.pos, placeholderWidget(item.filename), { key: item.uploadId, side: item.order }),
              ),
            );
          },
          transformPasted(slice, view) {
            const { slice: cleaned, removed } = removeForeignAttachments(slice, view.state.schema, storage.pageId);
            if (removed.length > 0) {
              storage.onNotice?.(`別のページの添付は貼り付けられないので、ファイル名だけを残しました（${removed.join('、')}）`);
            }
            return cleaned;
          },
        },
      }),
    ];
  },
});

let uploadSequence = 0;

/**
 * attachmentInsertPos は添付を置く位置（ブロックの境目）を返す。
 *
 * 段落の中の位置に添付（ブロック）を置くと、tiptap は段落を割るか、中身の無い段落なら段落ごと
 * 置き換える。置き換えると、同じ場所で待っている次の仮の表示も一緒に消えてしまう。そこで段落の
 * 境目に置く — 中身の無い段落ならその直前（段落はカーソルの居場所として残す）、それ以外はその直後。
 * ブロックを選んでいるならその直後。その場所に添付を置けない（折りたたみの見出しの中など）なら
 * 外側の段へたどり、どこにも置けなければ本文の末尾にする。
 */
export function attachmentInsertPos(state: EditorState): number {
  const type = state.schema.nodes.attachment;
  const canPlace = (pos: number) => {
    const $pos = state.doc.resolve(pos);
    return $pos.parent.canReplaceWith($pos.index(), $pos.index(), type);
  };
  const { selection } = state;
  if (selection instanceof NodeSelection && canPlace(selection.to)) return selection.to;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const pos = depth === $from.depth && node.isTextblock && node.content.size === 0 ? $from.before(depth) : $from.after(depth);
    if (canPlace(pos)) return pos;
  }
  return state.doc.content.size;
}

/**
 * insertUploadedAttachments は添付のファイル群を 1 つずつ送り、送り終えたものから本文へ置く。
 *
 * - 送る前に、置く場所（今のカーソルのあるブロックの境目。attachmentInsertPos）へ全部の「送信中」の
 *   仮の表示を選んだ順に並べる（本文には
 *   書かない。自動保存に途中の状態を送らないため）。書いている人が文字を打ち進めても、仮の表示は
 *   打った分だけずれて付いていく
 * - 送り終えたら、その仮の表示の位置に添付を置く。まだ待っている仮の表示は置いたものの後ろへずれる
 *   ので、選んだ順のまま並ぶ。仮の表示ごと消された（その辺りを消した）ら置かない
 * - 失敗したら仮の表示を消し、理由を onError へ渡す
 * - 1 つずつ順に送る（並べて送ると、送り終えた順に置くことになり順が崩れる）
 * - isAlive が false（別のページへ移った）・エディタが破棄済みなら置かず、残りの仮の表示も片づける
 * - 送っている間に本文が外から差し替わった（clearAttachmentUploads）ら置かず、そのことを onError で知らせる
 */
export async function insertUploadedAttachments(
  editor: Editor,
  files: File[],
  upload: AttachmentUploader,
  onError: (message: string) => void,
  isAlive: () => boolean = () => true,
): Promise<void> {
  if (files.length === 0 || editor.isDestroyed) return;
  const pos = attachmentInsertPos(editor.state);
  const queue = files.map((file, index) => {
    uploadSequence += 1;
    return { file, uploadId: `upload-${uploadSequence}`, order: index + 1 };
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(attachmentUploadPluginKey, {
      add: queue.map(({ file, uploadId, order }) => ({ uploadId, pos, filename: file.name, order })),
    } satisfies PlaceholderMeta),
  );
  const removePlaceholder = (uploadId: string) => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(attachmentUploadPluginKey, { remove: { uploadId } } satisfies PlaceholderMeta),
    );
  };

  for (const [index, { file, uploadId }] of queue.entries()) {
    let uploaded: UploadedAttachment | null = null;
    try {
      uploaded = await upload(file);
    } catch {
      onError(`「${file.name}」を添付できませんでした。もう一度試してください`);
    }
    if (!isAlive() || editor.isDestroyed) {
      for (const rest of queue.slice(index)) removePlaceholder(rest.uploadId);
      return;
    }
    const at = findUploadPlaceholder(editor.state, uploadId);
    if (uploaded === null) {
      removePlaceholder(uploadId);
      continue;
    }
    if (at === null) {
      // 送っている間に本文が差し替わった（版を戻した等）。どこに置くべきか分からないので置かない。
      onError(`「${file.name}」は送れましたが、本文が差し替わったため置けませんでした。もう一度添付してください`);
      continue;
    }
    const node = editor.schema.nodes.attachment.create({
      attachmentId: uploaded.id,
      pageId: uploaded.pageId,
      filename: uploaded.filename,
      contentType: uploaded.contentType,
      size: uploaded.sizeBytes,
    });
    const tr = editor.state.tr;
    const $at = tr.doc.resolve(at);
    if ($at.parent.canReplaceWith($at.index(), $at.index(), node.type)) {
      tr.insert(at, node);
    } else {
      // 置いた後の編集で境目が置けない場所になった（起きにくい）。収まる場所を ProseMirror に探させる。
      tr.replaceRangeWith(at, at, node);
    }
    editor.view.dispatch(
      tr.setMeta(attachmentUploadPluginKey, {
        placed: { uploadId, from: at, to: tr.mapping.map(at, 1) },
      } satisfies PlaceholderMeta),
    );
  }
}
