// The Little Wings dashboard: account management Edge Function ("lw-admin").
// Runs on Supabase's servers. The service role key is read from the function's
// built-in environment and is never sent to the browser.
//
// Actions (POST JSON { action, ... }):
//   status                         -> { adminExists }                 (no login needed)
//   bootstrap { name,email,password } -> creates the FIRST admin only (no login needed, works once)
//   create_teacher { name,email,password,classId }                    (admin only)
//   update_teacher { id,name,classId }                                (admin only)
//   reset_password { id,password }                                    (admin only)
//   delete_teacher { id }                                             (admin only)
//   create_parent { name,phone,password,studentIds[] }                (admin only)
//   update_parent { id,name,phone,studentIds[] }                      (admin only)
//   delete_parent { id }                                              (admin only)
//   reset_password also works for parent logins.
// Parent logins: the login ID is the parent's 10-digit mobile number. It is
// stored as the synthetic, never-emailed address <mobile>@parents.littlewings.app
// (auto-confirmed; public sign-ups stay closed).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLASSES = ["toddlers", "nursery", "lkg", "ukg"];
const ALLOWED_ORIGINS = [
  "https://thelittlewingsplayschool.github.io",
];

function corsHeaders(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const emailOk = (e: unknown) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 120;
const pwOk = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 72;
const nameOk = (n: unknown) => typeof n === "string" && n.trim().length >= 2 && n.trim().length <= 60;
const PARENT_DOMAIN = "parents.littlewings.app";
function normPhone(p: unknown): string {
  let d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
const phoneOk = (d: string) => /^[6-9]\d{9}$/.test(d);
const parentEmail = (d: string) => `${d}@${PARENT_DOMAIN}`;

async function cleanStudentIds(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) throw new HttpError(400, "Please choose the child.");
  const list = [...new Set(ids.filter((x) => typeof x === "string" && x.length >= 1 && x.length <= 64))] as string[];
  if (!list.length) throw new HttpError(400, "Please choose at least one child.");
  if (list.length > 6) throw new HttpError(400, "A parent login can be linked to at most 6 children.");
  const { data, error } = await admin.from("students").select("id").in("id", list).eq("deleted", false);
  if (error) throw new HttpError(500, "Could not check the students.");
  if ((data || []).length !== list.length) throw new HttpError(400, "One of the chosen children was not found.");
  return list;
}

async function setLinks(userId: string, studentIds: string[]) {
  const { data: cur, error: rerr } = await admin.from("parent_students").select("student_id").eq("user_id", userId);
  if (rerr) throw new HttpError(500, "Could not read the linked children.");
  const have = (cur || []).map((r: { student_id: string }) => r.student_id);
  const remove = have.filter((x) => !studentIds.includes(x));
  const add = studentIds.filter((x) => !have.includes(x));
  if (remove.length) {
    const { error } = await admin.from("parent_students").delete().eq("user_id", userId).in("student_id", remove);
    if (error) throw new HttpError(500, "Could not update the linked children.");
  }
  if (add.length) {
    const { error } = await admin.from("parent_students").insert(add.map((sid) => ({ user_id: userId, student_id: sid })));
    if (error) throw new HttpError(500, "Could not link the children.");
  }
}

async function adminExists(): Promise<boolean> {
  const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (error) throw new HttpError(500, "Could not check accounts");
  return (count || 0) > 0;
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) throw new HttpError(401, "Please sign in again.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.");
  const { data: prof } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") throw new HttpError(403, "Only the admin can manage logins.");
  return data.user;
}

async function getManaged(id: unknown, roles: string[]) {
  if (typeof id !== "string") throw new HttpError(400, "Missing login id");
  const { data: prof } = await admin.from("profiles").select("id, role, email").eq("id", id).maybeSingle();
  if (!prof) throw new HttpError(404, "Login not found");
  if (!roles.includes(prof.role)) throw new HttpError(403, "This action does not work on this login.");
  return prof;
}
const getTeacher = (id: unknown) => getManaged(id, ["teacher"]);
const getParent = (id: unknown) => getManaged(id, ["parent"]);

