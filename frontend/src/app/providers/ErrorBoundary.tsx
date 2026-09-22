import { Component, type ReactNode } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

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

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-4">
          <div className="bg-danger-soft rounded-full p-4 mb-4">
            <ExclamationTriangleIcon className="w-8 h-8 text-danger-ink" />
          </div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">エラーが発生しました</h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-4 max-w-sm">
            予期せぬエラーが発生しました。再試行するか、問題が解決しない場合はページを再読み込みしてください。
          </p>
          <button
            onClick={this.handleRetry}
            className="bg-brand-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
          >
            再試行
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
