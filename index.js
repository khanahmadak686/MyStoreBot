const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

// --- BOT CREDENTIALS ---
const token = '8998018950:AAECsgWiq5cSLYyh63MC2lqRmKw2a8-TzTU';
const adminChatId = '1703328653'; 

const bot = new TelegramBot(token, {polling: true});
const app = express();
app.use(express.urlencoded({ extended: true })); 

const userStates = {};

// ==========================================
// 🗄️ DATABASE SETUP
// ==========================================
const dbPath = path.join(__dirname, 'products.json');

function getProducts() {
    if (fs.existsSync(dbPath)) {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
    return [];
}

function saveProducts(productsArray) {
    fs.writeFileSync(dbPath, JSON.stringify(productsArray, null, 2));
}

// Ensure user memory exists
function initUser(chatId) {
    if (!userStates[chatId]) {
        userStates[chatId] = { status: 'idle', cart: [] };
    }
}

// ==========================================
// 🌐 WEB DASHBOARD
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.post('/add-product', (req, res) => {
    const products = getProducts();
    const newProduct = {
        name: req.body.name,
        category: req.body.category,
        price: Number(req.body.price),
        image: req.body.image,
        id: `prod_${Date.now()}` 
    };
    products.push(newProduct); 
    saveProducts(products); 
    res.send('<div style="text-align:center; margin-top:50px; font-family:Arial;"><h2>✅ Kirana Item Added!</h2><a href="/" style="text-decoration:none; color:blue;">Go Back</a></div>');
});

app.listen(3000, () => console.log("Kirana System is Live on port 3000!"));

// ==========================================
// 🤖 TELEGRAM BOT LOGIC
// ==========================================

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    initUser(chatId);

    const customerName = msg.from.first_name || "Customer";
    const username = msg.from.username ? `@${msg.from.username}` : "N/A";

    // 1. Handling Parchi (Direct List)
    if (userStates[chatId].status === 'waiting_for_list') {
        bot.sendMessage(chatId, "✅ Aapki parchi humein mil gayi hai! Hum jaldi hi iska bill aur delivery time aapko batayenge.");
        const alert = `🚨 NAYI PARCHI AAYI HAI 🚨\n\n👤 Customer: ${customerName} (${username})\n📝 Items List:\n${text}`;
        bot.sendMessage(adminChatId, alert);
        userStates[chatId].status = 'idle';
        return;
    }

    // 2. Handling Delivery Address (Checkout)
    if (userStates[chatId].status === 'waiting_for_address') {
        let orderDetails = "";
        let total = 0;
        userStates[chatId].cart.forEach(p => {
            orderDetails += `- ${p.name} (₹${p.price})\n`;
            total += p.price;
        });

        bot.sendMessage(chatId, `🎉 Order Confirmed!\n\nAapka Total Bill: ₹${total}\nHumara delivery boy jaldi hi aapke address par hoga.`);
        const alert = `🚨 NAYA HOME DELIVERY ORDER 🚨\n\n👤 Customer: ${customerName} (${username})\n📍 Address: ${text}\n\n🛒 Cart Items:\n${orderDetails}\n💰 Total Bill: ₹${total}`;
        bot.sendMessage(adminChatId, alert);
        
        userStates[chatId].cart = []; 
        userStates[chatId].status = 'idle';
        return;
    }

    // 3. Handling Store Pickup
    if (userStates[chatId].status === 'waiting_for_pickup_name') {
        let orderDetails = "";
        let total = 0;
        userStates[chatId].cart.forEach(p => {
            orderDetails += `- ${p.name} (₹${p.price})\n`;
            total += p.price;
        });

        bot.sendMessage(chatId, `🎉 Order Confirmed!\n\nAapka Total Bill: ₹${total}\nAap apna order dukan se pick kar sakte hain.`);
        const alert = `🚨 NAYA STORE PICKUP ORDER 🚨\n\n👤 Customer: ${text} (${username})\n\n🛒 Cart Items:\n${orderDetails}\n💰 Total Bill: ₹${total}`;
        bot.sendMessage(adminChatId, alert);
        
        userStates[chatId].cart = []; 
        userStates[chatId].status = 'idle';
        return;
    }

    // Main Menu
    if (text === '/start') {
        const menuOptions = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍️ Browse Categories', callback_data: 'browse_categories' }],
                    [{ text: '📝 Send Grocery List (Parchi)', callback_data: 'send_list' }],
                    [{ text: `🛒 View Cart (${userStates[chatId].cart.length} items)`, callback_data: 'view_cart' }]
                ]
            }
        };
        bot.sendMessage(chatId, "Welcome to our Kirana Store! 🌾\nAap items browse kar sakte hain ya seedha parchi bhej sakte hain:", menuOptions);
    }
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
    initUser(chatId);

    if (data === 'browse_categories') {
        const products = getProducts();
        if (products.length === 0) return bot.sendMessage(chatId, "Store is empty right now.");

        const categories = [...new Set(products.map(p => p.category))];
        const categoryButtons = categories.map(cat => [{ text: `📂 ${cat}`, callback_data: `cat_${cat}` }]);
        
        bot.sendMessage(chatId, "Category choose karein:", { reply_markup: { inline_keyboard: categoryButtons } });
    } 
    else if (data.startsWith('cat_')) {
        const categoryName = data.replace('cat_', '');
        const products = getProducts().filter(p => p.category === categoryName);
        
        bot.sendMessage(chatId, `Showing products for: ${categoryName}`);
        products.forEach(product => {
            bot.sendPhoto(chatId, product.image, {
                caption: `📦 ${product.name}\n💰 Price: ₹${product.price}`,
                reply_markup: { inline_keyboard: [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] }
            });
        });
    }
    else if (data.startsWith('add_')) {
        const productId = data.replace('add_', '');
        const product = getProducts().find(p => p.id === productId);
        if (product) {
            userStates[chatId].cart.push(product);
            bot.sendMessage(chatId, `✅ ${product.name} cart mein add ho gaya! (Total Items: ${userStates[chatId].cart.length})`, {
                reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart & Checkout', callback_data: 'view_cart' }]] }
            });
        }
    }
    else if (data === 'view_cart') {
        const cart = userStates[chatId].cart;
        if (cart.length === 0) return bot.sendMessage(chatId, "Aapka cart khali hai.");

        let billText = "🛒 Aapka Cart:\n\n";
        let total = 0;
        cart.forEach(p => { billText += `- ${p.name} (₹${p.price})\n`; total += p.price; });
        billText += `\n💰 Total Amount: ₹${total}\n\nAap apna order kaise chahte hain?`;

        bot.sendMessage(chatId, billText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏍️ Home Delivery', callback_data: 'checkout_delivery' }],
                    [{ text: '🚶‍♂️ Store Pickup', callback_data: 'checkout_pickup' }]
                ]
            }
        });
    }
    else if (data === 'checkout_delivery') {
        userStates[chatId].status = 'waiting_for_address';
        bot.sendMessage(chatId, "Kripya apna poora Name, Address aur Phone Number bhejein:");
    }
    else if (data === 'checkout_pickup') {
        userStates[chatId].status = 'waiting_for_pickup_name';
        bot.sendMessage(chatId, "Kripya apna Name aur Phone Number bhejein taaki hum order pack karke rakh sakein:");
    }
    else if (data === 'send_list') {
        userStates[chatId].status = 'waiting_for_list';
        bot.sendMessage(chatId, "📝 Apni poori grocery list (Parchi) ek hi message mein type karke bhejein:");
    }
});