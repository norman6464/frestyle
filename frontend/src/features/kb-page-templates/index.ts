/*
 * features/kb-page-templates の Public API。
 *
 * ページの雛形（テンプレート）を使う操作: 雛形を選んで新しいページを作る（左の列の「雛形から作る」と
 * 本文の /template）・今のページを雛形として保存する。左の列（widgets/kb-frame）とページの画面
 * （pages/kb）の 2 か所から使う。
 */
export { default as KbTemplatePickerModal } from './ui/KbTemplatePickerModal';
export type { KbTemplatePickerModalProps } from './ui/KbTemplatePickerModal';
export { default as KbSaveAsTemplateButton } from './ui/KbSaveAsTemplateButton';
export { useKbPageTemplates } from './model/useKbPageTemplates';
