"use client";

import { Component, Suspense, type ReactNode } from "react";

type BoundaryProps = { fallback?: ReactNode; onError?: (error: unknown) => void; children: ReactNode };

class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/** Suspense na czas ładowania modeli plus granica błędu: pojedynczy zepsuty zasób nie wyłącza całej sceny. */
export function AssetBoundary({ fallback = null, onError, children }: BoundaryProps) {
  return (
    <ErrorBoundary fallback={fallback} onError={onError}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
