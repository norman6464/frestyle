import { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { ACCEPTED_IMAGE_ACCEPT_ATTR } from '@/shared/config/imageUpload';
import { createEditorExtensions } from './editorExtensions';
import type { EditorCommand } from './editorCommands';
import { buildSlashItems } from './slashItems';
import { acceptedImageFiles, insertUploadedImages } from './imageInsertion';
import { sanitizeDocLinks } from './linkSafety';
import { openClickedLink } from './linkClick';
import { fillMissingBlockIdsInDoc } from './stableBlockId';
import BubbleFormatMenu from './BubbleFormatMenu';
import SaveStatusIndicator, { type SaveStatus } from './SaveStatusIndicator';
import { emptyRichDoc, type RichDocContent } from './emptyRichDoc';
import type { CommentAnchor } from './commentAnchor';
import { useCommentBadgeSync, createCommentBadgesExtension, type CommentBadgeCounts } from './commentBadges';
import './richTextEditor.css';

export interface RichTextEditorProps {
  /** 表示・編集する tiptap ドキュメント JSON（正本）。 */
  value: RichDocContent;
  /** 本文が変わるたびに最新の doc JSON を返す（editable=false のときは呼ばれない）。 */
  onChange?: (value: RichDocContent) => void;
  /** 編集可否。false で読み取り専用（バブルメニュー非表示）。既定 true。 */
  editable?: boolean;
  /** 空のときに表示するプレースホルダ。 */
  placeholder?: string;
  /** 編集領域のアクセシブルネーム。 */
  ariaLabel?: string;
  /** 保存状態の表示（未指定なら表示しない）。保存の実処理は画面側が持つ。 */
  saveStatus?: SaveStatus;
  /**
   * 画像をアップロードして表示用 URL を返す。指定したときだけ画像挿入
   * （ドラッグ&ドロップ・貼り付け）が有効になる。
   * 失敗時の通知（トースト等）は呼び出し側の方針に委ねる（ここでは握りつぶす）。
   */
  onImageUpload?: (file: File) => Promise<string>;
  /**
   * "kb/" で始まる画像 src（S3 の key）を表示用の一時 URL へ解決する。
   * 渡さなければ画像ノードは解決を試みず src をそのまま使う（story・他画面との後方互換）。
   * エディタ生成時に固定される（extraSlashCommands と同じ契約）。
   */
  resolveImageSrc?: (src: string) => Promise<string>;
  /**
   * エディタ生成直後に一度だけ呼ばれるライフサイクルフック。
   * 生成直後にフォーカスしたい・外部から editor を参照して拡張したい、といった用途の拡張点。
   */
  onCreate?: (editor: Editor) => void;
  /**
   * '/' メニューへ追加するコマンド。エディタが知らない操作（子ページの作成など、
   * 業務を知る操作）は呼び出し側がここから差し込む。エディタは項目の中身を解釈しない。
   *
   * **項目はエディタ生成時に固定される。** run の closure が画面の状態を読むなら、
   * 呼び出し側で ref 越しに最新を参照させること（この配列自体を差し替えても反映されない）。
   */
  extraSlashCommands?: EditorCommand[];
  /**
   * 書式ボタン列を上部に常設する（編集できるときだけ）。バブルメニュー（選択時に
   * 浮かぶ方）はそのまま併存する — どちらも同じコマンドレジストリを叩くので二重実装にはならない。
   */
  /**
   * 本文中の内部ページリンク（/kb/{id}）を開くときの遷移。渡すとアプリ内遷移になる
   * （渡さなければ素の遷移）。外部リンクは常に新しいタブで開く。
   */
  onNavigateToPage?: (path: string) => void;
  /**
   * 選択範囲からコメントを作りたいときに呼ばれる（バブルメニューの「コメント」ボタン）。
   * 渡さなければボタン自体を出さない（CommentFormatControl 側の約束）。
   */
  onRequestComment?: (anchor: CommentAnchor) => void;
  /**
   * コメントできる立場か（domain.PagePermission.CanComment）。editable とは別軸 —
   * 編集権限は無いがコメントだけできる立場（GrantRoleCommenter）が実在するため、
   * editable=false でもこれが true ならバブルメニューを出し「コメント」ボタンだけ使える
   * ようにする（書式ボタン・リンクは editable=false のままなら出さない）。
   */
  canComment?: boolean;
  /**
   * ブロックIDごとの未解決コメント件数。渡したブロックの右肩に件数バッジを出す
   * （commentBadges.ts の Decoration.widget）。未指定なら {} 扱い（バッジ無し）。
   */
  commentBadgeCounts?: CommentBadgeCounts;
  /** コメント件数バッジをクリックしたときに呼ばれる。渡さなければバッジはクリックできても何もしない。 */
  onCommentBadgeClick?: (blockId: string) => void;
  /** 増えたら本文の先頭へフォーカスを移す合図（題名で Enter → 本文へ、のため）。 */
  focusSignal?: number;
  /** 外枠に付与する追加クラス。 */
  className?: string;
}

/**
 * RichTextEditor は tiptap ベースのリッチテキストエディタ。
 * doc JSON を value/onChange で制御する。書式は StarterKit の基本ノード/マーク＋画像に対応。
 *
 * 見た目は枠のないインライン文書（固定ツールバーは持たず、テキスト選択時に浮かぶバブルメニューで
 * 書式を出す）。スラッシュコマンド・ドラッグハンドルは後続 PR で足す。
 *
 * ビジネスを知らない再利用資産（shared/ui）として置く。保存フロー（debounce・PUT・楽観ロック）は
 * この部品ではなく利用側の画面が担う。
 */
/**
 * stableDocString は doc の同一性比較のためにキー順を揃えて文字列化する。
 *
 * 素の JSON.stringify で比べると、**キーの並びが違うだけ**で「内容が変わった」と
 * 誤判定する。実際、サーバーはページ参照の題名解決で doc を作り直して返し、その際
 * キーがアルファベット順になる。tiptap の getJSON() は type が先なので、素の比較だと
 * 開いただけで onChange が発火し、閲覧しただけの人が本文の保存（全置換）を発行して
 * 同時編集者の直近の書き込みを潰しうる。比較のためだけに使い、値そのものは変えない。
 *
 * ブロックの `id` attribute（stableBlockId.ts）は比較から除外する。id は crypto.randomUUID()
 * で穴埋めするたびに新しい値になるので、素の値まで比較すると「同じ内容なのに id 生成が
 * 別タイミングで走っただけ」で不一致（＝内容が変わった）と誤判定してしまう
 * （例: マウント時に埋めた id と、直後に同じ doc をもう一度整える経路とで別の乱数になる）。
 * id 自体は保存のたびにバックエンドが確定させるので、比較対象から外しても安全。
 * id を除いた結果 attrs が空 object になったノード（＝ id だけを持っていたノード）は
 * 「attrs キー自体を持たない」ノードと同一視する（tiptap の getJSON() は attrs を
 * 1 つも宣言していないノードでは attrs キー自体を出さないため、id 属性を新設した
 * paragraph/blockquote 等はここを揃えないと「id 抜きの入力 doc」と「id 補充後の doc」が
 * 常に不一致になってしまう）。
 */
/**
 * MAX_STABLE_STRING_DEPTH は stableValueString の自己再帰が辿る入れ子の上限。
 * linkSafety.ts / stableBlockId.ts と同じ理由・同じ値（上限が無いと極端に深い doc で
 * コールスタックを使い切る）。上限を超えた先は固定のプレースホルダ文字列に丸め、
 * それ以上は再帰しない — 比較専用の文字列化なので、そこだけ実際の値と食い違っても
 * 「深すぎる doc 同士は同じ深さまでしか比較しない」という劣化で済む
 * （誤って「差分あり」と判定して保存を止める側には倒れない）。
 */
const MAX_STABLE_STRING_DEPTH = 300;

function stableValueString(value: unknown, excludeId: boolean, depth = 0): string | undefined {
  if (value === undefined) return undefined;
  if (depth >= MAX_STABLE_STRING_DEPTH) return '"…"';
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableValueString(v, excludeId, depth + 1) ?? 'null').join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !(excludeId && k === 'id'))
      .map(([k, v]) => [k, stableValueString(v, excludeId, depth + 1)] as [string, string | undefined])
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${v}`);
    // 中身が id だけ（＝除外後は空）だった object は「キーが無い」のと同一視する（上のコメント）。
    if (entries.length === 0) return undefined;
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** onUpdate（自分の編集）の重複通知判定用。id は生成タイミングで変わりうるので比較から除く。 */
function stableDocString(node: unknown): string {
  return stableValueString(node, true) ?? '{}';
}

/**
 * fullDocString は外部 value の同期判定専用（id を除外しない）。
 *
 * onUpdate の重複判定と同じ id 除外比較を外部同期にも使うと、可視本文が同じで
 * block id だけが異なる別ページへ移動したときに「変更なし」と誤判定し、setContent が
 * 呼ばれず前ページの block id を保ったまま新しいページの文脈で編集を続けてしまう。
 * 保存すると他ページの block id を送ることになり block_id_conflict（409）を招く。
 * id の生成タイミング差を吸収する必要が無い外部同期では、id を含めた完全な値で比較してよい。
 */
function fullDocString(node: unknown): string {
  return stableValueString(node, false) ?? '{}';
}

export default function RichTextEditor({
  value,
  onChange,
  editable = true,
  placeholder = '本文を入力…',
  ariaLabel = '本文',
  saveStatus,
  onImageUpload,
  resolveImageSrc,
  onCreate,
  extraSlashCommands,
  onNavigateToPage,
  onRequestComment,
  canComment = false,
  commentBadgeCounts,
  onCommentBadgeClick,
  focusSignal = 0,
  className = '',
}: RichTextEditorProps) {
  // onChange は props で差し替わり得るので ref 越しに最新を呼ぶ（onUpdate クロージャの陳腐化を防ぐ）。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // onCreate も生成時クロージャの陳腐化を避けるため ref 越しに最新を呼ぶ。
  const onCreateRef = useRef(onCreate);
  useEffect(() => {
    onCreateRef.current = onCreate;
  }, [onCreate]);

  // 画像アップロード関数・editor 参照を ref で持ち、editorProps（paste/drop）から最新を参照する。
  const onImageUploadRef = useRef(onImageUpload);
  useEffect(() => {
    onImageUploadRef.current = onImageUpload;
  }, [onImageUpload]);
  const editorRef = useRef<Editor | null>(null);
  // '/image' から開くファイル選択（キーボード/クリックでも画像を挿入できる経路）。
  const fileInputRef = useRef<HTMLInputElement>(null);

  // onCommentBadgeClick も extension（生成時に固定）から呼ぶので ref 越しに最新を参照する
  // （onImageUploadRef と同じ理由）。
  const onCommentBadgeClickRef = useRef(onCommentBadgeClick);
  useEffect(() => {
    onCommentBadgeClickRef.current = onCommentBadgeClick;
  }, [onCommentBadgeClick]);

  // コメント件数バッジの decoration へ渡す ref。useEditor() より前に呼ぶ必要がある
  // （extensions 配列の組み立てに使うため）。この時点では editorRef.current はまだ
  // 前回描画時点の値（初回は null）だが、それで問題ない — decoration の初期値は
  // 下の commentBadgeCountsRef.current（この呼び出しで同期済み）から組み立てるので、
  // 初回描画から正しい件数が出る。件数の更新（2 回目以降の描画）を editor へ伝える
  // dispatch は、editorRef.current が実体を指す次の描画以降で効く
  // （commentBadges.ts の useCommentBadgeSync のコメント参照）。
  const commentBadgeCountsRef = useCommentBadgeSync(editorRef.current, commentBadgeCounts ?? {});
  const handleCommentBadgeClick = useCallback((blockId: string) => {
    onCommentBadgeClickRef.current?.(blockId);
  }, []);

  // アンマウント（別ページへ切替）後にアップロードが完了しても挿入しないための番人。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // クリップボード/ドロップから画像ファイルだけ取り出し、選択順どおりに順次アップロード挿入する。
  const handleImageFiles = useCallback((files: FileList | null | undefined): boolean => {
    const upload = onImageUploadRef.current;
    const currentEditor = editorRef.current;
    if (!upload || !currentEditor) return false;
    const images = acceptedImageFiles(files);
    if (images.length === 0) return false;
    void insertUploadedImages(currentEditor, images, upload, () => mountedRef.current);
    return true;
  }, []);

  // 直近で「これが現在値」とみなしている doc の文字列表現。内容ベースで重複 emit を弾く。
  // tiptap はマウント時に一度 onUpdate を発火する（内容は初期 value と同じ）ため、初期値で初期化して
  // その空振り emit を握りつぶす（読み込み直後に「未保存」へ落ちないようにする）。
  const lastValueRef = useRef(stableDocString(value));

  // 洗浄済み・id 補充済みの value。**value が変わらない限り 1 回しか計算しない**ことが重要。
  // fillMissingBlockIdsInDoc は id の無いノードへ crypto.randomUUID() で新規採番するため、
  // 同じ value に対して呼ぶたびに毎回違う id が振られる。content:（初期化）と外部同期の
  // useEffect の両方が別々に呼んでしまうと、同じ内容でも id だけが食い違う 2 つの結果が
  // 生まれ、id を含めて比較する fullDocString が絶対に一致せず、マウント直後から
  // setContent が無限に（レンダーのたびに）呼ばれ続けてしまう。useMemo で 1 箇所に集約する。
  // sanitizeDocLinks / fillMissingBlockIdsInDoc は入れ子の段数に上限を持つのでもう
  // スタックオーバーフローでは落ちないが、doc は API から丸ごと差し込める値なので、
  // ここで拾えていない壊れ方（想定と違う形の attrs 等）がまだあり得る。マウント前の
  // useMemo で例外が漏れると React がエディタごと描画できず白画面になるため、
  // 最後の保険として空文書へ落とす（本文が消えたように見えるが、白画面よりはましで、
  // 元の value 自体は書き換えていないので保存し直しても失われない）。
  const filledValue = useMemo(() => {
    try {
      return fillMissingBlockIdsInDoc(sanitizeDocLinks(value));
    } catch {
      return emptyRichDoc();
    }
  }, [value]);

  // '/' メニューの項目。ベースはレジストリ（ブロック変換＋挿入）。画像アップロードが
  // 配線されているときだけ /image（ファイル選択）を足す。onImageUpload の有無だけに依存させ、
  // 拡張一式が編集のたびに作り直されないようにする。
  const hasImageUpload = Boolean(onImageUpload);
  const slashItems = useMemo<EditorCommand[]>(() => {
    const extra: EditorCommand[] = hasImageUpload
      ? [
          {
            id: 'image',
            label: '画像',
            group: 'insert',
            glyph: '画像',
            icon: { set: 'fs', name: 'image' },
            keywords: ['image', 'img', 'photo', 'picture', 'upload'],
            run: () => fileInputRef.current?.click(),
          },
        ]
      : [];
    return buildSlashItems([...extra, ...(extraSlashCommands ?? [])]);
    // extraSlashCommands は「エディタ生成時に固定」の契約（props の JSDoc 参照）なので
    // 依存に入れない — 入れても extensions は作り直されず、揃わない再計算だけが増える。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasImageUpload]);

  const editor = useEditor({
    editable,
    extensions: [
      ...createEditorExtensions({ placeholder, slashItems, resolveImageSrc }),
      // コメント件数バッジ（decoration）。extensions は生成時に固定されるため、件数・クリック
      // ハンドラは ref 越しに渡す（commentBadgeCountsRef は上の useCommentBadgeSync が返す）。
      createCommentBadgesExtension(commentBadgeCountsRef, handleCommentBadgeClick),
    ],
    // 読み込み側のリンク洗浄。doc JSON は API から丸ごと差し込めるので、エディタの入力・貼り付けを
    // どれだけ固めても「危険な href がすでに入った doc」はここから入ってくる。開いた時点で落とす。
    // id の穴埋めも同じ「editor へ渡す前に doc を整える」経路（stableBlockId.ts のコメント参照。
    // 生成直後に別途 transaction を dispatch する案は act() の外での再レンダーを誘発し
    // テストで実際に不具合を起こしたため、ここで先に埋める形にした）。
    content: filledValue,
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
      },
      // クリップボード/ドロップに画像ファイルがあればアップロードして挿入する。
      handlePaste: (_view, event) => handleImageFiles(event.clipboardData?.files),
      handleDrop: (_view, event) => {
        if (event.dataTransfer?.files && handleImageFiles(event.dataTransfer.files)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      onCreateRef.current?.(currentEditor);
    },
    onUpdate: ({ editor: currentEditor }) => {
      // 保存側のリンク洗浄。表示のときだけ無害化する作りだと、DB には危険な href が残ったままになり、
      // 別の読み手（別のクライアント・API 直叩き）に対して無防備なままになる。外へ出す値を洗う。
      const next = sanitizeDocLinks(currentEditor.getJSON()) as RichDocContent;
      const nextStr = stableDocString(next);
      // 内容が現在値と同じ（マウント時の空振り or 外部同期のエコー）なら通知しない。
      if (nextStr === lastValueRef.current) return;
      lastValueRef.current = nextStr;
      onChangeRef.current?.(next);
    },
  });
  editorRef.current = editor;

  // 外部から value が差し替わったとき（別ドキュメント読み込み等）だけ内容を同期する。
  // 自分の編集で親が value を更新した場合は現在値と一致するので setContent しない
  // （＝キャレットが飛ばず、無限ループにもならない）。
  useEffect(() => {
    // isDestroyed も見る。破棄済みの Editor は内部の commandManager を手放しており、
    // editor.commands に触れた瞬間に "Cannot read properties of null (reading 'commands')"
    // で落ちる。選択中のチケットが差し替わる・パネルが閉じるといった、エディタの破棄と
    // value の更新がほぼ同時に起きる経路で実際に踏んだ。
    if (!editor || editor.isDestroyed) return;
    // id を含めた完全な値でエディタの現在の中身と比較する（fullDocString のコメント参照）。
    // lastValueRef（id 除外）とは比較しない — id だけが違う別ページへの遷移を
    // 「変更なし」と見逃さないため。filledValue は useMemo で value ごとに 1 回だけ
    // 計算される値を使う（fillMissingBlockIdsInDoc を呼ぶたびに id 無しノードへ新しい
    // 乱数が振られるため、ここで呼び直すと id だけが食い違って比較が絶対に一致しなくなる）。
    if (fullDocString(filledValue) !== fullDocString(editor.getJSON())) {
      // 差し替えで入ってくる doc も読み込み時と同じ経路で洗ってある（filledValue）。
      editor.commands.setContent(filledValue, { emitUpdate: false });
      // setContent(emitUpdate:false) は onUpdate を発火しないため、次の自分の編集が
      // 正しく重複判定できるよう、ここで基準値（id 除外）を手動で合わせておく。
      lastValueRef.current = stableDocString(filledValue);
    }
  }, [editor, filledValue]);

  // editable の変更を反映する。
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  // 「増えたときだけ」フォーカスを移す。マウント時の値では動かない — ページを
  // 開き直しただけで本文が奪ってしまわないため（サイドバーの openSignal と同じ形）。
  const seenFocusSignal = useRef(focusSignal);
  useEffect(() => {
    // editor がまだ無いときは**合図を消費しない**。ここで見たことにすると、
    // 初期化中に題名で Enter を押した合図が捨てられ、本文へ移らないまま終わる。
    if (!editor) return;
    if (!editor.isDestroyed && focusSignal > seenFocusSignal.current) {
      editor.commands.focus('start');
    }
    seenFocusSignal.current = focusSignal;
  }, [editor, focusSignal]);

  return (
    // リンクはクリックで開く（編集中も読み取り専用も同じ経路。linkClick.ts のコメント参照）。
    // preventDefault は読み取り専用の素の <a> の既定遷移（全画面リロード）を止めるため。
    // キーボードは別経路が既にある: <a> 上の Enter はブラウザが click として発火する。
    <div
      className={`rte-root ${className}`}
      onClick={(event) => {
        if (openClickedLink(event.nativeEvent, onNavigateToPage, { editable })) {
          event.preventDefault();
        }
      }}
    >
      <div className="rte-content prose max-w-none">
        <EditorContent editor={editor} />
      </div>
      {(editable || canComment) && editor && (
        <BubbleFormatMenu editor={editor} editable={editable} onRequestComment={onRequestComment} />
      )}
      {onImageUpload && (
        // '/image' から開く隠しファイル入力（DnD/貼り付けと同じ挿入経路へ流す）。
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            handleImageFiles(e.target.files);
            e.target.value = '';
          }}
        />
      )}
      {saveStatus && saveStatus !== 'idle' && (
        <div className="mt-2 flex justify-end">
          <SaveStatusIndicator status={saveStatus} />
        </div>
      )}
    </div>
  );
}
