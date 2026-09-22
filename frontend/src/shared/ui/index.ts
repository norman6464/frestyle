/*
 * shared/ui の Public API。
 *
 * FSD の公式仕様どおり、ワイルドカード（`export *`）は使わず名前付きで再 export する。
 * 何が外に出ているかがこのファイルだけで分かる状態を保つため。
 */

// --- プリミティブ ---
export { default as FormatIcon } from './FormatIcon';
export type { FormatIconName, FormatIconProps } from './FormatIcon';
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { default as InputField } from './InputField';
export { default as FieldSelect } from './FieldSelect';
export type { FieldSelectOption, FieldSelectProps } from './FieldSelect';
export { default as TextareaField } from './TextareaField';
export { default as AutoResizeTextarea } from './AutoResizeTextarea';
export { default as LinkText } from './LinkText';
export { default as SNSSignInButton } from './SNSSignInButton';
export { default as NameCreateForm } from './NameCreateForm';
export { default as Loading } from './Loading';
export { default as Avatar } from './Avatar';

// --- フォーム補助 ---
export { default as FormFieldError } from './FormFieldError';
export { default as FormMessage } from './FormMessage';
export type { FormMessage as FormMessageData } from './FormMessage';

// --- 画面の枠・状態表示 ---
export { SidebarSlotProvider, SidebarSlotTarget, SidebarSection } from './SidebarSlot';
export { default as ConfirmModal } from './ConfirmModal';
export { default as EmptyState } from './EmptyState';
export { default as PageHeader } from './PageHeader';
export { default as PageFrame } from './PageFrame';
export { default as ContentSection } from './ContentSection';
export { default as Disclosure } from './Disclosure';
export { default as Toast } from './Toast';

/*
 * RichTextEditor は **意図的にこの barrel から出さない**。
 *
 * 中身は tiptap / ProseMirror（数百 KB）で、ここで re-export すると `@/shared/ui` を
 * import した全ページがエディタ一式を巻き込みコード分割が壊れる。利用側は深いパス
 * `@/shared/ui/RichTextEditor`（サブ Slice の Public API）から直接 import し、
 * 必要なら lazy import で遅延ロードすること。
 *
 * 軽量ヘルパ（emptyRichDoc / isRichDoc / 型 RichDocContent）や保存状態表示
 * （SaveStatusIndicator / 型 SaveStatus）も、同じ Slice にまとまっているため深いパスから取る。
 */
