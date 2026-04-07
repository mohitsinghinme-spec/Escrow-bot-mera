const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = "8751514436:AAEvpcU8pILwjnyKYfAlFa6go3937ZWyFmI;
const GROUP_ID = -1003577641778;

const bot = new TelegramBot(TOKEN, { polling: true });

const app = express();
app.get("/", (req, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// START
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
`🔥 Welcome to USDT TO INR

Sell & Buy Crypto easily.`,
{
    reply_markup: {
        inline_keyboard: [
            [{ text: "➕ Add Post", callback_data: "add" }],
            [{ text: "📊 Stats", callback_data: "stats" }]
        ]
    }
});
});

// BUTTON
bot.on("callback_query", (q) => {
    if(q.data === "add"){
        bot.sendMessage(q.message.chat.id, "Enter Amount USD:");
    }
});

// POST SYSTEM
bot.on("message", (msg) => {
    if(msg.text && !msg.text.startsWith("/")){
        let text = `
⭐ #Selling

⭐ Crypto: USDT
⭐ Quantity: $${msg.text}
⭐ Chain: BEP20
⭐ Funds Source: Legit
⭐ Rate: 94
⭐ Payment Method: UPI

⭐ DM: @${msg.from_user.username}
`;

        bot.sendMessage(GROUP_ID, text).then(m=>{
            bot.pinChatMessage(GROUP_ID, m.message_id);
        });

        bot.sendMessage(msg.chat.id, "✅ Posted & Pinned");
    }
});
