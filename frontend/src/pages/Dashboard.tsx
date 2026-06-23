import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { getStorage } from '../api/storage';
import type { ClusterInfo } from '../api/storage';
import './Dashboard.css';
import './Drive.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log2(bytes) / 10);
  const clamped = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, clamped)).toFixed(1)} ${units[clamped]}`;
}

function barClass(percent: number): string {
  if (percent >= 90) return 'storage-bar-fill danger';
  if (percent >= 75) return 'storage-bar-fill warn';
  return 'storage-bar-fill';
}

// ── Crystal SVG motif ─────────────────────────────────────────────────────────

function CrystalIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polygon points="4,44 22,8 22,30" fill="var(--color-facet-dark)" />
      <polygon points="22,8 44,36 22,44" fill="var(--color-facet-mid)" />
      <polygon points="22,8 44,20 44,36" fill="var(--color-facet-light)" />
      <line x1="22" y1="8" x2="44" y2="20" stroke="var(--color-accent)" strokeWidth="0.75" strokeLinecap="round" />
    </svg>
  );
}

// ── Storage bar ───────────────────────────────────────────────────────────────

function StorageBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div>
      <div className="storage-bar">
        <div className={barClass(clamped)} style={{ width: `${clamped}%` }} />
      </div>
      <div className="storage-bar-percent">{clamped.toFixed(1)}%</div>
    </div>
  );
}

// ── Cluster status badge ──────────────────────────────────────────────────────

function ClusterBadge({ status }: { status: ClusterInfo['status'] }) {
  const classMap: Record<ClusterInfo['status'], string> = {
    active: 'badge badge-active',
    provisioning: 'badge badge-provisioning',
    full: 'badge badge-full',
    error: 'badge badge-error',
    decommissioned: 'badge badge-decommissioned',
  };
  return <span className={classMap[status]}>{status}</span>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['storage'],
    queryFn: getStorage,
  });

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
      <Sidebar currentSection="dashboard" onNavigate={handleNavigate} />

      <main className="drive-main">
        <header className="drive-header">
          <h1 className="dashboard-page-heading">
            <CrystalIcon size={28} />
            Storage
          </h1>
        </header>

        <div className="drive-body">
          {isLoading && <div className="drive-loading" aria-label="Loading storage" />}

          {isError && (
            <p className="dashboard-empty">
              Failed to load storage data. Check your connection and try again.
            </p>
          )}

          {data && !isLoading && (
            <>
              {/* Admin warning banner when starter cluster near capacity */}
              {isAdmin && data.starter?.nearCapacity && (
                <div className="dashboard-starter-warning">
                  <span className="dashboard-starter-warning-icon" aria-hidden="true">⚠</span>
                  <span>
                    Metadata store is near capacity ({data.starter.usedPercent}% of{' '}
                    {formatBytes(data.starter.capacityBytes)} used).{' '}
                    Consider upgrading the starter cluster.
                  </span>
                </div>
              )}

              {/* Starter cluster usage bar (admin only) */}
              {isAdmin && data.starter && (
                <div className="dashboard-starter-card">
                  <div className="dashboard-starter-header">
                    <span className="dashboard-starter-label">Metadata cluster (starter)</span>
                    <span className="dashboard-starter-bytes">
                      {formatBytes(data.starter.usedBytes)} / {formatBytes(data.starter.capacityBytes)}
                    </span>
                  </div>
                  <StorageBar percent={data.starter.usedPercent} />
                </div>
              )}

              {/* Overall summary */}
              <div className="dashboard-summary">
                <div className="dashboard-summary-crystal">
                  <CrystalIcon size={40} />
                </div>
                <div className="dashboard-summary-info">
                  <div className="dashboard-summary-label">Total storage</div>
                  <div className="dashboard-summary-bytes">
                    {formatBytes(data.totalUsedBytes)} / {formatBytes(data.totalCapacityBytes)}
                  </div>
                  <StorageBar percent={data.usedPercent} />
                </div>
              </div>

              {/* Per-org sections */}
              {data.orgs.length === 0 ? (
                <div className="dashboard-empty">
                  No storage configured.{' '}
                  <Link to="/settings">Add Atlas org keys in Settings.</Link>
                </div>
              ) : (
                <div className="dashboard-org-list">
                  {data.orgs.map((org) => (
                    <div key={org.orgId} className="dashboard-org-card">
                      <div className="dashboard-org-header">
                        <CrystalIcon size={20} />
                        <div className="dashboard-org-header-info">
                          <div className="dashboard-org-title-row">
                            <span className="dashboard-org-label">{org.label}</span>
                            {org.region && (
                              <span className="badge badge-region">{org.region}</span>
                            )}
                            {org.activeProvisioning && (
                              <span className="dashboard-provisioning-indicator">
                                <span className="provisioning-dot" />
                                Provisioning…
                              </span>
                            )}
                          </div>

                          <div className="dashboard-org-usage">
                            <div className="dashboard-org-usage-meta">
                              <span>
                                {formatBytes(org.totalUsedBytes)} / {formatBytes(org.totalCapacityBytes)}
                              </span>
                              <span>{org.clusters.length} cluster{org.clusters.length !== 1 ? 's' : ''}</span>
                            </div>
                            <StorageBar
                              percent={
                                org.totalCapacityBytes > 0
                                  ? (org.totalUsedBytes / org.totalCapacityBytes) * 100
                                  : 0
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* Cluster rows */}
                      {org.clusters.length > 0 && (
                        <div className="dashboard-clusters">
                          {org.clusters.map((cluster) => (
                            <div key={cluster.id}>
                              <div className="dashboard-cluster-row">
                                <span className="dashboard-cluster-id">{cluster.clusterId}</span>
                                <ClusterBadge status={cluster.status} />
                              </div>
                              <div className="dashboard-cluster-bytes">
                                {formatBytes(cluster.storageUsedBytes)} / {formatBytes(cluster.storageCapacityBytes)}
                              </div>
                              <div className="dashboard-cluster-bar-wrap" style={{ marginTop: 'var(--space-1)' }}>
                                <StorageBar percent={cluster.usedPercent} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
