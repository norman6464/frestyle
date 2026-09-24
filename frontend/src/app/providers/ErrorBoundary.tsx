import { Component, type ReactNode } from 'react';
import { Button, FsIcon } from '@/shared/ui';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary は描画中の予期せぬ例外を受け止め、アプリ全体を白紙にしない。
 *
 * 回復手段は 3 つ並べる。「再試行」は同じ画面を描き直すだけなので、壊れた状態が
 * 残っていると同じ例外がまた出る。そのときのために「再読み込み」（状態を捨てて読み直す）と
 * 「ホームへ」（別の画面から始める）を用意する。ホームへは router を通さず素のリンクにする
 * （router 自体が壊れている場合でも動くように）。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-4">
          <div className="bg-danger-soft rounded-full p-4 mb-4">
            <FsIcon name="alert-triangle" className="w-8 h-8 text-danger-ink" />
          </div>
          {/* この画面はアプリ全体を置き換えるので、ページの見出し（h1）として出す。 */}
          <h1 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">エラーが発生しました</h1>
          <p className="text-sm text-[var(--color-text-muted)] mb-4 max-w-sm">
            予期せぬエラーが発生しました。再試行しても直らないときは、ページを再読み込みするか、ホームから開き直してください。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={this.handleRetry}>
              再試行
            </Button>
            <Button variant="secondary" onClick={this.handleReload}>
              再読み込み
            </Button>
            <a
              href="/"
              className="ui-control inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
            >
              ホームへ
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
