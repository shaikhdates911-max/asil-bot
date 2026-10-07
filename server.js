const express = require("express");
const fs = require("fs");
const app = express();
app.use(express.json());

const {
  ANTHROPIC_API_KEY, WHATSAPP_TOKEN, PHONE_NUMBER_ID,
  VERIFY_TOKEN, OWNER_PHONE, MODEL = "claude-sonnet-5-5", PORT = 3000,
} = process.env;

const SYSTEM = () => `أنت موظف مبيعات وخدمة عملاء على واتساب لمتجر "أصيل الوادي" (زيت زيتون وتمور وعسل ومنتجات طبيعية). اتكلم بالعامية المصرية بأسلوب مهذب ومختصر ودود.
استخدم المعلومات التالية فقط، ولا تخترع منتجات أو أسعاراً أو خصومات أو رسوم شحن أو مواعيد:

${fs.readFileSync("menu.txt", "utf8")}

قواعد:
1) جاوب على أسئلة المنتجات والأحجام والأسعار والعروض بناءً على القائمة فقط.
2) أي معلومة مكتوب عنها "غير محددة بعد" أو مش موجودة في القائمة، قل إن فريق المبيعات هيأكدها للعميل، ولا تخمّن.
3) لا تذكر رسوم شحن بالأرقام. قل إنها تتحسب حسب العنوان، إلا المنتجات المكتوب عليها شحن مجاني.
4) لا تدّعي فوائد صحية أو علاجية للمنتجات.
5) خد الأوردر: المنتجات والكميات، الاسم، المحافظة والعنوان بالتفصيل، ورقم التليفون. راجعه مع العميل مع إجمالي سعر المنتجات (بدون الشحن).
6) بعد ما العميل يأكد، اكتب رسالة شكر وقل إن الفريق هيتواصل لتأكيد الأوردر وتفاصيل الشحن، وفي آخر سطر منفصل اكتب: ORDER_CONFIRMED: ثم ملخص الأوردر كامل مع بيانات العميل.
7) لو العميل اشتكى أو طلب حاجة مش في القائمة أو سأل عن حاجة غير محددة في القائمة، اكتب في آخر سطر: HANDOFF: سبب مختصر.`;

const histories = new Map(); // رقم العميل -> آخر الرسائل (في الذاكرة)

async function askClaude(phone, text) {
  const h = histories.get(phone) || [];
  h.push({ role: "user", content: text });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system: SYSTEM(), messages: h.slice(-20) }),
  });
  const data = await r.json();
  const reply = data.content?.map((b) => b.text || "").join("") || "";
  h.push({ role: "assistant", content: reply });
  histories.set(phone, h.slice(-20));
  return reply;
}

async function sendWA(to, body) {
  await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;
    const from = msg.from;
    if (msg.type !== "text") {
      return sendWA(from, "ممكن تكتب لي طلبك كتابةً؟ 🙏");
    }
    let reply = await askClaude(from, msg.text.body);

    const flags = [];
    reply = reply.split("\n").filter((line) => {
      const m = line.match(/^(ORDER_CONFIRMED|HANDOFF):\s*(.*)$/);
      if (m) { flags.push(`${m[1]} من ${from}\n${m[2]}`); return false; }
      return true;
    }).join("\n").trim();

    if (reply) await sendWA(from, reply);
    for (const f of flags) if (OWNER_PHONE) await sendWA(OWNER_PHONE, "🔔 " + f);
  } catch (e) {
    console.error(e);
  }
});

app.listen(PORT, () => console.log("جاهز على بورت " + PORT));
