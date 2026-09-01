"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="login-page" style={{ padding: "2rem 1rem" }}>
      <div className="panel login-panel" style={{ maxWidth: 420 }}>
        <h1>Something went wrong</h1>
        <p className="muted">{error.message || "Unexpected client error"}</p>
        {error.digest ? <p className="muted">Ref: {error.digest}</p> : null}
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
      </div>
    </main>
  );
}
