/**
 * Setup placeholder — real wizard is built in Phase 8.
 * This page is shown when /api/setup/status indicates setup is incomplete
 * or when the endpoint is not yet available (404 = pre-Phase-8).
 */
import ShardMark from '../components/ShardMark';
import '../styles/theme.css';
import './Setup.css';

export default function Setup() {
  return (
    <main className="setup-shell">
      <div className="setup-content">
        <ShardMark size={48} />
        <h1 className="setup-title">Shard Setup</h1>
        <p className="setup-body">
          Configure your instance before signing in. The setup wizard will be
          available in a future release.
        </p>
        <a
          href="https://github.com/zhixiangli/Shard"
          className="setup-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          View documentation →
        </a>
      </div>
    </main>
  );
}
