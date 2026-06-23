/**
 * Setup wizard — 4-step first-run configuration.
 *
 * Layout: fixed left rail (brand + stepper) + scrollable right panel.
 * Not a centered card. The left rail uses the crystal facet motif from
 * the Login brand panel; the right panel is clean editorial form space.
 *
 * Steps:
 *   1. Starter cluster  — MongoDB URI + live test-connection gate
 *   2. OAuth providers  — Google and/or GitHub (real guidance copy)
 *   3. Site config      — Public URL + allowed origins
 *   4. Finish           — calls configure, redirects to /login
 */
import { useState, useId, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ShardMark from '../components/ShardMark';
import Stepper, { StepDef } from '../components/setup/Stepper';
import Step from '../components/setup/Step';
import { testConnection, configure, ConfigurePayload, getSetupStatus } from '../api/setup';
import '../styles/theme.css';
import './Setup.css';

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  {
    id: 1,
    label: 'Starter cluster',
    sublabel: 'MongoDB URI',
  },
  {
    id: 2,
    label: 'OAuth providers',
    sublabel: 'Google or GitHub',
  },
  {
    id: 3,
    label: 'Site config',
    sublabel: 'URLs & origins',
  },
  {
    id: 4,
    label: 'Finish',
    sublabel: 'Apply & launch',
  },
];

