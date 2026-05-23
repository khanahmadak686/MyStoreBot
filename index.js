const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

// --- CREDENTIALS & SETTINGS ---
const token = '8998018950:AAECsgWiq5cSLYyh63MC2lqRmKw2a8-TzTU';
const adminChatId = '1703328653'; 
const myUpiId = 'ar844042@okicici'; 
const myStoreName = 'My Kirana Store';
const myBotUsername = 'TheSmartSeller_store'; 

// DYNAMIC PORT SETUP FOR RENDER
const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const bot = new TelegramBot(token, { webHook: { port: PORT } });
bot.setWebHook(`https://mystore-bot-live.onrender.com/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const userStates = {};

// --- DATABASE HELPERS ---
function readDB(file) {
    const dbPath = path.join(__dirname, file);
    if (fs.existsSync(dbPath)) return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return (file === 'profiles.json' || file === 'promos.json' || file === 'wallet.json') ? {} : [];
}
function writeDB(file, data) {
    fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}

function initUser(chatId) {
    if (!userStates[chatId]) {
        userStates[chatId] = { status: 'idle', cart: [], tempAddress: '', phone: '', deliveryType: '', tempProductId: null, discount: 0, promoName: '', currentCategory: '', categoryPage: 0, walletUsed: 0, walletDeduction: 0 };
    }
}

// --- SERVER ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/rider', (req, res) => res.sendFile(path.join(__dirname, 'rider.html')));
app.get('/api/rider-orders', (req, res) => res.json(readDB('orders.json').filter(o => o.status === 'PACKED' || o.status === 'OUT')));

app.post('/api/mark-delivered/:orderId', (req, res) => {
    let orders = readDB('orders.json');
    let idx = orders.findIndex(o => o.id === req.params.orderId);
    if(idx !== -1) {
        orders[idx].status = 'DELIVERED'; writeDB('orders.json', orders);
        bot.sendMessage(orders[idx].chatId, `✅ Aapka order (ID: ${orders[idx].id}) successfully deliver ho gaya hai!`);
        res.json({success: true});
    }
});

// --- BOT LOGIC ---
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    if(msg.text === '/start') {
        bot.sendMessage(chatId, `Welcome to ${myStoreName}! 🌾`, { reply_markup: { inline_keyboard: [[{ text: '🛍️ Browse', callback_data: 'browse_categories' }], [{ text: '🛒 Cart', callback_data: 'view_cart' }]] } });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
