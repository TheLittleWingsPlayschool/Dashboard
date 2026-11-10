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

async function getTeacher(id: unknown) {
  if (typeof id !== "string") throw new HttpError(400, "Missing teacher id");
  const { data: prof } = await admin.from("profiles").select("id, role").eq("id", id).maybeSingle();
  if (!prof) throw new HttpError(404, "Teacher login not found");
  if (prof.role !== "teacher") throw new HttpError(403, "This action only works on teacher logins.");
  return prof;
}

function authMessage(msg: string) {
  if (/already been registered|already exists/i.test(msg)) return "A login with this email already exists.";
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
      const t = await getTeacher(body.id);
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

    throw new HttpError(400, "Unknown action");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof HttpError ? e.message : "Server error";
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: message }, status);
  }
});
