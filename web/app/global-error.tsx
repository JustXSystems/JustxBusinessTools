"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 420 }}>
          <h1>Application error</h1>
          <p>{error.message || "Unexpected error"}</p>
          <button type="button" onClick={() => reset()}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