// ── Field component ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <div className="setup-field">
      <label className="setup-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {hint && <p className="setup-field-hint">{hint}</p>}
      {children}
      {error && (
        <p className="setup-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Wizard state ──────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1
  starterUri: string;
  connectionTested: boolean;
  connectionError: string | null;
  testingConnection: boolean;
  // Step 2
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  githubEnabled: boolean;
  githubClientId: string;
  githubClientSecret: string;
  // Step 3
  publicUrl: string;
  allowedOrigins: string;
  // Step 4 / submission
  submitting: boolean;
  submitError: string | null;
  done: boolean;
}

const initialState: WizardState = {
  starterUri: '',
  connectionTested: false,
  connectionError: null,
  testingConnection: false,
  googleEnabled: false,
  googleClientId: '',
  googleClientSecret: '',
  githubEnabled: false,
  githubClientId: '',
  githubClientSecret: '',
  publicUrl: '',
  allowedOrigins: '',
  submitting: false,
  submitError: null,
  done: false,
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Setup() {
  const navigate = useNavigate();
  const [starterFromEnv, setStarterFromEnv] = useState(false);
  // When starterFromEnv=true, start at step 1 (skip starter cluster step)
  const [step, setStep] = useState(0); // 0-indexed (0=starter, 1=oauth, 2=site, 3=finish)
  const [state, setState] = useState<WizardState>(initialState);
  const uid = useId();

  // Fetch setup status to check if starterFromEnv
  useEffect(() => {
    getSetupStatus()
      .then((status) => {
        if (status.starterFromEnv) {
          setStarterFromEnv(true);
          setStep(1); // skip starter step
        }
      })
      .catch(() => {
        // Non-fatal — proceed with normal flow
      });
  }, []);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  // ── Step 1: test connection ───────────────────────────────────────────────

  async function handleTestConnection() {
    if (!state.starterUri.trim()) return;
    update('testingConnection', true);
    update('connectionError', null);
    update('connectionTested', false);
    try {
      const result = await testConnection(state.starterUri.trim());
      if (result.ok) {
        update('connectionTested', true);
      } else {
        update('connectionError', result.error ?? 'Could not reach that URI.');
      }
    } catch {
      update('connectionError', 'Network error — check that Shard is running.');
    } finally {
      update('testingConnection', false);
    }
  }

  // ── Step 2: validation ────────────────────────────────────────────────────

  function step2Valid(): boolean {
    if (state.googleEnabled) {
      if (!state.googleClientId.trim() || !state.googleClientSecret.trim())
        return false;
    }
    if (state.githubEnabled) {
      if (!state.githubClientId.trim() || !state.githubClientSecret.trim())
        return false;
    }
    return state.googleEnabled || state.githubEnabled;
  }

  // ── Step 3: validation ────────────────────────────────────────────────────

  function step3Valid(): boolean {
    return (
      state.publicUrl.trim().startsWith('http') &&
      state.allowedOrigins.trim().length > 0
    );
  }

  // ── Step 4: submit ────────────────────────────────────────────────────────

  async function handleConfigure() {
    update('submitting', true);
    update('submitError', null);
    const payload: ConfigurePayload = {
      publicUrl: state.publicUrl.trim(),
      allowedOrigins: state.allowedOrigins.trim(),
    };
    // Only include starterUri if not already provided via env
    if (!starterFromEnv && state.starterUri.trim()) {
      payload.starterUri = state.starterUri.trim();
    }
    if (state.googleEnabled) {
      payload.google = {
        clientId: state.googleClientId.trim(),
        clientSecret: state.googleClientSecret.trim(),
      };
    }
    if (state.githubEnabled) {
      payload.github = {
        clientId: state.githubClientId.trim(),
        clientSecret: state.githubClientSecret.trim(),
      };
    }
    try {
      await configure(payload);
      update('done', true);
      setTimeout(() => navigate('/login'), 2400);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Configuration failed. Try again.';
      update('submitError', msg);
    } finally {
      update('submitting', false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="setup-shell">
      {/* Left rail ──────────────────────────────────────────────────────── */}
      <aside className="setup-rail">
        <div className="setup-rail-inner">
          <header className="setup-rail-header">
            <ShardMark size={36} />
            <span className="setup-rail-wordmark">Shard</span>
          </header>

          <div className="setup-rail-tagline">
            <p>First-time setup.</p>
            <p>Takes about two minutes.</p>
          </div>

          <Stepper steps={starterFromEnv ? STEPS.slice(1) : STEPS} current={starterFromEnv ? step - 1 : step} />
        </div>
        {/* Decorative facet background (matches Login left panel) */}
        <div className="setup-rail-facet" aria-hidden="true" />
      </aside>

      {/* Right panel ─────────────────────────────────────────────────────── */}
      <main className="setup-panel">
        <div className="setup-panel-inner">
          {/* ── Step 1: Starter cluster ────────────────────────────────── */}
          {step === 0 && (
            <Step
              title="Connect your starter cluster"
              description="Shard stores file metadata and user records in a MongoDB Atlas cluster you control. This is the central hub — every user account, folder, and sharing record lives here."
              actions={
                <button
                  className="setup-btn setup-btn--primary"
                  disabled={!state.connectionTested}
                  onClick={() => setStep(1)}
                >
                  Next: OAuth providers →
                </button>
              }
            >
              <Field
                label="Starter MongoDB URI"
                hint="Use a free Atlas M0 cluster. The URI should start with mongodb+srv:// and include credentials."
                error={state.connectionError ?? undefined}
                htmlFor={`${uid}-uri`}
              >
                <div className="setup-input-row">
                  <input
                    id={`${uid}-uri`}
                    type="text"
                    className={`setup-input setup-input--mono ${state.connectionError ? 'setup-input--error' : ''} ${state.connectionTested ? 'setup-input--ok' : ''}`}
                    placeholder="mongodb+srv://user:password@cluster.mongodb.net/shard"
                    value={state.starterUri}
                    onChange={(e) => {
                      update('starterUri', e.target.value);
                      update('connectionTested', false);
                      update('connectionError', null);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="input-starter-uri"
                  />
                  <button
                    className="setup-btn setup-btn--test"
                    disabled={
                      !state.starterUri.trim() || state.testingConnection
                    }
                    onClick={handleTestConnection}
                    data-testid="btn-test-connection"
                  >
                    {state.testingConnection ? 'Testing…' : 'Test connection'}
                  </button>
                </div>
              </Field>

              {state.connectionTested && (
                <div className="setup-status setup-status--ok" role="status">
                  <span aria-hidden="true">◆</span> Connection verified
                </div>
              )}

              <div className="setup-callout">
                <p className="setup-callout-label">Don't have a cluster yet?</p>
                <p className="setup-callout-body">
                  Create a free M0 cluster at{' '}
                  <a
                    href="https://cloud.mongodb.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    cloud.mongodb.com
                  </a>
                  . Name it anything — "shard-starter" works well. After
                  creating a database user and allowing your IP, paste the
                  connection string above.
                </p>
              </div>
            </Step>
          )}

          {/* ── Step 2: OAuth providers ────────────────────────────────── */}
          {step === 1 && (
            <Step
              title="Sign-in providers"
              description="Shard uses OAuth — you don't store passwords. Enable at least one provider. Users who sign in first become admins automatically."
              actions={
                <>
                  {!starterFromEnv && (
                    <button
                      className="setup-btn setup-btn--ghost"
                      onClick={() => setStep(0)}
                    >
                      ← Back
                    </button>
                  )}
                  <button
                    className="setup-btn setup-btn--primary"
                    disabled={!step2Valid()}
                    onClick={() => setStep(2)}
                  >
                    Next: Site config →
                  </button>
                </>
              }
            >
              {/* Google */}
              <div className="setup-provider-block">
                <label className="setup-provider-toggle">
                  <input
                    type="checkbox"
                    checked={state.googleEnabled}
                    onChange={(e) => update('googleEnabled', e.target.checked)}
                    data-testid="toggle-google"
                  />
                  <span className="setup-provider-name">Google</span>
                </label>

                {state.googleEnabled && (
                  <div className="setup-provider-fields">
                    <div className="setup-callout setup-callout--inline">
                      <p className="setup-callout-label">Where to get these</p>
                      <p className="setup-callout-body">
                        Open the{' '}
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Google Cloud Console → APIs → Credentials
                        </a>
                        . Create an OAuth 2.0 client ID for a "Web application".
                        Set the authorized redirect URI to{' '}
                        <code className="setup-inline-code">
                          {state.publicUrl || 'https://your-domain.com'}
                          /api/auth/google/callback
                        </code>
                        . Your Client ID and Client Secret appear immediately
                        after creation.
                      </p>
                    </div>
                    <Field
                      label="Client ID"
                      htmlFor={`${uid}-gcid`}
                    >
                      <input
                        id={`${uid}-gcid`}
                        type="text"
                        className="setup-input setup-input--mono"
                        placeholder="123456789012-abc…"
                        value={state.googleClientId}
                        onChange={(e) =>
                          update('googleClientId', e.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="input-google-client-id"
                      />
                    </Field>
                    <Field
                      label="Client Secret"
                      htmlFor={`${uid}-gcs`}
                    >
                      <input
                        id={`${uid}-gcs`}
                        type="password"
                        className="setup-input setup-input--mono"
                        placeholder="GOCSPX-…"
                        value={state.googleClientSecret}
                        onChange={(e) =>
                          update('googleClientSecret', e.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="input-google-client-secret"
                      />
                    </Field>
                  </div>
                )}
              </div>

              {/* GitHub */}
              <div className="setup-provider-block">
                <label className="setup-provider-toggle">
                  <input
                    type="checkbox"
                    checked={state.githubEnabled}
                    onChange={(e) => update('githubEnabled', e.target.checked)}
                    data-testid="toggle-github"
                  />
                  <span className="setup-provider-name">GitHub</span>
                </label>

                {state.githubEnabled && (
                  <div className="setup-provider-fields">
                    <div className="setup-callout setup-callout--inline">
                      <p className="setup-callout-label">Where to get these</p>
                      <p className="setup-callout-body">
                        Go to{' '}
                        <a
                          href="https://github.com/settings/developers"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          GitHub → Settings → Developer settings → OAuth Apps
                        </a>
                        . Click "New OAuth App". Set the authorization callback
                        URL to{' '}
                        <code className="setup-inline-code">
                          {state.publicUrl || 'https://your-domain.com'}
                          /api/auth/github/callback
                        </code>
                        . After registering, generate a new client secret —
                        GitHub shows it once.
                      </p>
                    </div>
                    <Field
                      label="Client ID"
                      htmlFor={`${uid}-ghcid`}
                    >
                      <input
                        id={`${uid}-ghcid`}
                        type="text"
                        className="setup-input setup-input--mono"
                        placeholder="Iv1.abc123…"
                        value={state.githubClientId}
                        onChange={(e) =>
                          update('githubClientId', e.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="input-github-client-id"
                      />
                    </Field>
                    <Field
                      label="Client Secret"
                      htmlFor={`${uid}-ghcs`}
                    >
                      <input
                        id={`${uid}-ghcs`}
                        type="password"
                        className="setup-input setup-input--mono"
                        placeholder="abc123def456…"
                        value={state.githubClientSecret}
                        onChange={(e) =>
                          update('githubClientSecret', e.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="input-github-client-secret"
                      />
                    </Field>
                  </div>
                )}
              </div>

              {!state.googleEnabled && !state.githubEnabled && (
                <p className="setup-hint-text" role="note">
                  Enable at least one provider to continue.
                </p>
              )}
            </Step>
          )}

          {/* ── Step 3: Site config ────────────────────────────────────── */}
          {step === 2 && (
            <Step
              title="Site configuration"
              description="Tell Shard where it's hosted. These values configure CORS, OAuth redirect URIs, and the public URL shown in shared file links."
              actions={
                <>
                  <button
                    className="setup-btn setup-btn--ghost"
                    onClick={() => setStep(1)}
                  >
                    ← Back
                  </button>
                  <button
                    className="setup-btn setup-btn--primary"
                    disabled={!step3Valid()}
                    onClick={() => setStep(3)}
                  >
                    Next: Review & apply →
                  </button>
                </>
              }
            >
              <Field
                label="Public URL"
                hint="The base URL visitors use to reach Shard. No trailing slash."
                htmlFor={`${uid}-puburl`}
              >
                <input
                  id={`${uid}-puburl`}
                  type="url"
                  className="setup-input setup-input--mono"
                  placeholder="https://shard.example.com"
                  value={state.publicUrl}
                  onChange={(e) => update('publicUrl', e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="input-public-url"
                />
              </Field>

              <Field
                label="Allowed origins"
                hint="Comma-separated list of origins that can call the API. Usually the same as Public URL. Needed for CORS."
                htmlFor={`${uid}-origins`}
              >
                <input
                  id={`${uid}-origins`}
                  type="text"
                  className="setup-input setup-input--mono"
                  placeholder="https://shard.example.com,http://localhost:5173"
                  value={state.allowedOrigins}
                  onChange={(e) => update('allowedOrigins', e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="input-allowed-origins"
                />
              </Field>

              <div className="setup-callout">
                <p className="setup-callout-label">Running locally?</p>
                <p className="setup-callout-body">
                  If you're testing on your own machine, set Public URL to{' '}
                  <code className="setup-inline-code">http://localhost:4000</code>{' '}
                  and Allowed origins to{' '}
                  <code className="setup-inline-code">http://localhost:5173</code>
                  . You can update these values later by editing the{' '}
                  <code className="setup-inline-code">.env</code> file at the
                  project root.
                </p>
              </div>
            </Step>
          )}

          {/* ── Step 4: Finish ─────────────────────────────────────────── */}
          {step === 3 && (
            <Step
              title="Review and apply"
              description="Everything looks good. Applying writes a .env file at the project root and updates the running process immediately — no restart required."
              actions={
                !state.done ? (
                  <>
                    <button
                      className="setup-btn setup-btn--ghost"
                      onClick={() => setStep(2)}
                      disabled={state.submitting}
                    >
                      ← Back
                    </button>
                    <button
                      className="setup-btn setup-btn--primary"
                      disabled={state.submitting}
                      onClick={handleConfigure}
                      data-testid="btn-configure"
                    >
                      {state.submitting ? 'Applying…' : 'Apply configuration'}
                    </button>
                  </>
                ) : (
                  <span className="setup-done-note">
                    Redirecting to sign in…
                  </span>
                )
              }
            >
              {state.done ? (
                <div className="setup-done" role="status" data-testid="setup-done">
                  <div className="setup-done-mark" aria-hidden="true">
                    <ShardMark size={48} />
                  </div>
                  <p className="setup-done-title">Setup complete</p>
                  <p className="setup-done-body">
                    Your Shard instance is configured. Taking you to sign in.
                  </p>
                </div>
              ) : (
                <>
                  <div className="setup-review">
                    <ReviewRow label="Starter URI" value={maskUri(state.starterUri)} mono />
                    {state.googleEnabled && (
                      <ReviewRow label="Google" value={`${state.googleClientId}`} mono />
                    )}
                    {state.githubEnabled && (
                      <ReviewRow label="GitHub" value={`${state.githubClientId}`} mono />
                    )}
                    <ReviewRow label="Public URL" value={state.publicUrl} mono />
                    <ReviewRow label="Allowed origins" value={state.allowedOrigins} mono />
                    <ReviewRow label="JWT secret" value="Auto-generated" />
                  </div>

                  {state.submitError && (
                    <div className="setup-status setup-status--error" role="alert">
                      {state.submitError}
                    </div>
                  )}
                </>
              )}
            </Step>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="setup-review-row">
      <span className="setup-review-label">{label}</span>
      <span className={`setup-review-value ${mono ? 'setup-review-value--mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/** Mask the password portion of a mongodb URI for display */
function maskUri(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.password) {
      u.password = '•'.repeat(Math.min(u.password.length, 8));
    }
    return u.toString();
  } catch {
    return uri;
  }
}
