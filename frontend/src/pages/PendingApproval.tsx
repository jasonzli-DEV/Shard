import ShardMark from '../components/ShardMark';
import { useAuth } from '../context/AuthContext';
import '../styles/theme.css';
import './Login.css';
import './PendingApproval.css';

/**
 * Shown to authenticated users who are still pending admin approval.
 * Same two-panel shell as Login for visual continuity.
 */
export default function PendingApproval() {
  const { user, logout } = useAuth();

  return (
    <div className="login-shell">
      {/* Left: brand statement */}
      <aside className="login-brand">
        <div className="login-brand-inner">
          <ShardMark size={56} />
          <h1 className="login-wordmark">Shard</h1>
          <p className="login-tagline">
            Your storage,<br />
            your clusters,<br />
            no middleman.
          </p>
        </div>
        <div className="login-facet" aria-hidden="true" />
      </aside>

      {/* Right: pending state */}
      <main className="login-panel">
        <div className="login-form">
          <header className="login-form-header">
            <div className="pending-icon" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="var(--color-warning)" strokeWidth="1.5" />
                <path d="M12 7v5l3 3" stroke="var(--color-warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="login-form-title">Awaiting approval</h2>
            <p className="login-form-sub">
              {user?.email
                ? <>Your account (<span className="pending-email">{user.email}</span>) is pending admin approval.</>
                : 'Your account is pending admin approval.'}
            </p>
          </header>

          <div className="pending-body">
            <p className="pending-note">
              An administrator will review your request shortly. You'll be able
              to sign in once your access is approved.
            </p>

            <button
              className="login-provider-btn pending-signout-btn"
              onClick={logout}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
