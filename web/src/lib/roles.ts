/**
 * Helpers for client-side role gating. The server is the source of truth for
 * authorization; these helpers exist to hide/disable UI affordances the
 * current user can't act on.
 */
import type { RoleName, UserDto } from '@web-app-demo/contracts'

export function userRoles(user: UserDto | null | undefined): RoleName[] {
  return user?.roles ?? []
}

export function hasAnyRole(
  user: UserDto | null | undefined,
  ...roles: RoleName[]
): boolean {
  const owned = userRoles(user)
  return roles.some((r) => owned.includes(r))
}

/** True for hr_admin and owner roles (the "admin" tier). */
export function isAdmin(user: UserDto | null | undefined): boolean {
  return hasAnyRole(user, 'hr_admin', 'owner')
}
