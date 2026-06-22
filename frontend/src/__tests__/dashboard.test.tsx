/**
 * Task 7.8 — Dashboard and Settings tests.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// vi.mock calls are hoisted before imports by vitest, so Dashboard/Settings
// will see the mocked modules when they are imported below.

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      _id: 'u1',
      name: 'Test User',
      email: 'test@x.com',
      role: 'admin',
      encryptionEnabled: true,
    },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockGetStorage = vi.fn();
const mockListOrgs = vi.fn();
const mockAddOrg = vi.fn();
const mockDeleteOrg = vi.fn();
const mockListApiKeys = vi.fn();
const mockCreateApiKey = vi.fn();
const mockDeleteApiKey = vi.fn();

vi.mock('../api/storage', () => ({
  getStorage: (...args: unknown[]) => mockGetStorage(...args),
  listOrgs: (...args: unknown[]) => mockListOrgs(...args),
  addOrg: (...args: unknown[]) => mockAddOrg(...args),
  deleteOrg: (...args: unknown[]) => mockDeleteOrg(...args),
  listApiKeys: (...args: unknown[]) => mockListApiKeys(...args),
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mockDeleteApiKey(...args),
}));

// Static imports — resolved AFTER vi.mock hoisting
import Dashboard from '../pages/Dashboard';
import Settings from '../pages/Settings';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const storageFixture = {
  totalUsedBytes: 5_368_709_120,
  totalCapacityBytes: 10_737_418_240,
  usedPercent: 50,
  orgs: [
    {
      orgId: 'org-abc',
      label: 'Production Org',
      region: 'US_EAST_1',
      clusterCount: 2,
      activeProvisioning: false,
      clusters: [
        {
          id: 'cl-1',
          clusterId: 'cluster-prod-1',
          status: 'active' as const,
          storageUsedBytes: 2_147_483_648,
          storageCapacityBytes: 5_368_709_120,
          usedPercent: 40,
          lastCheckedAt: '2024-06-01T00:00:00Z',
        },
        {
          id: 'cl-2',
          clusterId: 'cluster-prod-2',
          status: 'full' as const,
          storageUsedBytes: 5_368_709_120,
          storageCapacityBytes: 5_368_709_120,
          usedPercent: 100,
          lastCheckedAt: '2024-06-01T00:00:00Z',
        },
      ],
      activeCluster: null,
      totalUsedBytes: 5_368_709_120,
      totalCapacityBytes: 10_737_418_240,
    },
  ],
};

const orgFixture = [
  {
    id: 'o1',
    label: 'My Atlas Org',
    publicKey: 'pub-key-1234',
    orgId: 'org-abc',
    clusterCount: 2,
    region: 'US_EAST_1',
    createdAt: '2024-01-01T00:00:00Z',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDashboard() {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<div>other</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSettings() {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div>other</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests: Dashboard ──────────────────────────────────────────────────────────

describe('Dashboard page', () => {
  beforeEach(() => {
    mockGetStorage.mockResolvedValue(storageFixture);
  });

  it('renders org names from mocked GET /api/storage', async () => {
    renderDashboard();
    expect(await screen.findByText('Production Org')).toBeInTheDocument();
  });

  it('renders region badge for an org', async () => {
    renderDashboard();
    expect(await screen.findByText('US_EAST_1')).toBeInTheDocument();
  });

  it('renders cluster IDs from storage response', async () => {
    renderDashboard();
    expect(await screen.findByText('cluster-prod-1')).toBeInTheDocument();
    expect(await screen.findByText('cluster-prod-2')).toBeInTheDocument();
  });

  it('renders cluster status badges', async () => {
    renderDashboard();
    expect(await screen.findByText('active')).toBeInTheDocument();
    expect(await screen.findByText('full')).toBeInTheDocument();
  });

  it('renders storage usage bars (storage-bar elements present)', async () => {
    const { container } = renderDashboard();
    await screen.findByText('Production Org');
    const bars = container.querySelectorAll('.storage-bar');
    expect(bars.length).toBeGreaterThan(0);
  });

  it('renders empty state when no orgs', async () => {
    mockGetStorage.mockResolvedValue({ ...storageFixture, orgs: [] });
    renderDashboard();
    expect(await screen.findByText(/No storage configured/i)).toBeInTheDocument();
  });
});

// ── Tests: Settings — Add Org ─────────────────────────────────────────────────

describe('Settings page — add-org form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrgs.mockResolvedValue([]);
    mockListApiKeys.mockResolvedValue([]);
    mockAddOrg.mockResolvedValue({
      id: 'o-new',
      label: 'Staging',
      publicKey: 'pk-abc',
      orgId: 'org-xyz',
      clusterCount: 0,
      region: 'EU_WEST_1',
      createdAt: new Date().toISOString(),
    });
  });

  it('renders the add-org form', async () => {
    renderSettings();
    expect(await screen.findByText('Add org')).toBeInTheDocument();
  });

  it('posts to /api/orgs with correct fields on submit', async () => {
    renderSettings();
    await screen.findByText('Add org');

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Staging' } });
    fireEvent.change(screen.getByLabelText('Public key'), { target: { value: 'pk-abc' } });
    fireEvent.change(screen.getByLabelText('Private key'), { target: { value: 'sk-secret' } });
    fireEvent.change(screen.getByLabelText('Region (optional)'), { target: { value: 'EU_WEST_1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add org' }));

    await waitFor(() => {
      expect(mockAddOrg).toHaveBeenCalled();
      const firstCall = mockAddOrg.mock.calls[0][0];
      expect(firstCall).toEqual({
        label: 'Staging',
        publicKey: 'pk-abc',
        privateKey: 'sk-secret',
        region: 'EU_WEST_1',
      });
    });
  });

  it('shows validation error when label is missing', async () => {
    renderSettings();
    await screen.findByText('Add org');

    fireEvent.click(screen.getByRole('button', { name: 'Add org' }));

    expect(await screen.findByText('Label is required.')).toBeInTheDocument();
    expect(mockAddOrg).not.toHaveBeenCalled();
  });

  it('lists existing orgs from API', async () => {
    mockListOrgs.mockResolvedValue(orgFixture);
    renderSettings();
    expect(await screen.findByText('My Atlas Org')).toBeInTheDocument();
  });
});

// ── Tests: Settings — Account section ────────────────────────────────────────

describe('Settings page — Account section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrgs.mockResolvedValue([]);
    mockListApiKeys.mockResolvedValue([]);
  });

  it('shows user name and email in account section', async () => {
    renderSettings();

    const accountBtn = await screen.findByRole('button', { name: 'Account' });
    fireEvent.click(accountBtn);

    // The user name appears in both sidebar and the account section
    const nameEls = await screen.findAllByText('Test User');
    expect(nameEls.length).toBeGreaterThan(0);
    // Email appears in account section (mono class)
    expect(screen.getByText('test@x.com')).toBeInTheDocument();
  });
});
