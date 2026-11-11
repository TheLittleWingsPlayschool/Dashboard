// The Little Wings: Web Push alerts for the Parents app ("lw-push").
// Runs on Supabase's servers. Secrets (VAPID_PRIVATE_KEY, service role key)
// come from the function environment only and are never sent to parents,
// teachers or stored in the database / repository.
//
// Required Edge Function secrets (set once in Supabase > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 public key
//   VAPID_PRIVATE_KEY  base64url, 32-byte private scalar
//   VAPID_SUBJECT      optional, e.g. mailto:school@example.com
//
// Actions (POST JSON { action, ... }, signed-in users only):
//   config                          -> { configured, publicKey }       (any signed-in user)
//   generate_keys                   -> { publicKey, privateKey }       (admin only; shown ONCE in the
//                                      admin's browser to paste into the secrets; nothing is stored)
//   test                            -> sends a test alert to the caller's own devices (1 per minute)
//   notify { kind, ref | day,classId }                                 (admin / teacher)
//     kind = notice  ref = notice id             parents of the notice audience
//     kind = post    ref = class_posts id         parents of that class (homework / learned / meal)
//     kind = absent  day, classId                 parents of children marked "A" that day (today only)
//     kind = fee     ref = student id             that child's parents (admin, only if fees are shown)
//     kind = album   ref = album id               whole school or that class (admin)
//   Every alert is de-duplicated through public.push_log (kind, ref), so a
//   re-save never alerts parents twice.
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKeys, sendPush, type Sub } from "./webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim();
const VAPID_PRIVATE = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
const VAPID_SUBJECT = (Deno.env.get("VAPID_SUBJECT") || "mailto:thelittlewingsplayschool@gmail.com").trim();
const CONFIGURED = /^[A-Za-z0-9_-]{86,88}$/.test(VAPID_PUBLIC) && /^[A-Za-z0-9_-]{42,44}$/.test(VAPID_PRIVATE);
const CLASSES = ["toddlers", "nursery", "lkg", "ukg"];
const ALLOWED_ORIGINS = ["https://thelittlewingsplayschool.github.io"];

function corsHeaders(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

type Lang = "en" | "te" | "hi";
const T: Record<string, Record<Lang, string>> = {
  notice: { en: "New notice", te: "కొత్త నోటీసు", hi: "नई सूचना" },
  Homework: { en: "New homework", te: "కొత్త హోంవర్క్", hi: "नया गृहकार्य" },
  Learned: { en: "Today we learned", te: "ఈరోజు మేము నేర్చుకున్నది", hi: "आज हमने सीखा" },
  Meal: { en: "Meal update", te: "భోజనం వివరాలు", hi: "भोजन की जानकारी" },
  absentT: { en: "Attendance", te: "హాజరు", hi: "उपस्थिति" },
  absentB: { en: "{n} was marked absent today.", te: "{n} ఈరోజు గైర్హాజరు అని నమోదైంది.", hi: "{n} को आज अनुपस्थित दर्ज किया गया है।" },
  feeT: { en: "Fee reminder", te: "ఫీజు గుర్తు", hi: "फीस अनुस्मारक" },
  feeB: { en: "Fees for {n} are pending. Open the app for details.", te: "{n} ఫీజు బకాయి ఉంది. వివరాల కోసం యాప్ తెరవండి.", hi: "{n} की फीस बाकी है। विवरण के लिए ऐप खोलें।" },
  album: { en: "New photos", te: "కొత్త ఫోటోలు", hi: "नई तस्वीरें" },
  testT: { en: "Alerts are on", te: "అలర్ట్‌లు ఆన్ అయ్యాయి", hi: "अलर्ट चालू हैं" },
  testB: { en: "You will get school alerts on this phone.", te: "ఈ ఫోన్‌లో పాఠశాల అలర్ట్‌లు వస్తాయి.", hi: "इस फ़ोन पर स्कूल के अलर्ट मिलेंगे।" },
};
const tr = (k: string, l: Lang, n = "") => (T[k]?.[l] || T[k]?.en || k).replace("{n}", n);
const cut = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const istDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

type Msg = (lang: Lang) => { title: string; body: string; tab: string; tag: string };
type Caller = { id: string; role: string; classId: string | null };

async function caller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Please sign in again.");
  const { data: prof } = await admin.from("profiles").select("role, class_id").eq("id", data.user.id).maybeSingle();
  if (!prof) throw new HttpError(403, "This login is not set up.");
  return { id: data.user.id, role: prof.role, classId: prof.class_id };
}

