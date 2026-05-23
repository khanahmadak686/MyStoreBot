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

// WEBHOOK CONFIGURATION FOR RENDER
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const bot = new TelegramBot(token, { webHook: { port: process.env.PORT || 3000 } });
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

function isStoreOpen() {
    let hour = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata", hour: 'numeric', hour12: false});
    return parseInt(hour) >= 8 && parseInt(hour) < 22;
}

function sendPaymentOptions(chatId) {
    let itemsTotal = userStates[chatId].cart.reduce((sum, p) => sum + (p.price * p.qty), 0);
    let deliveryFee = (userStates[chatId].deliveryType === 'Home Delivery' && itemsTotal < 500) ? 30 : 0;
    let total = itemsTotal + deliveryFee - userStates[chatId].discount;
    let walletDeduction = userStates[chatId].walletUsed >= total ? total : userStates[chatId].walletUsed;
    total = total - walletDeduction;
    
    userStates[chatId].finalTotal = total; 
    userStates[chatId].deliveryFee = deliveryFee;
    userStates[chatId].walletDeduction = walletDeduction;

    let msgText = `🛍️ Items Total: ₹${itemsTotal}\n🚚 Delivery: ₹${deliveryFee}\n🏷️ Discount: -₹${userStates[chatId].discount}\n🪙 Wallet Used: -₹${walletDeduction}\n\n💰 **Grand Total: ₹${total}**\n\nChoose payment:`;
    bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📱 UPI', callback_data: 'pay_upi' }], [{ text: '💵 Cash', callback_data: 'pay_cash' }]] } });
}

// --- ROUTES ---
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

// --- BOT LOGIC ---
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    initUser(chatId);
    if(msg.text === '/start') {
        bot.sendMessage(chatId, `Welcome to ${myStoreName}!`, { reply_markup: { inline_keyboard: [[{ text: '🛍️ Browse', callback_data: 'browse_categories' }], [{ text: '🛒 Cart', callback_data: 'view_cart' }]] } });
    }
    // ... (rest of your existing logic remains same here) ...
});

app.listen(process.env.PORT || 3000, () => console.log("Final System Live!"));