const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.toLowerCase().includes("gastei")) {
        bot.sendMessage(chatId, "Despesa registrada ✅");
    } else {
        bot.sendMessage(chatId, "Envie algo como: Gastei 200 supermercado");
    }
});

const app = express();
app.get("/", (req, res) => res.send("Bot rodando"));
app.listen(3000);