function authMessage(msg: string) {
  if (/already been registered|already exists/i.test(msg)) return "A login with this email or mobile number already exists.";
  if (/password/i.test(msg)) return "Password is too weak. Use at least 8 characters.";
  return msg;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "status") return json({ adminExists: await adminExists() });

    if (action === "bootstrap") {
      if (await adminExists()) throw new HttpError(409, "An admin account already exists. Please sign in.");
      if (!nameOk(body.name)) throw new HttpError(400, "Please enter your name.");
      if (!emailOk(body.email)) throw new HttpError(400, "Please enter a valid email.");
      if (!pwOk(body.password)) throw new HttpError(400, "Password must be at least 8 characters.");
      const { data, error } = await admin.auth.admin.createUser({
        email: String(body.email).trim().toLowerCase(),
        password: body.password,
        email_confirm: true,
        app_metadata: { lw_role: "admin", lw_name: String(body.name).trim() },
      });
      if (error) throw new HttpError(400, authMessage(error.message));
      return json({ ok: true, id: data.user?.id });
    }

    await requireAdmin(req);

    if (action === "create_teacher") {
      if (!nameOk(body.name)) throw new HttpError(400, "Please enter the teacher's name.");
      if (!emailOk(body.email)) throw new HttpError(400, "Please enter a valid email.");
      if (!pwOk(body.password)) throw new HttpError(400, "Temporary password must be at least 8 characters.");
      if (!CLASSES.includes(body.classId)) throw new HttpError(400, "Please choose a class.");
      const { data, error } = await admin.auth.admin.createUser({
        email: String(body.email).trim().toLowerCase(),
        password: body.password,
        email_confirm: true,
        app_metadata: { lw_role: "teacher", lw_name: String(body.name).trim(), lw_class: body.classId },
      });
      if (error) throw new HttpError(400, authMessage(error.message));
      return json({ ok: true, id: data.user?.id });
    }

    if (action === "update_teacher") {
      const t = await getTeacher(body.id);
      if (!nameOk(body.name)) throw new HttpError(400, "Please enter the teacher's name.");
      if (!CLASSES.includes(body.classId)) throw new HttpError(400, "Please choose a class.");
      const { error } = await admin.from("profiles").update({ name: String(body.name).trim(), class_id: body.classId }).eq("id", t.id);
      if (error) throw new HttpError(500, "Could not update the teacher.");
      await admin.auth.admin.updateUserById(t.id, { app_metadata: { lw_role: "teacher", lw_name: String(body.name).trim(), lw_class: body.classId } });
      return json({ ok: true });
    }

    if (action === "reset_password") {
      const t = await getManaged(body.id, ["teacher", "parent"]);
      if (!pwOk(body.password)) throw new HttpError(400, "Password must be at least 8 characters.");
      const { error } = await admin.auth.admin.updateUserById(t.id, { password: body.password });
      if (error) throw new HttpError(400, authMessage(error.message));
      return json({ ok: true });
    }

    if (action === "delete_teacher") {
      const t = await getTeacher(body.id);
      const { error } = await admin.auth.admin.deleteUser(t.id);
      if (error) throw new HttpError(500, "Could not remove the login.");
      return json({ ok: true });
    }

    if (action === "create_parent") {
      if (!nameOk(body.name)) throw new HttpError(400, "Please enter the parent's name.");
      const phone = normPhone(body.phone);
      if (!phoneOk(phone)) throw new HttpError(400, "Please enter a valid 10-digit mobile number.");
      if (!pwOk(body.password)) throw new HttpError(400, "Temporary password must be at least 8 characters.");
      const ids = await cleanStudentIds(body.studentIds);
      const name = String(body.name).trim();
      const { data, error } = await admin.auth.admin.createUser({
        email: parentEmail(phone),
        password: body.password,
        email_confirm: true,
        app_metadata: { lw_role: "parent", lw_name: name },
      });
      if (error || !data.user) throw new HttpError(400, error ? authMessage(error.message) : "Could not create the login.");
      try {
        await setLinks(data.user.id, ids);
      } catch (e) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw e;
      }
      return json({ ok: true, id: data.user.id, phone });
    }

    if (action === "update_parent") {
      const p = await getParent(body.id);
      if (!nameOk(body.name)) throw new HttpError(400, "Please enter the parent's name.");
      const ids = await cleanStudentIds(body.studentIds);
      const name = String(body.name).trim();
      const upd: Record<string, unknown> = { app_metadata: { lw_role: "parent", lw_name: name } };
      let email = p.email;
      if (body.phone != null) {
        const phone = normPhone(body.phone);
        if (!phoneOk(phone)) throw new HttpError(400, "Please enter a valid 10-digit mobile number.");
        if (parentEmail(phone) !== p.email) { email = parentEmail(phone); upd.email = email; upd.email_confirm = true; }
      }
      const { error: aerr } = await admin.auth.admin.updateUserById(p.id, upd);
      if (aerr) throw new HttpError(400, authMessage(aerr.message));
      const { error } = await admin.from("profiles").update({ name, email }).eq("id", p.id);
      if (error) throw new HttpError(500, "Could not update the parent.");
      await setLinks(p.id, ids);
      return json({ ok: true });
    }

    if (action === "delete_parent") {
      const p = await getParent(body.id);
      const { error } = await admin.auth.admin.deleteUser(p.id);
      if (error) throw new HttpError(500, "Could not remove the login.");
      return json({ ok: true });
    }

    throw new HttpError(400, "Unknown action");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : "Server error";
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: message }, status);
  }
});
