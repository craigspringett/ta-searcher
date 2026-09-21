import React from "react";

/**
 * Catches a rendering error anywhere below it and shows the message with a
 * Reload button instead of a blank page (Craig hit a blank shortlist page
 * on 18 September 2026 and nothing said why). The message is also logged
 * so it appears in the browser console.
 */
export class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Page failed to render", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "32px", maxWidth: 720, margin: "0 auto", color: "#1B2A41" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>This page hit a problem</h1>
        <p style={{ marginBottom: 12 }}>Something on this page failed to display. Reloading usually fixes it; if not, send this line to Claude:</p>
        <pre style={{ whiteSpace: "pre-wrap", background: "#F5F7F9", padding: 12, borderRadius: 6, fontSize: 13 }}>{message}</pre>
        <p style={{ marginTop: 12 }}>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #C9D1DA", background: "white", cursor: "pointer" }}>Reload the page</button>
          <a href="/" style={{ marginLeft: 12 }}>Back to He-Giveth</a>
        </p>
      </div>
    );
  }
}
