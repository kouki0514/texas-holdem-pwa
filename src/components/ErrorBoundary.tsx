import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-felt-dark gap-6 px-6 text-center">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold text-white">エラーが発生しました</h1>
        <pre className="text-xs text-red-300 bg-black/40 rounded-xl p-4 max-w-lg w-full overflow-auto text-left max-h-48">
          {error.message}
          {'\n\n'}
          {error.stack?.split('\n').slice(1, 6).join('\n')}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl transition-colors"
        >
          リロード
        </button>
      </div>
    )
  }
}
