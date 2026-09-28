import { KB_INDENT_PX, KB_TOGGLE_WIDTH_PX } from './KbPageRow';

export interface KbHiddenChildrenRowProps {
  depth: number;
}

/**
 * KbHiddenChildrenRow は「この段に、自分には見えないページが在る」ことだけを示す行。
 *
 * **枚数も題名も出さない。** そもそも API が返してこない（返してもいけない）。
 * ただ消すと木に穴が空いた理由が分からず「壊れている」と読まれるので、在ることだけを示す。
 *
 * 押せる行ではないので treeitem にはしない。ツリーの項目として数えられると、
 * 上下移動で止まるのに何も起きない行になる。
 *
 * ただし li から役割を剥がす（role="none"）ことはしない。木を名乗るのをやめた
 * いまはただの一覧で、役割を剥がすと「ul の直下に項目が 1 つも無い」壊れた一覧になる。
 * 押せないことは、中に押せるものを置かないことで足りている。
 */
export default function KbHiddenChildrenRow({ depth }: KbHiddenChildrenRowProps) {
  return (
    <li>
      <p
        className="py-0.5 text-xs text-[var(--color-text-muted)]"
        style={{ paddingLeft: depth * KB_INDENT_PX + KB_TOGGLE_WIDTH_PX }}
      >
        表示できないページがあります
      </p>
    </li>
  );
}
