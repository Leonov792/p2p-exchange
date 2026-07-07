const https = require("https");

const TOKEN = "8650667280:AAE7NbQYdXbZg8SmY3WTv_rPXL4WCJ9YEWY";
const WEBAPP = "https://p2p-exchange-sigma.vercel.app";
const API = "https://p2p-exchange-api.vercel.app/api";
const API_BASE = "https://api.telegram.org/bot" + TOKEN;

function tg(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(API_BASE + "/" + method, {
      method: "POST", headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", () => resolve({ ok: false }));
    req.write(data); req.end();
  });
}

function apiCall(path, userId) {
  return new Promise((resolve) => {
    const req = https.request(API + path, {
      method: "GET",
      headers: { "X-Telegram-User-ID": String(userId), "Content-Type": "application/json" },
    }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({ error: "parse" }); } });
    });
    req.on("error", () => resolve({ error: "network" }));
    req.end();
  });
}

function webAppBtn(text) {
  return { inline_keyboard: [[{ text: text || "💱 Открыть P2P Exchange", web_app: { url: WEBAPP } }]] };
}

function formatRUB(n) { return Number(n || 0).toLocaleString("ru-RU") + " ₽"; }
function formatUSDT(n) { return Number(n || 0).toFixed(2) + " USDT"; }

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id || chatId;
  const text = (msg.text || "").trim();
  const cmd = text.split(" ")[0].replace("/", "").split("@")[0].toLowerCase();
  const kb = webAppBtn();

  if (cmd === "start") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: `Добро пожаловать в P2P Exchange!\n\nБезопасный обмен USDT на рубли прямо в Telegram. Без паспорта. Без KYC. С гарантом.\n\nДоступные команды:\n/exchange — открыть обменник\n/offers — мои объявления\n/deals — мои сделки\n/balance — мой баланс\n/deposit — пополнить\n/withdraw — вывести USDT\n/profile — профиль и TrustScore\n/referral — реферальная программа\n/rates — курсы валют\n/support — поддержка\n/rules — правила`,
      reply_markup: kb,
    });
  }

  if (cmd === "exchange") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "Нажмите кнопку ниже чтобы открыть P2P обменник. Покупайте и продавайте USDT за рубли.",
      reply_markup: kb,
    });
  }

  if (cmd === "balance") {
    const b = await apiCall("/wallet/balance", userId);
    return tg("sendMessage", {
      chat_id: chatId,
      text: `💰 *Ваш баланс*\n\nДоступно: *${formatUSDT(b?.available || 0)}*\nЗаблокировано: ${formatUSDT(b?.frozen || 0)}\nВсего: ${formatUSDT(b?.balance || 0)}`,
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "offers") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "Ваши активные объявления доступны в Mini App. Откройте обменник → вкладка BUY/SELL.",
      reply_markup: kb,
    });
  }

  if (cmd === "deals") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "Ваши сделки доступны в Mini App. Откройте обменник → вкладка DEALS. Там кнопки Lock / Paid / Release.",
      reply_markup: kb,
    });
  }

  if (cmd === "profile") {
    const p = await apiCall("/profile", userId);
    return tg("sendMessage", {
      chat_id: chatId,
      text: `👤 *Ваш профиль*\n\nID: ${p?.id || userId}\nСделок: ${p?.deals_completed || 0}\nTrustScore: ${p?.trust_score || 0}/100\nTON кошелёк: ${(p?.ton_wallet || "не указан").slice(0, 12)}...\nБаланс: ${formatUSDT(p?.balance || 0)}`,
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "referral") {
    const r = await apiCall("/referrals", userId);
    return tg("sendMessage", {
      chat_id: chatId,
      text: `🤝 *Реферальная программа*\n\nВаша ссылка:\nt.me/SergGOrelyyBot?start=ref${userId}\n\nПриглашено: ${r?.referralsTotal || 0}\nАктивных: ${r?.referralsActive || 0}\nЗаработано: ${formatUSDT(r?.referralEarnings || 0)}\nСтавка: ${r?.rate || "0.5%"}`,
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "rates") {
    try {
      const r = await apiCall("/ton/rates", userId);
      return tg("sendMessage", {
        chat_id: chatId,
        text: `📊 *Курсы валют*\n\nTON: ${r?.tonRub || 500} ₽\nUSDT: ${r?.usdtRub || 92.5} ₽\nTON/USD: $${r?.tonUsd || 5.5}`,
        parse_mode: "Markdown",
        reply_markup: kb,
      });
    } catch {
      return tg("sendMessage", { chat_id: chatId, text: "📊 USDT = 92.5 ₽ | TON = 500 ₽", reply_markup: kb });
    }
  }

  if (cmd === "deposit") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: `💰 *Пополнение баланса*\n\n1. Отправьте USDT на гарант-кошелёк:\n\`UQAAECd3lxgQEr9wEV_xaYpyg_it7Vj0ysLjFe6ayXPUHHFp\`\n\n2. Скопируйте TX хэш из кошелька\n\n3. Откройте обменник → нажмите на баланс → Deposit → вставьте TX хэш\n\nСистема проверит блокчейн и зачислит баланс.`,
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "withdraw") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "📤 *Вывод USDT*\n\nОткройте обменник → нажмите на баланс в шапке → Withdraw → укажите сумму и адрес кошелька.\n\nВывод обрабатывается в течение 24 часов.",
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "support") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: "🛡 *Поддержка и арбитраж*\n\nЕсли возник спор по сделке:\n1. Откройте обменник → DEALS\n2. Нажмите Dispute\n3. Опишите причину\n\nАдминистратор рассмотрит и примет решение.\n\nПо другим вопросам: откройте /exchange",
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  if (cmd === "rules") {
    return tg("sendMessage", {
      chat_id: chatId,
      text: `📜 *Правила площадки*\n\n1. Сделки через гарант-эскроу. USDT блокируются на время сделки.\n2. Комиссия платформы: 2% с каждой сделки.\n3. Запрещено: мошенничество, фрод, чужие карты.\n4. Споры решает администратор. Решение окончательно.\n5. Мейкеры вносят залог 500 USDT. Фрод = конфискация.\n6. AML-проверка:高风险 кошельки блокируются.`,
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  }

  return tg("sendMessage", {
    chat_id: chatId,
    text: "Используйте /start для списка команд или меню для входа в обменник.",
    reply_markup: kb,
  });
}

async function main() {
  console.log("P2P Exchange bot with live API | Send /start to @SergGOrelyyBot");
  let offset = 0;

  while (true) {
    try {
      const res = await new Promise((resolve) => {
        https.get(API_BASE + "/getUpdates?offset=" + offset + "&timeout=30", (r) => {
          let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve(JSON.parse(d)));
        });
      });

      if (res.ok && res.result) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (msg?.text) {
            console.log("[" + msg.chat.id + "] " + msg.text.substring(0, 40));
            handleMessage(msg).catch((e) => console.error("Handler error:", e.message));
          }
        }
      }
    } catch (e) {
      console.log("Poll:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
