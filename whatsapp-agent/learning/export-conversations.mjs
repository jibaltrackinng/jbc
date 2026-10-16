#!/usr/bin/env node
// يسحب محادثات واتساب السابقة من Kapso ويحفظها نصاً مُخفى الأرقام،
// لاستخلاص الأسئلة المتكررة وأسلوب الرد منها وكتابتها في knowledge.md.
//
// الاستخدام:
//   KAPSO_API_BASE_URL=https://api.kapso.ai KAPSO_API_KEY=... PHONE_NUMBER_ID=... \
//     node whatsapp-agent/learning/export-conversations.mjs [--max 2000] [--since 2026-01-01]
//
// الناتج: whatsapp-agent/learning/conversations.txt (ممنوع رفعه إلى git لأنه يحتوي بيانات العملاء)

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "conversations.txt");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`المتغير ${name} غير مضبوط.`);
    process.exit(2);
  }
  return v;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const base = need("KAPSO_API_BASE_URL").replace(/\/+$/, "").replace(/\/platform\/v1$/, "");
const apiKey = need("KAPSO_API_KEY");
const phoneNumberId = need("PHONE_NUMBER_ID");
const max = parseInt(arg("max", "2000"), 10);
const since = arg("since");

// إخفاء الأرقام الطويلة (هواتف، رموز سرية، أكواد) والبريد الإلكتروني
function anonymize(text) {
  return String(text || "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[بريد]")
    .replace(/\+?\d[\d\s-]{3,}\d/g, "[رقم]")
    .replace(/\b\d{4}\b/g, "[رقم]");
}

function textOf(m) {
  const k = m.kapso || {};
  if (k.content) return k.content;
  if (m.text && m.text.body) return m.text.body;
  if (m.interactive) return JSON.stringify(m.interactive);
  if (m.type) return `[${m.type}]`;
  return "";
}

async function fetchPage(after) {
  const url = new URL(`${base}/platform/v1/whatsapp/messages`);
  url.searchParams.set("phone_number_id", phoneNumberId);
  url.searchParams.set("limit", "100");
  url.searchParams.set("fields", "kapso(direction,content,contact_name)");
  if (after) url.searchParams.set("after", after);
  if (since) url.searchParams.set("since", since);
  const res = await fetch(url, { headers: { "X-API-Key": apiKey, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const messages = [];
let after;
while (messages.length < max) {
  const page = await fetchPage(after);
  const rows = page.data || page.messages || [];
  messages.push(...rows);
  after =
    (page.paging && page.paging.cursors && page.paging.cursors.after) ||
    (page.meta && (page.meta.next_cursor || page.meta.after)) ||
    page.next_cursor;
  if (!rows.length || !after) break;
}

// تجميع الرسائل حسب المحادثة وترتيبها زمنياً
const byConv = new Map();
for (const m of messages) {
  const k = m.kapso || {};
  const key = m.conversation_id || k.conversation_id || m.from || m.to || "unknown";
  if (!byConv.has(key)) byConv.set(key, []);
  byConv.get(key).push({
    ts: Number(m.timestamp) || Date.parse(m.created_at || "") / 1000 || 0,
    who: (k.direction || m.direction) === "outbound" ? "الشركة" : "العميل",
    text: anonymize(textOf(m)),
  });
}

let out = "";
let n = 0;
for (const msgs of byConv.values()) {
  msgs.sort((a, b) => a.ts - b.ts);
  const lines = msgs.filter((x) => x.text).map((x) => `${x.who}: ${x.text}`);
  if (lines.length < 2) continue;
  n++;
  out += `=== محادثة ${n} ===\n${lines.join("\n")}\n\n`;
}

writeFileSync(OUT, out);
console.log(`تم حفظ ${n} محادثة (${messages.length} رسالة) في ${OUT}`);
