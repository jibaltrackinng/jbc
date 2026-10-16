#!/usr/bin/env node
// نشر وكيل واتساب لشركة جبال البصرة على Kapso.
//
// الاستخدام:
//   node whatsapp-agent/deploy.mjs build      يبني workflow/definition.json ويتحقق منه فقط
//   node whatsapp-agent/deploy.mjs deploy     ينشئ الدالة وسير العمل والمشغّل على Kapso
//
// متغيرات البيئة:
//   KAPSO_API_BASE_URL, KAPSO_API_KEY   بيانات الاتصال بـ Kapso (مطلوبة لـ deploy)
//   PROVIDER_MODEL_ID                   معرّف نموذج الذكاء الاصطناعي (node scripts/list-provider-models.js)
//   PHONE_NUMBER_ID                     معرّف رقم واتساب لدى Meta (node scripts/list-whatsapp-phone-numbers.js)
//   TOOL_SECRET                         نفس القيمة السرية المضبوطة في إعدادات الدالة على Kapso
//   FUNCTION_URL                        (اختياري) رابط الدالة إن كانت منشورة مسبقاً، فيتخطى إنشاءها

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", ".claude", "skills", "automate-whatsapp");
const DEF_PATH = path.join(HERE, "workflow", "definition.json");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`المتغير ${name} غير مضبوط.`);
    process.exit(2);
  }
  return v;
}

function kapso(script, args) {
  const out = execFileSync("node", [path.join(SKILL, "scripts", script), ...args], {
    encoding: "utf8",
    env: process.env,
  });
  const json = JSON.parse(out);
  if (json.ok === false) throw new Error(`${script}: ${JSON.stringify(json.error)}`);
  return json.data;
}

// بعض الردود تكون مغلّفة داخل data أو function
function unwrap(obj, key) {
  let cur = obj;
  for (let i = 0; i < 3 && cur; i++) {
    if (cur[key] !== undefined) return cur[key];
    cur = cur.data || cur.function || cur.workflow || cur.trigger;
  }
  return undefined;
}

function buildDefinition({ modelId, functionUrl, toolSecret }) {
  let systemPrompt = readFileSync(path.join(HERE, "workflow", "system-prompt.md"), "utf8").trim();
  // ما تعلّمناه من المحادثات السابقة (learning/knowledge.md)
  const knowledge = readFileSync(path.join(HERE, "learning", "knowledge.md"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (knowledge) {
    systemPrompt += "\n\n## ما تعلمناه من محادثات الشركة السابقة\nاستخدم هذه المعلومات وأسلوب الرد هذا، لكن التعليمات أعلاه لها الأولوية دائماً.\n\n" + knowledge;
  }
  return {
    nodes: [
      {
        id: "start",
        type: "flow-node",
        position: { x: 120, y: 120 },
        data: { node_type: "start", config: {} },
      },
      {
        id: "agent_1760580000000",
        type: "flow-node",
        position: { x: 120, y: 320 },
        data: {
          node_type: "agent",
          config: {
            system_prompt: systemPrompt,
            provider_model_id: modelId,
            max_iterations: 40,
            temperature: 0.3,
            message_delivery_mode: "auto_send_assistant_text",
            enabled_default_tools: [
              "complete_task",
              "handoff_to_human",
              "enter_waiting",
              "get_whatsapp_context",
              "get_current_datetime",
              "contact_conversations",
            ],
            flow_agent_webhooks: [
              {
                name: "track_shipments",
                description:
                  "يجلب شحنات العميل من نظام التتبع بعد التحقق من كود العميل والرمز السري. يرجع ok و client_name و shipments (ref, status, method, destination, material, ctn, kg, cbm, receiveDate, expectedArrivalDate) أو ok=false مع message.",
                url: functionUrl,
                http_method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-JBC-Tool-Secret": toolSecret,
                },
                body: {},
                body_schema: {
                  type: "object",
                  properties: {
                    client_code: { type: "string", description: "كود العميل كما أرسله العميل" },
                    pin: { type: "string", description: "الرمز السري المكون من 4 أرقام" },
                  },
                  required: ["client_code", "pin"],
                },
                jmespath_query: null,
              },
            ],
            flow_agent_mcp_servers: [],
          },
        },
      },
    ],
    edges: [{ source: "start", target: "agent_1760580000000", label: "next" }],
  };
}

function build(functionUrl) {
  const def = buildDefinition({
    modelId: process.env.PROVIDER_MODEL_ID || "PROVIDER_MODEL_ID_HERE",
    functionUrl: functionUrl || process.env.FUNCTION_URL || "https://api.kapso.ai/platform/v1/functions/FUNCTION_ID_HERE/invoke",
    toolSecret: process.env.TOOL_SECRET || "TOOL_SECRET_HERE",
  });
  writeFileSync(DEF_PATH, JSON.stringify(def, null, 2) + "\n");
  const res = execFileSync("node", [path.join(SKILL, "scripts", "validate-graph.js"), "--definition-file", DEF_PATH], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(res);
  if (parsed.ok === false) throw new Error("فشل التحقق من سير العمل: " + JSON.stringify(parsed.error));
  console.log("تم بناء سير العمل والتحقق منه:", DEF_PATH);
}

function deploy() {
  need("KAPSO_API_BASE_URL");
  need("KAPSO_API_KEY");
  need("PROVIDER_MODEL_ID");
  need("TOOL_SECRET");
  const phoneNumberId = need("PHONE_NUMBER_ID");

  let functionUrl = process.env.FUNCTION_URL;
  if (!functionUrl) {
    const created = kapso("create-function.js", [
      "--name", "jbc-track-shipments",
      "--description", "تتبع شحنات عملاء جبال البصرة لوكيل واتساب",
      "--code-file", path.join(HERE, "functions", "jbc-track-shipments.js"),
      "--public-endpoint", "true",
    ]);
    const functionId = unwrap(created, "id");
    kapso("deploy-function.js", ["--function-id", functionId]);
    const fn = kapso("get-function.js", ["--function-id", functionId]);
    functionUrl = unwrap(fn, "endpoint_url") || `https://api.kapso.ai/platform/v1/functions/${functionId}/invoke`;
    console.log("تم نشر الدالة:", functionUrl);
    console.log("مهم: اضبط السر TOOL_SECRET في إعدادات الدالة على Kapso بنفس القيمة قبل التجربة.");
  }

  build(functionUrl);

  const wf = kapso("create-workflow.js", [
    "--name", "JBC WhatsApp Agent",
    "--description", "وكيل خدمة عملاء جبال البصرة على واتساب",
    "--definition-file", DEF_PATH,
  ]);
  const workflowId = unwrap(wf, "id");
  console.log("تم إنشاء سير العمل:", workflowId);

  kapso("create-trigger.js", [workflowId, "--trigger-type", "inbound_message", "--phone-number-id", phoneNumberId]);
  console.log("تم ربط سير العمل برسائل واتساب الواردة. فعّل سير العمل من لوحة Kapso إن كان بحالة draft.");
}

const cmd = process.argv[2];
if (cmd === "build") build();
else if (cmd === "deploy") deploy();
else {
  console.log("الاستخدام: node whatsapp-agent/deploy.mjs <build|deploy>");
  process.exit(cmd ? 2 : 0);
}
