export const USER_ROLES = ['admin', 'accounting', 'staff', 'cashier'];

export function isKnownUserRole(role) {
  return USER_ROLES.includes(role);
}

export function isAdminRole(role) {
  return role === 'admin';
}

export function isAccountingRole(role) {
  return role === 'admin' || role === 'accounting';
}

export function normalizeUserRole(role, fallback = 'staff') {
  return isKnownUserRole(role) ? role : fallback;
}
