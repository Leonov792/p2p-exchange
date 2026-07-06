const https = require("https");

const TOKEN = "8650667280:AAE7NbQYdXbZg8SmY3WTv_rPXL4WCJ9YEWY";
const WEBAPP = "https://p2p-exchange-sigma.vercel.app";
const BASE = "https://api.telegram.org/bot" + TOKEN;

function request(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const url = new URL(BASE + "/" + method);
    const req = https.request(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
    }, (res) => { let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d))); });
    req.on("error", () => resolve({ ok: false }));
    req.write(data); req.end();
  });
}

async function main() {
  console.log("P2P Exchange bot polling...");
  let offset = 0;

  while (true) {
    try {
      const res = await new Promise((resolve) => {
        https.get(BASE + "/getUpdates?offset=" + offset + "&timeout=30", (r) => {
          let d = ""; r.on("data", c => d += c); r.on("end", () => resolve(JSON.parse(d)));
        });
      });

      if (res.ok && res.result) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          const msg = u.message || u.channel_post;
          if (msg && msg.text && msg.text.includes("/start")) {
            console.log("/start from chat " + msg.chat.id);
            await request("sendMessage", {
              chat_id: msg.chat.id,
              text: "P2P Crypto Exchange\n\nBuy and sell USDT directly in Telegram.\nEscrow guarantee. TON Connect. Telegram Stars.\n\nOpen the app to start trading:",
              reply_markup: {
                inline_keyboard: [[{ text: "Open P2P Exchange", web_app: { url: WEBAPP } }]],
              },
            });
          }
        }
      }
    } catch (e) {
      console.log("Poll error:", e.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

main();
