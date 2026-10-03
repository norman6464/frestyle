import type { KatexOptions } from 'katex';

/**
 * 数式（KaTeX）と図（mermaid）の描画の口。どちらも大きい（KaTeX は書体込みで数百 KB、mermaid は
 * 数 MB）ので、**初めて描くときにだけ** `import()` で読む。数式や図の無いページでは読まれない
 * （初期の塊にも本文エディタの塊にも入らない。check-initial-load と Storybook の見本で確かめる）。
 *
 * 読み込みはここ 1 か所に閉じる（NodeView は描画の結果だけを受け取る）。テストはこのモジュールを
 * 差し替えて、重い道具を読まずに NodeView の振る舞いを確かめる。
 */

type Katex = typeof import('katex').default;
type Mermaid = typeof import('mermaid').default;

/**
 * KaTeX の設定。
 * - throwOnError: true … 読めない式は例外にして、画面側で理由と元の式を出す（既定の赤い文字だけの
 *   表示では、何が悪いのか書いた人に伝わらない）
 * - trust: false … \href・\includegraphics など外へ出る命令を通さない
 * - maxExpand / maxSize … マクロの展開回数と大きさの上限（\def の再帰や巨大な \rule で固まらせない）
 * - output: htmlAndMathml … 見た目（HTML）と読み上げ用（MathML）の両方を出す
 */
const KATEX_OPTIONS: KatexOptions = {
  throwOnError: true,
  trust: false,
  strict: 'ignore',
  maxExpand: 100,
  maxSize: 10,
  output: 'htmlAndMathml',
};

let katexLoading: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  // CSS（と CSS が参照する書体）も同じときに読む。書体は自前で配信される（CSP の font-src 'self'）。
  katexLoading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')])
    .then(([module]) => module.default)
    .catch((error: unknown) => {
      // 読み込みに失敗したら次に描くときにもう一度試せるよう、控えを捨てる。
      katexLoading = null;
      throw error;
    });
  return katexLoading;
}

let mermaidLoading: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  mermaidLoading ??= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        // strict: 図の中の HTML とクリックの動作を通さない（DOMPurify で消毒される）。
        securityLevel: 'strict',
        // ラベルを HTML（foreignObject）ではなく SVG の文字で描く。HTML を差し込む口を作らない。
        htmlLabels: false,
        // 描けない図のときに mermaid 自身のエラー図を body へ足させない（理由は画面側で出す）。
        suppressErrorRendering: true,
        theme: 'neutral',
      });
      return mermaid;
    })
    .catch((error: unknown) => {
      mermaidLoading = null;
      throw error;
    });
  return mermaidLoading;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return String(error);
}

export type MathRenderResult = { html: string } | { error: string };

/**
 * renderMath は latex を HTML（KaTeX の出力）にする。読めない式は { error } を返す（例外にしない）。
 * 出力は trust: false の KaTeX が組み立てたもので、利用者の文字は KaTeX がエスケープ済み。
 */
export async function renderMath(latex: string, displayMode: boolean): Promise<MathRenderResult> {
  let katex: Katex;
  try {
    katex = await loadKatex();
  } catch {
    return { error: '数式の描画の道具を読み込めませんでした。' };
  }
  try {
    return { html: katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode }) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export type DiagramRenderResult = { svg: string } | { error: string };

let diagramSeq = 0;

/**
 * renderDiagram は mermaid の書式の文字を SVG にする。描けない文字は { error } を返す。
 * SVG は securityLevel: 'strict' の mermaid が消毒済み。
 */
export async function renderDiagram(source: string): Promise<DiagramRenderResult> {
  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return { error: '図の描画の道具を読み込めませんでした。' };
  }
  try {
    diagramSeq += 1;
    const { svg } = await mermaid.render(`rte-diagram-${diagramSeq}`, source);
    return { svg };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
