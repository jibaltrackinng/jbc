// أداة تتبع الشحنات لوكيل واتساب (Kapso Function - Cloudflare runtime)
// تستقبل كود العميل والرمز السري من الوكيل، وتتحقق منهما عبر نفس خادم Google Apps Script
// الذي يستخدمه الموقع، ثم تُعيد ملخصاً مختصراً للشحنات وتُبطل جلسة الدخول فوراً.
//
// الأسرار المطلوبة في إعدادات الدالة على Kapso:
//   TOOL_SECRET  - قيمة سرية يرسلها الوكيل في الترويسة X-JBC-Tool-Secret
//   SCRIPT_URL   - (اختياري) رابط Apps Script، الافتراضي هو رابط الموقع الحالي

async function handler(request, env) {
  const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby-vXVT6B6t5gNbDMvTatOWJDhCRta5Uxvsqrc7cDqCTfUOwuAlLG4je7IU9FuBCjQ2ow/exec";

  function reply(status, body) {
    return new Response(JSON.stringify(body), {
      status: status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  if (!env.TOOL_SECRET || request.headers.get("X-JBC-Tool-Secret") !== env.TOOL_SECRET) {
    return reply(401, { ok: false, message: "unauthorized" });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return reply(400, { ok: false, message: "طلب غير صالح." });
  }

  const code = String(body.client_code || "").trim();
  const pin = String(body.pin || "").trim();

  // نفس قواعد التحقق المستخدمة في الموقع
  if (!/^[A-Za-z0-9_\-]{1,30}$/.test(code) || !/^\d{4}$/.test(pin)) {
    return reply(200, { ok: false, message: "كود العميل أو الرمز السري غير صحيح." });
  }

  // حد بسيط للمحاولات الفاشلة لكل كود عميل لمنع تخمين الرمز السري
  const failKey = "fail:" + code;
  const now = Date.now();
  let failState = { n: 0, t: now };
  if (env.KV) {
    try {
      const saved = JSON.parse((await env.KV.get(failKey)) || "null");
      if (saved && now - saved.t < 3600000) failState = saved;
    } catch (e) {}
  }
  const fails = failState.n;
  if (fails >= 5) {
    return reply(200, {
      ok: false,
      locked: true,
      message: "تم إيقاف المحاولات مؤقتاً لهذا الكود بسبب تكرار الأخطاء. يرجى المحاولة بعد ساعة أو التواصل مع الموظف."
    });
  }

  const scriptUrl = env.SCRIPT_URL || DEFAULT_SCRIPT_URL;
  let result;
  try {
    const res = await fetch(scriptUrl + "?" + new URLSearchParams({ login: code, pin: pin, remember: "0" }).toString(), {
      redirect: "follow"
    });
    result = await res.json();
  } catch (e) {
    return reply(200, { ok: false, message: "تعذر الاتصال بنظام التتبع حالياً. يرجى المحاولة لاحقاً." });
  }

  if (!result || result.status !== "success" || !result.client) {
    if (env.KV) {
      await env.KV.put(failKey, JSON.stringify({ n: fails + 1, t: fails === 0 ? now : failState.t }));
    }
    return reply(200, { ok: false, message: "كود العميل أو الرمز السري غير صحيح." });
  }

  if (env.KV && fails > 0) {
    await env.KV.delete(failKey);
  }

  // إبطال جلسة الدخول فوراً، فالوكيل لا يحتاج إلى جلسة مستمرة
  if (result.token) {
    try {
      await fetch(scriptUrl + "?" + new URLSearchParams({ logout: result.client.code, token: result.token }).toString(), {
        redirect: "follow"
      });
    } catch (e) {
      // الجلسة تنتهي تلقائياً على الخادم، لا داعي لإفشال الطلب
    }
  }

  const shipments = (result.shipments || []).map(function (s) {
    return {
      ref: s.ref,
      status: s.status,
      method: s.method,
      destination: s.destination,
      material: s.material,
      ctn: s.ctn,
      kg: s.kg,
      cbm: s.cbm,
      receiveDate: s.receiveDate,
      expectedArrivalDate: s.expectedArrivalDate
    };
  });

  return reply(200, {
    ok: true,
    client_name: result.client.name || "",
    client_code: result.client.code,
    shipments_count: shipments.length,
    shipments: shipments
  });
}
