export function PortalPage() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Employee Self-Service Portal</h1>
      <p>View your onboarding tasks, documents, and personal employment details.</p>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My learning</h2>
        <p>Courses and learning paths assigned to you.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Pending review requests</h2>
        <p>360° feedback waiting on your input.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My OKRs</h2>
        <p>Quarterly objectives and key results.</p>
      </section>
      <section style={{ marginTop: '1.5rem' }}>
        <h2>My IDP</h2>
        <p>Individual development plan for the current quarter.</p>
      </section>
      <p>
        <em>Full self-service portal content lands alongside the Phase 6 UI.</em>
      </p>
    </div>
  )
}
