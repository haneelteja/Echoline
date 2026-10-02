"use client";

export default function ActivityPage() {
  return (
    <>
      <div className="top">
        <div>
          <h1>Activity log</h1>
          <p>Populated from message_events once sending and webhooks (Phases 3–4) are live.</p>
        </div>
      </div>
      <div className="empty panel">
        <h2>Nothing logged yet</h2>
        <p>This view will stream message_events for the active project in real time.</p>
      </div>
    </>
  );
}
