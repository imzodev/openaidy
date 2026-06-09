export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-logo">
        Open<span>Aidy</span>
      </div>
      <div className="navbar-links">
        <a href="/docs">Docs</a>
        <a href="#features">Features</a>
        <a
          href="https://github.com/imzodev/openaidy"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a href="#features">
          <button className="btn-primary">Start building →</button>
        </a>
      </div>
    </nav>
  );
}
