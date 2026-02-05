import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('Lightspeed Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-inner">
            <h1>Something went wrong</h1>
            <p>Lightspeed encountered an error. Please try refreshing the page.</p>
            <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
              If this keeps happening, please contact support.
            </p>
            <pre>
              {this.state.error?.toString()}
              {this.state.errorInfo?.componentStack
                ? '\n\nComponent Stack:' + this.state.errorInfo.componentStack
                : ''}
            </pre>
            <button onClick={() => window.location.reload()}>
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
