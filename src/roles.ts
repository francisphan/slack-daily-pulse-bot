import { getDb } from './db';

export type Role = 'admin' | 'manager';
export type UserRole = Role | 'none';

export function isAdmin(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM roles WHERE slack_id = ? AND role = 'admin'")
    .get(userId);
  return !!row;
}

export function isManager(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM roles WHERE slack_id = ? AND role = 'manager'")
    .get(userId);
  return !!row;
}

export function hasAnyRole(userId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM roles WHERE slack_id = ?')
    .get(userId);
  return !!row;
}

export function getUserRole(userId: string): UserRole {
  if (isAdmin(userId)) return 'admin';
  if (isManager(userId)) return 'manager';
  return 'none';
}

export function addRole(userId: string, role: Role, addedBy: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO roles (slack_id, role, added_by) VALUES (?, ?, ?)')
    .run(userId, role, addedBy);
  return result.changes > 0;
}

export function removeRole(userId: string, role: Role): boolean {
  const result = getDb()
    .prepare('DELETE FROM roles WHERE slack_id = ? AND role = ?')
    .run(userId, role);
  return result.changes > 0;
}

export function listByRole(role: Role): { slack_id: string; added_by: string; added_at: string }[] {
  return getDb()
    .prepare('SELECT slack_id, added_by, added_at FROM roles WHERE role = ? ORDER BY added_at')
    .all(role) as { slack_id: string; added_by: string; added_at: string }[];
}

export function adminCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as cnt FROM roles WHERE role = 'admin'")
    .get() as { cnt: number };
  return row.cnt;
}
