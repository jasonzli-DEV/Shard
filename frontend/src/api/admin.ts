import client from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  provider: string;
  role: 'admin' | 'user';
  status: 'active' | 'pending';
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  createdBy: string;
  createdAt: string;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await client.get<AdminUser[]>('/admin/users');
  return data;
}

export async function approveUser(id: string): Promise<{ id: string; status: string }> {
  const { data } = await client.post(`/admin/users/${id}/approve`);
  return data;
}

export async function denyUser(id: string): Promise<void> {
  await client.post(`/admin/users/${id}/deny`);
}

export async function setUserRole(id: string, role: 'admin' | 'user'): Promise<void> {
  await client.post(`/admin/users/${id}/role`, { role });
}

// ── Access mode ───────────────────────────────────────────────────────────────

export async function getAccessMode(): Promise<{ accessMode: 'open' | 'approval' }> {
  const { data } = await client.get('/admin/access-mode');
  return data;
}

export async function setAccessMode(accessMode: 'open' | 'approval'): Promise<void> {
  await client.put('/admin/access-mode', { accessMode });
}

// ── Invites ───────────────────────────────────────────────────────────────────

export async function listInvites(): Promise<Invite[]> {
  const { data } = await client.get<Invite[]>('/admin/invites');
  return data;
}

export async function createInvite(email: string): Promise<Invite> {
  const { data } = await client.post<Invite>('/admin/invites', { email });
  return data;
}

export async function deleteInvite(id: string): Promise<void> {
  await client.delete(`/admin/invites/${id}`);
}
