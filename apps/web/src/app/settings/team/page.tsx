// SPDX-License-Identifier: AGPL-3.0-only
import { Users, Mail, Clock, X } from "lucide-react";
import { auth } from "@/auth";
import { pool, roleAtLeast } from "@/lib/db";
import { updateRoleAction, removeMemberAction, revokeInviteAction } from "@/app/auth-actions";
import { Card } from "@/components/ui/primitives";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { Select } from "@/components/ui/Select";
import { InviteForm } from "./InviteForm";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export const dynamic = "force-dynamic";

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}
interface Invite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
}

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-gray-900 text-white dark:bg-white dark:text-gray-900",
  admin: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  member: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  viewer: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

function initials(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

export default async function TeamPage() {
  const session = await auth();
  const orgId = (session?.user as { orgId?: string })?.orgId;
  const myEmail = (session?.user as { email?: string })?.email;

  let members: Member[] = [];
  let invites: Invite[] = [];
  let canManage = false;

  if (orgId) {
    const [m, i] = await Promise.all([
      pool.query(
        `SELECT u.id::text AS user_id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1 ORDER BY
           CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
           m.created_at ASC`,
        [orgId]
      ),
      pool.query(
        `SELECT id::text, email, role, created_at, expires_at FROM invitations
         WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [orgId]
      ),
    ]);
    members = m.rows;
    invites = i.rows;
    // DB-verified role (not the JWT) decides whether management controls render.
    const mine = members.find((x) => x.email === myEmail);
    canManage = roleAtLeast(mine?.role, "admin");
  }

  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      {/* Header (inline — this is a Server Component, so we can't pass the icon
          component as a prop to the client-side PageHeader). */}
      <div className="mb-6 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900">
          <Users className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Team</h1>
          <p className="text-sm text-gray-500">Manage who can access your organization and what they can do.</p>
        </div>
      </div>

      {canManage && (
        <div className="mb-6">
          <InviteForm />
        </div>
      )}

      {/* Pending invitations */}
      {canManage && invites.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
            Pending Invitations ({invites.length})
          </h2>
          <Card className="divide-y divide-gray-100 dark:divide-gray-800">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{inv.email}</div>
                  <div className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Clock className="h-3 w-3" />
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[inv.role] || ROLE_BADGE.member}`}>
                  {inv.role}
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="invite_id" value={inv.id} />
                  <ConfirmSubmitButton
                    title="Revoke invitation"
                    confirm={{
                      title: "Revoke invitation?",
                      description: `The invite link for ${inv.email} will stop working immediately.`,
                      confirmText: "Revoke invite",
                      tone: "danger",
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                  >
                    <X className="h-3.5 w-3.5" />
                    Revoke
                  </ConfirmSubmitButton>
                </form>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Members */}
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
        Members ({members.length})
      </h2>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
            <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
              {canManage && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {members.map((m) => {
              const isLastOwner = m.role === "owner" && ownerCount <= 1;
              const isSelf = m.email === myEmail;
              return (
                <tr key={m.user_id} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gray-600 to-gray-800 text-xs font-semibold text-white">
                        {initials(m.name, m.email)}
                      </span>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {m.name || m.email}
                          {isSelf && <span className="ml-1.5 text-[11px] font-normal text-gray-400">(you)</span>}
                        </div>
                        <div className="text-xs text-gray-500">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {canManage && !isLastOwner ? (
                      <form action={updateRoleAction} className="inline-flex items-center gap-2">
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <Select
                          name="role"
                          defaultValue={m.role}
                          options={ROLE_OPTIONS}
                          size="sm"
                          ariaLabel={`Role for ${m.email}`}
                          className="min-w-[120px]"
                        />
                        <button className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
                          Save
                        </button>
                      </form>
                    ) : (
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[m.role] || ROLE_BADGE.member}`}>
                        {m.role}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-gray-500">{new Date(m.created_at).toLocaleDateString()}</td>
                  {canManage && (
                    <td className="px-5 py-3.5 text-right">
                      {!isLastOwner && (
                        <form action={removeMemberAction} className="inline">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <ConfirmSubmitButton
                            confirm={{
                              title: "Remove member?",
                              description: `${m.name || m.email} will immediately lose access to this organization.`,
                              confirmText: "Remove member",
                              tone: "danger",
                            }}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                          >
                            <X className="h-3.5 w-3.5" />
                            Remove
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="px-5 py-10 text-center text-sm text-gray-500">
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
