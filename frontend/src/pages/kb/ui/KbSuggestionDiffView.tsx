import type { SuggestionDiffLine } from '../lib/suggestionDiff';

export interface KbSuggestionDiffViewProps {
  lines: SuggestionDiffLine[];
}

/**
 * 描画する差分行数の上限。これを超えたら行を間引いて一部だけ見せるのではなく、
 * 丸ごと「差分が大きすぎます」の代替表示に切り替える — 間引くと、間引かれた側に
 * 紛れ込ませた変更（リンク・画像の差し替え等）が採用者から見えなくなるため、
 * 中途半端に見せるより「これは中身を直接確認してください」と伝える方が安全。
 */
const MAX_RENDERED_LINES = 500;

const LINE_STYLE: Record<SuggestionDiffLine['type'], string> = {
  added: 'bg-success-soft text-success',
  removed: 'bg-danger-soft text-danger-ink line-through',
  unchanged: 'text-[var(--color-text-secondary)]',
  note: 'text-[var(--color-text-muted)] italic',
};

// 色だけで追加/削除を伝えない（色を区別できない人にも伝わるように）。削除行は打ち消し線が
// 既にあるので、追加行にも "+"、削除行にも "-" を添えて記号でも区別できるようにする。
const LINE_PREFIX: Record<SuggestionDiffLine['type'], string> = {
  added: '+ ',
  removed: '- ',
  unchanged: '  ',
  note: '',
};

const LINE_ARIA_LABEL: Record<SuggestionDiffLine['type'], string | undefined> = {
  added: '追加',
  removed: '削除',
  unchanged: undefined,
  note: '注記',
};

/**
 * KbSuggestionDiffView は行単位の差分（追加=緑・削除=赤の打ち消し線・不変=地の文）を描く。
 *
 * 差分そのものの計算は持たない（pages/kb/lib/suggestionDiff.computeSuggestionDiff が担う）。
 * 空行は `&nbsp;` で埋め、行の高さが潰れて見えなくならないようにする。
 *
 * 行数が MAX_RENDERED_LINES を超えるときは、行を一切描画せず代替の警告文だけを出す
 * （computeSuggestionDiff が既に入力サイズ自体は絞っているが、短い行が大量にある場合など
 * 差分行数そのものが膨らむ入力は残るため、描画側にも独立して上限を持つ）。
 */
export default function KbSuggestionDiffView({ lines }: KbSuggestionDiffViewProps) {
  if (lines.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">差分はありません。</p>
    );
  }
  if (lines.length > MAX_RENDERED_LINES) {
    return (
      <p role="alert" className="text-sm leading-relaxed text-warning">
        差分が大きすぎるため表示できません。採用する前に本文を直接確認してください。
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-surface-3 bg-surface-1 p-2 font-mono text-xs leading-relaxed">
      {lines.map((line, index) => {
        const label = LINE_ARIA_LABEL[line.type];
        return (
          <div key={index} className={LINE_STYLE[line.type]}>
            <span aria-hidden="true">{LINE_PREFIX[line.type]}</span>
            {label && <span className="sr-only">{label}: </span>}
            {line.text || ' '}
          </div>
        );
      })}
    </div>
  );
}
