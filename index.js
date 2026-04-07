const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = "8744075645:AAHhRg1HHWxPDmGNh8EPAHP2gkB4f9bzvPU"; // ✅ बंद करें
const GROUP_ID = -1003577641778;
const ADMIN_ID = 7952793528;

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true
  }
});

const app = express();
app.get("/", (req, res) => res.send("Bot Running"));
app.listen(process.env.PORT || 3000);

// ERROR HANDLER
bot.on("polling_error", (err) => console.log("Polling Error:", err.message));

// TEMP STORAGE
let users = {};
let deals = {};
let dealCounter = 1;

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`🔥 Welcome to USDT TO INR

Sell & Buy Crypto easily`,
  {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Add Post", callback_data: "add" }],
        [{ text: "📊 Stats", callback_data: "stats" }]
      ]
    }
  });
});

// BUTTON HANDLER
bot.on("callback_query", (q) => {
  let id = q.from.id;

  if (q.data === "add") {
    users[id] = {};
    bot.sendMessage(id, "Select Type", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Sell", callback_data: "sell" }, { text: "Buy", callback_data: "buy" }]
        ]
      }
    });
  }

  if (q.data === "sell" || q.data === "buy") {
    users[id].type = q.data;
    bot.sendMessage(id, "Select Crypto", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "USDT", callback_data: "USDT" }, { text: "BNB", callback_data: "BNB" }],
          [{ text: "SOL", callback_data: "SOL" }, { text: "USDC", callback_data: "USDC" }]
        ]
      }
    });
  }

  if (["USDT", "BNB", "SOL", "USDC"].includes(q.data)) {
    users[id].crypto = q.data;
    bot.sendMessage(id, "Enter Amount USD:");
  }

  if (q.data === "post") {
    let d = users[id];

    let text = `
⭐ #${d.type}

⭐ Crypto: ${d.crypto}
⭐ Quantity: $${d.amount}
⭐ Rate: ${d.rate}

⭐ DM: @${q.from.username}
`;

    bot.sendMessage(GROUP_ID, text).then(m => {
      bot.pinChatMessage(GROUP_ID, m.message_id);
    });

    bot.sendMessage(id, "✅ Posted");
    delete users[id];
  }
});

// MESSAGE FLOW
bot.on("message", (msg) => {
  let id = msg.from.id;
  if (!users[id]) return;

  if (!users[id].amount) {
    users[id].amount = msg.text;
    bot.sendMessage(id, "Enter Rate:");
    return;
  }

  if (!users[id].rate) {
    users[id].rate = msg.text;

    let d = users[id];

    let preview = `
⭐ #${d.type}

⭐ Crypto: ${d.crypto}
⭐ Quantity: $${d.amount}
⭐ Rate: ${d.rate}
`;

    bot.sendMessage(id, preview, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Post", callback_data: "post" }]
        ]
      }
    });
  }
});

// ESCROW ADD
bot.onText(/\/add (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  let amt = parseFloat(match[1]);
  let final = amt - 1;

  deals[dealCounter] = {
    total: amt,
    remaining: final
  };

  bot.sendMessage(msg.chat.id, `
💰 Deal ID: ${dealCounter}

Deposit: ${amt}
Fee: 1 USDT
Remaining: ${final}
`);

  dealCounter++;
});

// RELEASE
bot.onText(/\/release (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  let [id, amt] = match[1].split(" ");
  amt = parseFloat(amt);

  if (!deals[id]) return;

  deals[id].remaining -= amt;

  bot.sendMessage(msg.chat.id, `
✅ Deal ${id} Released: ${amt}

Remaining: ${deals[id].remaining}
`);
});

// RUNNING DEALS
bot.onText(/\/running/, (msg) => {
  let text = "📊 Running Deals:\n";

  for (let id in deals) {
    text += `Deal ${id}: ${deals[id].remaining}\n`;
  }

  bot.sendMessage(msg.chat.id, text);
});
