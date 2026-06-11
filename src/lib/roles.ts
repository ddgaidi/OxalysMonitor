export const DB_MEMBER_ROLES = [
  "etudiant",
  "professeur",
  "technicien",
  "administrateur",
] as const;

export type DbMembreRole = (typeof DB_MEMBER_ROLES)[number];
export type MonitorRole = "student" | "professor" | "technician" | "admin";

export type MonitorMember = {
  id: string;
  auth_id?: string | null;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  role: string | null;
  fablab_ref: string | null;
  fablab_id?: string | null;
};

export function normalizeMemberRole(role: string | null | undefined): MonitorRole {
  switch (role) {
    case "administrateur":
    case "admin":
      return "admin";
    case "technicien":
    case "technician":
      return "technician";
    case "professeur":
    case "professor":
      return "professor";
    case "etudiant":
    case "student":
    default:
      return "student";
  }
}

export function dbRoleFromValue(role: string | null | undefined): DbMembreRole | null {
  switch (role) {
    case "administrateur":
    case "admin":
      return "administrateur";
    case "technicien":
    case "technician":
      return "technicien";
    case "professeur":
    case "professor":
      return "professeur";
    case "etudiant":
    case "student":
      return "etudiant";
    default:
      return null;
  }
}

export function roleFromMember(member: MonitorMember): MonitorRole {
  return normalizeMemberRole(member.role);
}

export function canUseMonitor(role: MonitorRole) {
  return role === "technician" || role === "professor" || role === "admin";
}

export function memberFablabId(member: MonitorMember) {
  return member.fablab_ref ?? member.fablab_id ?? null;
}

export function canAccessFablab(role: MonitorRole, associatedFablabId: string | null, requestedFablabId?: string | null) {
  if (role === "admin") return true;
  if (!canUseMonitor(role)) return false;
  if (!requestedFablabId) return associatedFablabId != null;
  return associatedFablabId === requestedFablabId;
}
