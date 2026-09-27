// inkwell — 押下波紋 + 標高シャドウの触感的 UI プリミティブ群。
// Roboto を自己ホストで読み込む（font-roboto を付けた要素のみに適用。全体フォントは不変）。
// このファイルは package.json の sideEffects に載せてある。載せないと、部品だけを使う画面では
// 本番のビルドがこの公開口ごと飛ばし、書体の CSS が落ちる。
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

export { default as InkwellButton } from './InkwellButton';
export type { InkwellButtonProps, InkwellButtonVariant, InkwellButtonColor, InkwellButtonSize } from './InkwellButton';

export { default as InkwellTextField } from './InkwellTextField';
export type { InkwellTextFieldProps } from './InkwellTextField';

export { default as InkwellCard, InkwellCardContent, InkwellCardActions } from './InkwellCard';
export type { InkwellCardProps, InkwellElevation } from './InkwellCard';

export { default as InkwellCheckbox } from './InkwellCheckbox';
export type { InkwellCheckboxProps } from './InkwellCheckbox';

export { default as InkwellSwitch } from './InkwellSwitch';
export type { InkwellSwitchProps } from './InkwellSwitch';

export { default as InkwellLoadingButton } from './InkwellLoadingButton';
export type { InkwellLoadingButtonProps } from './InkwellLoadingButton';

export { default as InkwellCircularProgress } from './InkwellCircularProgress';
export type { InkwellCircularProgressProps } from './InkwellCircularProgress';

export { default as InkwellLinearProgress } from './InkwellLinearProgress';
export type { InkwellLinearProgressProps } from './InkwellLinearProgress';

export { default as InkwellSkeleton } from './InkwellSkeleton';
export type { InkwellSkeletonProps } from './InkwellSkeleton';

export { useAsyncAction } from './useAsyncAction';
export type { AsyncStatus } from './useAsyncAction';
