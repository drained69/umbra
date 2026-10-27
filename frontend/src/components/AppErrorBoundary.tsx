import { Component, type ReactNode } from "react";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="recovery-screen"><img src="/umbra-mark.svg" width="48" height="48" alt="Umbra" /><h1>Something went wrong</h1><p>Umbra couldn’t load this screen. Reload to try again. Your saved keys and notes remain in this browser.</p><button className="hero-primary" onClick={() => location.reload()}>Reload Umbra</button></main>;
  }
}
