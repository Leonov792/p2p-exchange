const https = require("https");

const TOKEN = "8650667280:AAE7NbQYdXbZg8SmY3WTv_rPXL4WCJ9YEWY";
const WEBAPP = "https://p2p-exchange-sigma.vercel.app";
const API_BASE = "https://api.telegram.org/bot" + TOKEN;

function call(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(API_BASE + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", () => resolve({ ok: false }));
    req.write(data); req.end();
  });
}

const START_TEXT = `Добро пожаловать в P2P Exchange!

Безопасный обмен USDT на рубли прямо в Telegram.
Без паспорта. Без KYC. С гарантом.

Доступные команды:

/exchange — открыть обменник
/offers — мои объявления
/deals — мои сделки
/balance — мой баланс
/deposit — пополнить
/withdraw — вывести USDT
/profile — профиль и TrustScore
/referral — привести друга (0.5%)
/rates — курсы валют
/support — поддержка
/rules — правила

Или нажми кнопку меню чтобы открыть Mini App`;

const RESPONSES = {
  start: START_TEXT,
  exchange: 'Нажми кнопку меню "💱 P2P Exchange" или кнопку ниже чтобы открыть обменник.',
  offers: 'Чтобы увидеть свои объявления, откройте Mini App → вкладка BUY/SELL.',
  deals: 'Ваши сделки доступны в Mini App → вкладка DEALS. Там же кнопки Lock/Paid/Release.',
  balance: 'Баланс отображается в шапке Mini App. Нажмите "Connect Wallet" чтобы подключить кошелёк.',
  deposit: 'Пополнение через TON кошелёк. Отправьте USDT на гарант-кошелёк и вставьте TX хэш в Mini App.',
  withdraw: 'Вывод USDT доступен в Mini App. Нажмите на баланс в шапке → Withdraw.',
  profile: 'Профиль и TrustScore доступны в Mini App → вкладка PROFILE.',
  referral: 'Реферальная программа: 0.5% от сделок приведённых пользователей. Ваша ссылка доступна в PROFILE.',
  rates: 'Курсы: 1 USDT = 92.5 RUB. Графики TradingView доступны в Mini App → вкладка CHARTS.',
  support: 'Поддержка: откройте /exchange и создайте спор через кнопку Dispute в сделке. Администратор рассмотрит.',
  rules: `Правила площадки:

1. Сделки через гарант-эскроу. USDT блокируются на время сделки.
2. Комиссия платформы: 2% с каждой сделки.
3. Запрещено: мошенничество, фрод, использование чужих карт.
4. Споры решаются администратором. Решение админа окончательно.
5. Мейкеры вносят залог 500 USDT. Фрод = конфискация залога.
6. AML проверка: кошельки с высоким риском блокируются.`,
};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const cmd = text.split(" ")[0].replace("/", "").split("@")[0].toLowerCase();

  let response = RESPONSES[cmd];
  if (!response) {
    response = "Используйте /start для списка команд или меню для входа в обменник.";
  }

  const keyboard = {
    inline_keyboard: [[{ text: "💱 Открыть P2P Exchange", web_app: { url: WEBAPP } }]],
  };

  await call("sendMessage", {
    chat_id: chatId,
    text: response,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

async function main() {
  console.log("P2P Exchange bot started. Send /start to @SergGOrelyyBot");
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
          if (msg && msg.text) {
            console.log("[" + msg.chat.id + "] " + msg.text.substring(0, 50));
            await handleMessage(msg);
          }
        }
      }
    } catch (e) {
      console.log("Poll error:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