// Parent user ids linked to (non-deleted) students matching the filter.
async function parentsOf(opts: { classId?: string | null; studentIds?: string[] }): Promise<string[]> {
  let q = admin.from("students").select("id").eq("deleted", false);
  if (opts.studentIds) q = q.in("id", opts.studentIds);
  if (opts.classId) q = q.eq("class_id", opts.classId);
  const { data: st, error } = await q.limit(2000);
  if (error) throw new HttpError(500, "Could not read students.");
  const ids = (st || []).map((r: { id: string }) => r.id);
  if (!ids.length) return [];
  const { data: links, error: e2 } = await admin.from("parent_students").select("user_id").in("student_id", ids);
  if (e2) throw new HttpError(500, "Could not read parent links.");
  return [...new Set((links || []).map((r: { user_id: string }) => r.user_id))];
}

// Claim (kind, ref) in push_log. Returns the row id, or null if it was already sent.
async function claim(kind: string, ref: string, by: string): Promise<number | null> {
  const { data, error } = await admin.from("push_log").upsert({ kind, ref, created_by: by }, { onConflict: "kind,ref", ignoreDuplicates: true }).select("id");
  if (error) throw new HttpError(500, "Could not record the alert.");
  return data && data.length ? data[0].id : null;
}

async function deliver(userIds: string[], msg: Msg, logId: number | null): Promise<{ sent: number; failed: number; devices: number }> {
  let sent = 0, failed = 0;
  if (!userIds.length) return { sent, failed, devices: 0 };
  const { data: subs, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, lang, fails").in("user_id", userIds).limit(5000);
  if (error) throw new HttpError(500, "Could not read devices.");
  const list = (subs || []) as (Sub & { id: string; lang: Lang; fails: number })[];
  const vapid = { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE, subject: VAPID_SUBJECT };
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async (s) => {
      const m = msg(s.lang || "en");
      let status = 0;
      try { status = await sendPush(s, { title: m.title, body: m.body, tab: m.tab, tag: m.tag }, vapid); } catch (_e) { status = 0; }
      if (status >= 200 && status < 300) {
        sent++;
        await admin.from("push_subscriptions").update({ last_ok: new Date().toISOString(), fails: 0 }).eq("id", s.id);
      } else {
        failed++;
        if (status === 404 || status === 410 || s.fails >= 9) await admin.from("push_subscriptions").delete().eq("id", s.id);
        else await admin.from("push_subscriptions").update({ fails: s.fails + 1 }).eq("id", s.id);
      }
    }));
  }
  if (logId) await admin.from("push_log").update({ sent, failed }).eq("id", logId);
  return { sent, failed, devices: list.length };
}

