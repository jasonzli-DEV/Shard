import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import {
  listOrgs,
  addOrg,
  deleteOrg,
  listApiKeys,
  createApiKey,
  deleteApiKey,
} from '../api/storage';
import type { OrgKey, ApiKeyItem } from '../api/storage';
import {
  listUsers,
  approveUser,
  denyUser,
  setUserRole,
  getAccessMode,
  setAccessMode,
  listInvites,
  createInvite,
  deleteInvite,
} from '../api/admin';
import type { AdminUser, Invite } from '../api/admin';
import './Settings.css';
import './Drive.css';

type Category = 'orgs' | 'keys' | 'account' | 'admin';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function truncate(str: string, len = 20): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + '…';
}

// ── Atlas Orgs section ────────────────────────────────────────────────────────

function AtlasOrgsSection() {
  const qc = useQueryClient();
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    label: '',
    publicKey: '',
    privateKey: '',
    region: '',
  });

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: listOrgs,
  });

  const addMutation = useMutation({
    mutationFn: addOrg,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      setForm({ label: '', publicKey: '', privateKey: '', region: '' });
      setFormError('');
    },
    onError: (e: Error) => {
      setFormError(e.message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: deleteOrg,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.label.trim()) { setFormError('Label is required.'); return; }
    if (!form.publicKey.trim()) { setFormError('Public key is required.'); return; }
    if (!form.privateKey.trim()) { setFormError('Private key is required.'); return; }
    addMutation.mutate({
      label: form.label.trim(),
      publicKey: form.publicKey.trim(),
      privateKey: form.privateKey.trim(),
      region: form.region.trim() || undefined,
    });
  }

  return (
    <div>
      <h2 className="settings-section-title">Atlas Org Keys</h2>

      {isLoading && <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</p>}

      {!isLoading && (
        <div className="settings-table-wrap" style={{ marginBottom: 'var(--space-5)' }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Public key</th>
                <th>Org ID</th>
                <th>Region</th>
                <th>Clusters</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-5)' }}>
                    No org keys configured.
                  </td>
                </tr>
              )}
              {orgs.map((org: OrgKey) => (
                <tr key={org.id}>
                  <td style={{ fontWeight: 'var(--weight-medium)' }}>{org.label}</td>
                  <td className="settings-mono">{truncate(org.publicKey)}</td>
                  <td className="settings-mono">{truncate(org.orgId)}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>{org.region ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{org.clusterCount}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>{formatDate(org.createdAt)}</td>
                  <td>
                    <button
                      className="btn-danger"
                      onClick={() => removeMutation.mutate(org.id)}
                      disabled={removeMutation.isPending}
                      type="button"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="settings-form-title">Add org key</div>
        <div className="settings-form-row">
          <div className="settings-field">
            <label className="settings-label" htmlFor="org-label">Label</label>
            <input
              id="org-label"
              className="settings-input"
              type="text"
              placeholder="e.g. Production"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div className="settings-field">
            <label className="settings-label" htmlFor="org-region">Region (optional)</label>
            <input
              id="org-region"
              className="settings-input"
              type="text"
              placeholder="e.g. US_EAST_1"
              value={form.region}
              onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
            />
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="org-public-key">Public key</label>
          <input
            id="org-public-key"
            className="settings-input"
            type="text"
            placeholder="Atlas API public key"
            value={form.publicKey}
            onChange={(e) => setForm((f) => ({ ...f, publicKey: e.target.value }))}
          />
        </div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="org-private-key">Private key</label>
          <input
            id="org-private-key"
            className="settings-input"
            type="password"
            placeholder="Atlas API private key"
            value={form.privateKey}
            onChange={(e) => setForm((f) => ({ ...f, privateKey: e.target.value }))}
          />
        </div>
        {formError && <div className="settings-error">{formError}</div>}
        <button
          className="btn-primary"
          type="submit"
          disabled={addMutation.isPending}
        >
          {addMutation.isPending ? 'Adding…' : 'Add org'}
        </button>
      </form>
    </div>
  );
}

// ── API Keys section ──────────────────────────────────────────────────────────

function ApiKeysSection() {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState('');
  const [newKey, setNewKey] = useState<{ key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const createMutation = useMutation({
    mutationFn: () => createApiKey(label.trim()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      setNewKey({ key: data.key });
      setLabel('');
      setFormError('');
    },
    onError: (e: Error) => {
      setFormError(e.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setNewKey(null);
    if (!label.trim()) { setFormError('Label is required.'); return; }
    createMutation.mutate();
  }

  async function handleCopy() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h2 className="settings-section-title">API Keys</h2>

      {isLoading && <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Loading…</p>}

      {!isLoading && (
        <div className="settings-table-wrap" style={{ marginBottom: 'var(--space-5)' }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Last used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-5)' }}>
                    No API keys yet.
                  </td>
                </tr>
              )}
              {keys.map((k: ApiKeyItem) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 'var(--weight-medium)' }}>{k.label}</td>
                  <td className="settings-mono">{k.keyHint}</td>
                  <td style={{ color: 'var(--color-text-muted)' }}>
                    {k.lastUsed ? formatDate(k.lastUsed) : 'Never'}
                  </td>
                  <td style={{ color: 'var(--color-text-muted)' }}>{formatDate(k.createdAt)}</td>
                  <td>
                    <button
                      className="btn-danger"
                      onClick={() => revokeMutation.mutate(k.id)}
                      disabled={revokeMutation.isPending}
                      type="button"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newKey && (
        <div className="settings-new-key-box" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="settings-new-key-warning">Copy this key now — it won't be shown again.</div>
          <div className="settings-new-key-value">{newKey.key}</div>
          <div className="settings-new-key-actions">
            <button className="btn-copy" onClick={handleCopy} type="button">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <form className="settings-form" onSubmit={handleSubmit}>
        <div className="settings-form-title">Create API key</div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="key-label">Label</label>
          <input
            id="key-label"
            className="settings-input"
            type="text"
            placeholder="e.g. CI/CD pipeline"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {formError && <div className="settings-error">{formError}</div>}
        <button
          className="btn-primary"
          type="submit"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating…' : 'Create key'}
        </button>
      </form>
    </div>
  );
}

// ── Account section ───────────────────────────────────────────────────────────

function AccountSection() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div>
      <h2 className="settings-section-title">Account</h2>
      <div className="settings-account-card">
        <div className="settings-account-row">
          <span className="settings-account-key">Name</span>
          <span className="settings-account-value">{user.name}</span>
        </div>
        <div className="settings-account-row">
          <span className="settings-account-key">Email</span>
          <span className="settings-account-value settings-mono">{user.email}</span>
        </div>
        <div className="settings-account-row">
          <span className="settings-account-key">Role</span>
          <span className={user.role === 'admin' ? 'badge-role-admin' : 'badge-role-user'}>
            {user.role}
          </span>
        </div>
        <div className="settings-account-row">
          <span className="settings-account-key">Encryption</span>
          <span className="settings-account-value">
            {user.encryptionEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div style={{ paddingTop: 'var(--space-2)' }}>
          <button className="btn-secondary" onClick={logout} type="button">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin section ─────────────────────────────────────────────────────────────

function AdminSection() {
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listUsers,
  });

  const { data: accessModeData, isLoading: accessModeLoading } = useQuery({
    queryKey: ['access-mode'],
    queryFn: getAccessMode,
  });

  const { data: invites = [] } = useQuery({
    queryKey: ['admin-invites'],
    queryFn: listInvites,
  });

  const accessModeMutation = useMutation({
    mutationFn: (mode: 'open' | 'approval') => setAccessMode(mode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-mode'] }),
  });

  const approveMutation = useMutation({
    mutationFn: approveUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const denyMutation = useMutation({
    mutationFn: denyUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'user' }) => setUserRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const inviteMutation = useMutation({
    mutationFn: createInvite,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-invites'] });
      setInviteEmail('');
      setInviteError('');
    },
    onError: (e: Error) => setInviteError(e.message),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: deleteInvite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invites'] }),
  });

  const currentMode = accessModeData?.accessMode ?? 'approval';

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    if (!inviteEmail.trim()) { setInviteError('Email is required.'); return; }
    inviteMutation.mutate(inviteEmail.trim());
  }

  return (
    <div>
      <h2 className="settings-section-title">Access Control</h2>

      {/* Access mode toggle */}
      <div className="settings-admin-card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="settings-admin-row">
          <div>
            <div className="settings-admin-label">Access mode</div>
            <div className="settings-admin-desc">
              {currentMode === 'open'
                ? 'Open — anyone who signs in gets immediate access.'
                : 'Approval — new users wait for an admin to approve them.'}
            </div>
          </div>
          <div className="settings-admin-toggle-wrap">
            <button
              className={`settings-toggle-btn ${currentMode === 'open' ? 'active' : ''}`}
              onClick={() => accessModeMutation.mutate('open')}
              disabled={accessModeLoading || accessModeMutation.isPending || currentMode === 'open'}
              type="button"
            >
              Open
            </button>
            <button
              className={`settings-toggle-btn ${currentMode === 'approval' ? 'active' : ''}`}
              onClick={() => accessModeMutation.mutate('approval')}
              disabled={accessModeLoading || accessModeMutation.isPending || currentMode === 'approval'}
              type="button"
            >
              Approval
            </button>
          </div>
        </div>
      </div>

      {/* Users table */}
      <h2 className="settings-section-title">Users</h2>
      <div className="settings-table-wrap" style={{ marginBottom: 'var(--space-6)' }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Provider</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-5)' }}>
                  No users found.
                </td>
              </tr>
            )}
            {users.map((u: AdminUser) => (
              <tr key={u.id}>
                <td className="settings-mono" style={{ fontSize: 'var(--text-sm)' }}>{u.email}</td>
                <td>{u.name}</td>
                <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{u.provider}</td>
                <td>
                  <span className={u.role === 'admin' ? 'badge-role-admin' : 'badge-role-user'}>
                    {u.role}
                  </span>
                </td>
                <td>
                  <span className={u.status === 'active' ? 'badge-status-active' : 'badge-status-pending'}>
                    {u.status}
                  </span>
                </td>
                <td style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {u.status === 'pending' && (
                    <button
                      className="btn-primary"
                      style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
                      onClick={() => approveMutation.mutate(u.id)}
                      disabled={approveMutation.isPending}
                      type="button"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="btn-danger"
                    style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
                    onClick={() => denyMutation.mutate(u.id)}
                    disabled={denyMutation.isPending}
                    type="button"
                  >
                    Deny
                  </button>
                  {u.role === 'user' ? (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
                      onClick={() => roleMutation.mutate({ id: u.id, role: 'admin' })}
                      disabled={roleMutation.isPending}
                      type="button"
                    >
                      Make admin
                    </button>
                  ) : (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}
                      onClick={() => roleMutation.mutate({ id: u.id, role: 'user' })}
                      disabled={roleMutation.isPending}
                      type="button"
                    >
                      Demote
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invites */}
      <h2 className="settings-section-title">Invites</h2>
      <div className="settings-table-wrap" style={{ marginBottom: 'var(--space-4)' }}>
        <table className="settings-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
                  No pending invites.
                </td>
              </tr>
            )}
            {invites.map((inv: Invite) => (
              <tr key={inv.id}>
                <td className="settings-mono">{inv.email}</td>
                <td style={{ color: 'var(--color-text-muted)' }}>
                  {new Date(inv.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td>
                  <button
                    className="btn-danger"
                    onClick={() => deleteInviteMutation.mutate(inv.id)}
                    disabled={deleteInviteMutation.isPending}
                    type="button"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="settings-form" onSubmit={handleInviteSubmit}>
        <div className="settings-form-title">Invite by email</div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="invite-email">Email address</label>
          <input
            id="invite-email"
            className="settings-input"
            type="email"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        {inviteError && <div className="settings-error">{inviteError}</div>}
        <button className="btn-primary" type="submit" disabled={inviteMutation.isPending}>
          {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
        </button>
      </form>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [category, setCategory] = useState<Category>('orgs');

  function handleNavigate(section: string) {
    const routes: Record<string, string> = {
      drive: '/',
      starred: '/starred',
      search: '/search',
      shared: '/shared',
      trash: '/trash',
      dashboard: '/dashboard',
      settings: '/settings',
    };
    navigate(routes[section] ?? '/');
  }

  return (
    <div className="drive-shell">
      <Sidebar currentSection="settings" onNavigate={handleNavigate} />

      <main className="drive-main">
        <header className="drive-header">
          <h1 className="settings-page-heading">Settings</h1>
        </header>

        <div className="drive-body">
          <div className="settings-layout">
            {/* Category sidebar */}
            <nav className="settings-sidebar" aria-label="Settings categories">
              <ul className="settings-nav-list">
                {([
                  ['orgs', 'Atlas Orgs'],
                  ['keys', 'API Keys'],
                  ['account', 'Account'],
                  ...(user?.role === 'admin' ? [['admin', 'Admin'] as [Category, string]] : []),
                ] as [Category, string][]).map(([id, label]) => (
                  <li key={id}>
                    <button
                      className={`settings-nav-item ${category === id ? 'active' : ''}`}
                      onClick={() => setCategory(id)}
                      type="button"
                      aria-current={category === id ? 'page' : undefined}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Content */}
            <div className="settings-content">
              {category === 'orgs' && <AtlasOrgsSection />}
              {category === 'keys' && <ApiKeysSection />}
              {category === 'account' && <AccountSection />}
              {category === 'admin' && user?.role === 'admin' && <AdminSection />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
