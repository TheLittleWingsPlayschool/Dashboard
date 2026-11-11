// The Little Wings: public website enquiry form ("lw-enquiry").
// Runs on Supabase's servers. The school website posts a small JSON form here;
// the function validates it and adds ONE row to public.enquiries with
// source "Website". It can never read or return any data.
//
// Protection
//  * Only POST from the school's own site (Origin check + CORS).
//  * Honeypot field "website" must be empty; the form must have been open at
//    least 3 seconds (field "t" = ms since the form loaded).
//  * Strict validation and length limits; only known fields are stored.
//  * Rate limits: 3 per hour and 6 per day per visitor (hashed IP, never the
//    raw IP), the same mobile at most once per 6 hours, 60 per day overall.
//  * The service role key is read from the function's environment and never
//    leaves the server. The response is always a short { ok } / { error }.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = ["https://thelittlewingsplayschool.github.io"];
const CLASSES: Record<string, string> = { toddlers: "Toddlers", nursery: "Nursery", lkg: "LKG", ukg: "UKG" };
const RELATIONS = ["Father", "Mother", "Guardian"];

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

function originOk(origin: string | null) {
  return !!origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
}
function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": originOk(origin) ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
function normPhone(p: unknown): string {
  let d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function rid() {
  const a = new Uint8Array(9); crypto.getRandomValues(a);
  return "web-" + Date.now().toString(36) + Array.from(a).map((x) => (x % 36).toString(36)).join("");
}
async function countSince(col: string, val: string, ms: number, okOnly = false) {
  let q = db.from("web_enquiry_hits").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - ms).toISOString());
  if (col) q = q.eq(col, val);
  if (okOnly) q = q.eq("ok", true);
  const { count, error } = await q;
  if (error) throw new Error("rate check failed");
  return count || 0;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, 405, { error: "Method not allowed" });
  if (!originOk(origin)) return reply(origin, 403, { error: "Not allowed" });
  const len = Number(req.headers.get("content-length") || "0");
  if (len > 8000) return reply(origin, 413, { error: "Too large" });

  let b: Record<string, unknown>;
  try {
    const txt = await req.text();
    if (txt.length > 8000) return reply(origin, 413, { error: "Too large" });
    b = JSON.parse(txt);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
  } catch {
    return reply(origin, 400, { error: "Invalid form" });
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = (await sha256("lw-enq|" + ip)).slice(0, 40);

  // Honeypot + too-fast submit: pretend success, store nothing.
  const t = Number(b.t);
  if (clean(b.website, 200) !== "" || !(t >= 3000)) {
    await db.from("web_enquiry_hits").insert({ ip_hash: ipHash, ok: false });
    return reply(origin, 200, { ok: true });
  }

  const childName = clean(b.childName, 80);
  const parentName = clean(b.parentName, 80);
  const relation = RELATIONS.includes(String(b.relation)) ? String(b.relation) : "Guardian";
  const phone = normPhone(b.phone);
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dob || "")) ? String(b.dob) : "";
  const classId = CLASSES[String(b.classId || "")] ? String(b.classId) : "";
  const address = clean(b.address, 200);
  const message = clean(b.message, 600);
  const today = istToday();

  if (childName.length < 2) return reply(origin, 400, { error: "Please enter the child's name." });
  if (parentName.length < 2) return reply(origin, 400, { error: "Please enter the parent's name." });
  if (!/^[6-9]\d{9}$/.test(phone)) return reply(origin, 400, { error: "Please enter a valid 10-digit mobile number." });
  if (dob && (dob > today || dob < "2010-01-01")) return reply(origin, 400, { error: "Please check the date of birth." });

  try {
    if (await countSince("ip_hash", ipHash, 3600e3) >= 3 || await countSince("ip_hash", ipHash, 86400e3) >= 6) {
      return reply(origin, 429, { error: "Too many enquiries from this device. Please call or WhatsApp us." });
    }
    if (await countSince("phone", phone, 6 * 3600e3, true) >= 1) {
      await db.from("web_enquiry_hits").insert({ ip_hash: ipHash, phone, ok: false });
      return reply(origin, 200, { ok: true, duplicate: true });
    }
    if (await countSince("", "", 86400e3, true) >= 60) {
      return reply(origin, 429, { error: "We are receiving many enquiries. Please call or WhatsApp us." });
    }
  } catch {
    return reply(origin, 503, { error: "Please try again in a minute." });
  }

  const now = new Date().toISOString();
  const data: Record<string, unknown> = {
    date: today, source: "Website", status: "New", web: true, seen: false,
    childName, dob, relation, parentName, phone, address,
    classWanted: classId ? CLASSES[classId] : "",
    notes: [classId ? "Class asked: " + CLASSES[classId] + "." : "", message ? "Message: " + message : ""].filter(Boolean).join(" "),
    feedback: "", createdAt: now,
  };
  if (relation === "Father") { data.fatherName = parentName; data.fatherPhone = phone; }
  else if (relation === "Mother") { data.motherName = parentName; data.motherPhone = phone; }

  const { error } = await db.from("enquiries").insert({ id: rid(), data });
  if (error) return reply(origin, 500, { error: "Could not send. Please call or WhatsApp us." });
  await db.from("web_enquiry_hits").insert({ ip_hash: ipHash, phone, ok: true });
  // Keep the log small: drop entries older than 30 days.
  await db.from("web_enquiry_hits").delete().lt("created_at", new Date(Date.now() - 30 * 86400e3).toISOString());
  return reply(origin, 200, { ok: true });
});