async function notify(c: Caller, body: Record<string, unknown>) {
  if (c.role !== "admin" && c.role !== "teacher") throw new HttpError(403, "Only staff can send alerts.");
  const isAdmin = c.role === "admin";
  const kind = String(body.kind || "");
  const ref = String(body.ref || "").slice(0, 140);
  if (!CONFIGURED) return { ok: true, configured: false, sent: 0 };

  if (kind === "notice") {
    const { data: n } = await admin.from("notices").select("id, title, body, audience, created_by, created_at").eq("id", ref).maybeSingle();
    if (!n) throw new HttpError(404, "Notice not found.");
    if (!isAdmin && n.created_by !== c.id) throw new HttpError(403, "Not your notice.");
    if (Date.now() - Date.parse(n.created_at) > 2 * 864e5) return { ok: true, skipped: "old" };
    const id = await claim("notice", n.id, c.id); if (!id) return { ok: true, duplicate: true };
    const users = await parentsOf({ classId: n.audience === "all" ? null : n.audience });
    const r = await deliver(users, (l) => ({ title: "📢 " + cut(n.title, 80), body: cut(n.body, 160) || tr("notice", l), tab: "notices", tag: "notice-" + n.id }), id);
    return { ok: true, ...r };
  }
  if (kind === "post") {
    const { data: p } = await admin.from("class_posts").select("id, class_id, data, deleted").eq("id", ref).maybeSingle();
    if (!p || p.deleted) throw new HttpError(404, "Post not found.");
    if (!isAdmin && p.class_id !== c.classId) throw new HttpError(403, "Not your class.");
    if (String(p.data?.date || "") < istDay(-1)) return { ok: true, skipped: "old" };
    const id = await claim("post", p.id, c.id); if (!id) return { ok: true, duplicate: true };
    const k = ["Homework", "Learned", "Meal"].includes(p.data?.kind) ? p.data.kind : "Homework";
    const users = await parentsOf({ classId: p.class_id });
    const r = await deliver(users, (l) => ({ title: tr(k, l), body: cut(p.data?.title || p.data?.text, 160), tab: "updates", tag: "post-" + p.id }), id);
    return { ok: true, ...r };
  }
  if (kind === "absent") {
    const day = String(body.day || ""), classId = String(body.classId || "");
    if (!CLASSES.includes(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "Bad class or day.");
    if (!isAdmin && classId !== c.classId) throw new HttpError(403, "Not your class.");
    if (day !== istDay(0)) return { ok: true, skipped: "not today" };
    const { data: a } = await admin.from("attendance").select("data, deleted").eq("day", day).eq("class_id", classId).maybeSingle();
    if (!a || a.deleted) return { ok: true, sent: 0 };
    const absent = Object.entries(a.data || {}).filter(([, v]) => v === "A").map(([k]) => k).slice(0, 200);
    if (!absent.length) return { ok: true, sent: 0 };
    const { data: st } = await admin.from("students").select("id, data").in("id", absent).eq("class_id", classId).eq("deleted", false);
    let sent = 0, failed = 0;
    for (const s of st || []) {
      const id = await claim("absent", day + "|" + s.id, c.id); if (!id) continue;
      const name = cut(s.data?.name || "Your child", 40);
      const r = await deliver(await parentsOf({ studentIds: [s.id] }), (l) => ({ title: tr("absentT", l), body: tr("absentB", l, name), tab: "attendance", tag: "absent-" + day + "-" + s.id }), id);
      sent += r.sent; failed += r.failed;
    }
    return { ok: true, sent, failed };
  }
  if (kind === "fee") {
    if (!isAdmin) throw new HttpError(403, "Only the admin can send fee reminders.");
    const { data: set } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    if (set?.data?.showFeesToParents !== true) return { ok: true, skipped: "fees hidden from parents" };
    const { data: s } = await admin.from("students").select("id, data").eq("id", ref).eq("deleted", false).maybeSingle();
    if (!s) throw new HttpError(404, "Student not found.");
    const id = await claim("fee", s.id + "|" + istDay(0), c.id); if (!id) return { ok: true, duplicate: true };
    const name = cut(s.data?.name || "your child", 40);
    const r = await deliver(await parentsOf({ studentIds: [s.id] }), (l) => ({ title: tr("feeT", l), body: tr("feeB", l, name), tab: "fees", tag: "fee-" + s.id }), id);
    return { ok: true, ...r };
  }
  if (kind === "album") {
    if (!isAdmin) throw new HttpError(403, "Only the admin can post albums.");
    const { data: al } = await admin.from("albums").select("id, class_id, data, deleted").eq("id", ref).maybeSingle();
    if (!al || al.deleted) throw new HttpError(404, "Album not found.");
    if (!Array.isArray(al.data?.items) || !al.data.items.length) return { ok: true, skipped: "empty album" };
    const id = await claim("album", al.id, c.id); if (!id) return { ok: true, duplicate: true };
    const users = await parentsOf({ classId: al.class_id });
    const r = await deliver(users, (l) => ({ title: tr("album", l), body: cut(al.data?.title, 120), tab: "gallery", tag: "album-" + al.id }), id);
    return { ok: true, ...r };
  }
  throw new HttpError(400, "Unknown alert type.");
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const c = await caller(req);
    switch (body.action) {
      case "config":
        return json({ configured: CONFIGURED, publicKey: CONFIGURED ? VAPID_PUBLIC : null });
      case "generate_keys": {
        if (c.role !== "admin") throw new HttpError(403, "Only the admin can do this.");
        const k = await generateVapidKeys();
        return json({ ...k, note: "Copy these into Supabase > Edge Functions > Secrets now. They are not stored anywhere." });
      }
      case "test": {
        if (!CONFIGURED) return json({ ok: true, configured: false, sent: 0 });
        const id = await claim("test", c.id + "|" + new Date().toISOString().slice(0, 16), c.id);
        if (!id) throw new HttpError(429, "Please wait a minute before sending another test.");
        const r = await deliver([c.id], (l) => ({ title: tr("testT", l), body: tr("testB", l), tab: "home", tag: "test" }), id);
        return json({ ok: true, ...r });
      }
      case "notify":
        return json(await notify(c, body));
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof HttpError ? e.message : "Something went wrong.";
    if (!(e instanceof HttpError)) console.error("lw-push", e instanceof Error ? e.message : "error");
    return json({ error: msg }, status);
  }
});
