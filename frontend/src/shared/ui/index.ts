/*
 * shared/ui の Public API。
 *
 * FSD の公式仕様どおり、ワイルドカード（`export *`）は使わず名前付きで再 export する。
 * 何が外に出ているかがこのファイルだけで分かる状態を保つため。
 */

// --- プリミティブ ---
export { default as FormatIcon } from './FormatIcon';
export { default as FsIcon } from './icons/FsIcon';
export type { FsIconProps } from './icons/FsIcon';
export { fsIcon } from './icons/fsIconFactory';
export type { FsIconBoundProps } from './icons/fsIconFactory';
export { FS_ICON_NAMES } from './icons/fsIconParts';
export type { FsIconName } from './icons/fsIconParts';
export { default as FsIllustration } from './icons/FsIllustration';
export type { FsIllustrationName } from './icons/FsIllustration';
export type { FormatIconName, FormatIconProps } from './FormatIcon';
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { default as ButtonLink } from './ButtonLink';
export type { ButtonLinkProps } from './ButtonLink';
export { default as InputField } from './InputField';
export { default as FieldSelect } from './FieldSelect';
export type { FieldSelectOption, FieldSelectProps } from './FieldSelect';
export { default as TextareaField } from './TextareaField';
export { default as AutoResizeTextarea } from './AutoResizeTextarea';
export { default as LinkText } from './LinkText';
export { default as SNSSignInButton } from './SNSSignInButton';
export { default as BrandLogo } from './BrandLogo';
export { default as PublicHeader } from './PublicHeader';
export { default as NameCreateForm } from './NameCreateForm';
export { default as Loading } from './Loading';
export { default as Avatar } from './Avatar';
export { default as LabelChip } from './LabelChip';
export type { LabelChipProps } from './LabelChip';

// --- フォーム補助 ---
export { default as FormFieldError } from './FormFieldError';
export { default as FormMessage } from './FormMessage';
export type { FormMessage as FormMessageData } from './FormMessage';

// --- 画面の枠・状態表示 ---
export { default as ConfirmModal } from './ConfirmModal';
export { default as EmptyState } from './EmptyState';
export { default as EmptyNotice } from './EmptyNotice';
export type { EmptyNoticeProps } from './EmptyNotice';
export { default as ErrorNotice } from './ErrorNotice';
export type { ErrorNoticeProps } from './ErrorNotice';
export { default as SkeletonRows } from './SkeletonRows';
export type { SkeletonRowsProps } from './SkeletonRows';
export { default as PageHeader } from './PageHeader';
export { default as PageFrame } from './PageFrame';
export { default as ContentSection } from './ContentSection';
export { default as Disclosure } from './Disclosure';
export { default as Toast } from './Toast';
export type { ToastType } from './Toast';
export { default as SaveStatusIndicator } from './SaveStatusIndicator';

// --- 本文エディタで共有する小さな部品 ---
// リンクの URL 入力欄。ナレッジ（pages/kb）とバックログ（pages/backlog）の本文エディタが同じ欄を使う。
// 本文エディタそのもの（tiptap 一式・数百 KB）は shared に置かない（pages/kb/ui/editor にあり、
// バックログの本文エディタとは別物）。ここに載せるのは、置く面を選ばない軽い部品だけ。
export { default as LinkUrlForm } from './LinkUrlForm';
export type { LinkUrlFormProps } from './LinkUrlForm';
