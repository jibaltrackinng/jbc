# وكيل واتساب لجبال البصرة (JBC)

وكيل ذكاء اصطناعي يعمل على Kapso ويرد على رسائل واتساب نيابة عن الشركة. يقوم بما يلي:

- يجيب عن أسئلة الخدمات: الشحن البحري والجوي، والتجهيز، والتحويلات، والنقل الداخلي، والفحص.
- يتتبع شحنات العميل بعد التحقق من **كود العميل والرمز السري**، وهما نفس بيانات الدخول في الموقع.
- يحوّل المحادثة إلى موظف عند طلب الأسعار، أو عند الشكاوى، أو فتح حساب، أو نسيان الرمز.

## الملفات

| الملف | الوظيفة |
|---|---|
| `workflow/system-prompt.md` | تعليمات الوكيل وشخصيته ومعلومات الشركة. **عدّلها هنا** |
| `functions/jbc-track-shipments.js` | دالة Kapso تتحقق من العميل عبر Google Apps Script، ثم ترجع الشحنات وتُبطل الجلسة فوراً. فيها حد 5 محاولات خاطئة في الساعة لكل كود |
| `deploy.mjs` | يبني سير العمل ويتحقق منه، ثم ينشره على Kapso |

## خطوات التشغيل

1. اربط رقم واتساب الشركة بـ Kapso من لوحة التحكم (app.kapso.ai). يمكنك الاستعانة بمهارة `integrate-whatsapp`.
2. أنشئ مفتاح API من لوحة Kapso، ثم:
   ```bash
   export KAPSO_API_BASE_URL=https://api.kapso.ai
   export KAPSO_API_KEY=...
   cd .claude/skills/automate-whatsapp && npm i && cd -
   node .claude/skills/automate-whatsapp/scripts/list-provider-models.js       # اختر PROVIDER_MODEL_ID
   node .claude/skills/automate-whatsapp/scripts/list-whatsapp-phone-numbers.js # اختر PHONE_NUMBER_ID
   ```
3. اختر قيمة سرية طويلة وعشوائية، ثم انشر:
   ```bash
   export PROVIDER_MODEL_ID=... PHONE_NUMBER_ID=... TOOL_SECRET=$(openssl rand -hex 24)
   node whatsapp-agent/deploy.mjs deploy
   ```
4. في لوحة Kapso افتح الدالة `jbc-track-shipments`، وأضف السر `TOOL_SECRET` بنفس القيمة، ثم أعد نشرها.
5. فعّل سير العمل `JBC WhatsApp Agent`، ثم أرسل رسالة تجريبية إلى رقم الشركة.

لتعديل تعليمات الوكيل لاحقاً: عدّل `system-prompt.md`، ثم شغّل `node whatsapp-agent/deploy.mjs build` مع نفس المتغيرات، وارفع الملف الناتج بـ `update-graph.js`.

## التعلم من المحادثات السابقة

1. اسحب المحادثات المخزنة في Kapso. يُخفي السكربت الأرقام والبريد الإلكتروني تلقائياً:
   ```bash
   node whatsapp-agent/learning/export-conversations.mjs --max 2000
   ```
   الناتج يُحفظ في `learning/conversations.txt`، ولا يُرفع إلى git لأنه يحتوي بيانات عملاء.
2. استخلص من الناتج الأسئلة المتكررة وأسلوب الرد، واكتبها في `learning/knowledge.md`. يمكن لـ Claude أن يقوم بهذه الخطوة.
3. أعد النشر. يُضيف `deploy.mjs` محتوى `knowledge.md` تلقائياً إلى تعليمات الوكيل.

ملاحظة: المحادثات القديمة في تطبيق WhatsApp Business لا تصل إلى Kapso إلا إذا رُبط الرقم بوضع **Coexistence**، مع تفعيل استيراد سجل الرسائل (History Sync) أثناء الربط.
