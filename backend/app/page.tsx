export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Big D&apos;s Tree Service - Intake Backend</h1>
      <p>API endpoints:</p>
      <ul>
        <li><code>POST /api/chat</code> - Chat intake endpoint</li>
        <li><code>POST /api/upload</code> - Photo upload (coming soon)</li>
        <li><code>GET /admin/lead/[id]</code> - Owner finalize page (coming soon)</li>
      </ul>
    </main>
  );
}
