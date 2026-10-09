import { useState } from "react";

const checklist = [
  "Edit your app in src/App.tsx",
  "Add styles in src/styles.css",
  "Run the production build with pnpm run build",
];

export default function App() {
  const [started, setStarted] = useState(false);

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Project home">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>EngineeringOS</span>
        </a>
        <span className="template-tag">React · Vite · TypeScript</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Your workspace is ready</p>
          <h1>Start with a clear idea.<br /><span>Build from here.</span></h1>
          <p className="intro">
            This project is set up with React, Vite, and TypeScript. Change the
            starter screen, add your components, and make it yours.
          </p>
          <button className="primary-button" onClick={() => setStarted(true)}>
            {started ? "You're ready to build" : "Get started"}
            <span aria-hidden="true">↗</span>
          </button>
        </div>

        <div className="preview-card" aria-label="Starter checklist">
          <div className="card-topline">
            <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>project starter</span>
          </div>
          <div className="card-content">
            <div className="card-icon" aria-hidden="true">✳</div>
            <h2>A useful place to begin</h2>
            <p>Everything is installed and ready for your next change.</p>
            <ul>
              {checklist.map((item, index) => (
                <li key={item}>
                  <span className="check-number">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="page-footer">
        <span>Built for iteration.</span>
        <span>React + Vite starter</span>
      </footer>
    </main>
  );
}
