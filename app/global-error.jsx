'use client';

// The backstop behind error.jsx: this one catches crashes in the root layout
// itself, where error.jsx cannot run. It replaces the ENTIRE document, so it
// must render its own <html> and <body> and cannot rely on the site's
// stylesheet being present -- hence inline styles and no components. It should
// almost never be seen; when it is, the advice is the same as everywhere else
// on this site: refresh first.

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'Helvetica, Arial, sans-serif',
          background: '#fafafa',
          color: '#262626',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Sorry — the site hit a problem. Anything you had already saved is safe, and
            refreshing almost always fixes this.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#2f6f88',
              color: '#fff',
              border: 0,
              borderRadius: '4px',
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Refresh the page
          </button>
          <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#737373' }}>
            Still stuck? Email info@luke14ministries.net.
          </p>
        </div>
      </body>
    </html>
  );
}
