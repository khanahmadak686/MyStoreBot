const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

const token = '8998018950:AAECsgWiq5cSLYyh63MC2lqRmKw2a8-TzTU';
const adminChatId = '1703328653'; 
const myUpiId = 'ar844042@okicici'; 
const myStoreName = 'My Kirana Store';
const myBotUsername = 'TheSmartSeller_store'; 

const PORT = process.env.PORT || 3000;
const app = express();

const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(`https://mystore-bot-live.onrender.com/bot${token}`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const userStates = {};

// Database Helpers
const readDB = (file) => {
    const dbPath = path.join(__dirname, file);
    return fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : (['profiles.json', 'promos.json', 'wallet.json'].includes(file) ? {} : []);
};
const writeDB = (file, data) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));

function initUser(chatId) {
    if (!userStates[chatId]) {
        userStates[chatId] = { status: 'idle', cart: [], tempAddress: '', phone: '', deliveryType: '', tempProductId: null, discount: 0, promoName: '', currentCategory: '', categoryPage: 0, walletUsed: 0, walletDeduction: 0 };
    }
}

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/rider', (req, res) => res.sendFile(path.join(__dirname, 'rider.html')));
app.get('/api/rider-orders', (req, res) => res.json(readDB('orders.json').filter(o => o.status === 'PACKED' || o.status === 'OUT')));

app.post('/api/mark-delivered/:orderId', (req, res) => {
    let orders = readDB('orders.json');
    let idx = orders.findIndex(o => o.id === req.params.orderId);
    if(idx !== -1) {
        orders[idx].status = 'DELIVERED'; writeDB('orders.json', orders);
        bot.sendMessage(orders[idx].chatId, `✅ Order ${orders[idx].id} delivered!`);
        res.json({success: true});
    }
});

app.post('/add-product', (req, res) => {
    let products = readDB('products.json');
    products.push({ name: req.body.name, category: req.body.category, unit: req.body.unit, price: Number(req.body.price), stock: Number(req.body.stock), image: req.body.image, id: `prod_${Date.now()}` });
    writeDB('products.json', products);
    res.send('<h2>✅ Added! <a href="/">Go Back</a></h2>');
});

// Bot Logic
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    const text = msg.text || '';

    if (text.startsWith('/start')) {
        bot.sendMessage(chatId, `Welcome to ${myStoreName}! 🌾`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍️ Browse Products', callback_data: 'browse_categories' }],
                    [{ text: '🛒 View Cart', callback_data: 'view_cart' }],
                    [{ text: '🎁 Refer & Earn', callback_data: 'refer_earn' }]
                ]
            }
        });
    }
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    initUser(chatId);
    if (query.data === 'refer_earn') {
        bot.sendMessage(chatId, `🎁 **Refer & Earn!**\nShare this link: https://t.me/${myBotUsername}?start=${chatId}`);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started successfully on port ${PORT}`);
});
