const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

// --- CREDENTIALS & SETTINGS ---
const token = '8998018950:AAECsgWiq5cSLYyh63MC2lqRmKw2a8-TzTU';
const adminChatId = '1703328653'; 
const myUpiId = 'ar844042@okicici'; // 🛠️ ENTER YOUR UPI ID HERE
const myStoreName = 'My Kirana Store';

const bot = new TelegramBot(token, {polling: true});
const app = express();
app.use(express.urlencoded({ extended: true })); 

const userStates = {};

// ==========================================
// 🗄️ DATABASE HELPERS
// ==========================================
function readDB(file) {
    const dbPath = path.join(__dirname, file);
    if (fs.existsSync(dbPath)) return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    return [];
}
function writeDB(file, data) {
    fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}

function initUser(chatId) {
    if (!userStates[chatId]) {
        userStates[chatId] = { status: 'idle', cart: [], tempAddress: '', deliveryType: '', tempProductId: null };
    }
    let users = readDB('users.json');
    if (!users.includes(chatId)) {
        users.push(chatId);
        writeDB('users.json', users);
    }
}

// ==========================================
// 🌐 WEB DASHBOARD & ROUTES
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.post('/add-product', (req, res) => {
    let products = readDB('products.json');
    products.push({
        name: req.body.name, 
        category: req.body.category,
        unit: req.body.unit || '', 
        price: Number(req.body.price), 
        image: req.body.image, 
        id: `prod_${Date.now()}`
    });
    writeDB('products.json', products);
    res.send('<h2 style="text-align:center; margin-top:50px;">✅ Item Added! <br><a href="/">Go Back</a></h2>');
});

app.post('/broadcast', (req, res) => {
    const message = `📢 SPECIAL OFFER 📢\n\n${req.body.message}`;
    const users = readDB('users.json');
    users.forEach(userId => {
        bot.sendMessage(userId, message).catch(err => console.log("User blocked bot"));
    });
    res.send(`<h2 style="text-align:center; margin-top:50px;">✅ Message sent to ${users.length} customers! <br><a href="/">Go Back</a></h2>`);
});

app.get('/print-bill/:orderId', (req, res) => {
    const orders = readDB('orders.json');
    const order = orders.find(o => o.id === req.params.orderId);
    if(!order) return res.send("Order not found!");
    
    let html = `
    <div style="font-family: Arial; max-width: 400px; margin: auto; padding: 20px; border: 1px solid #ccc;">
        <h2 style="text-align: center;">${myStoreName} - Receipt</h2>
        <p><b>Order ID:</b> ${order.id}<br>
        <b>Date:</b> ${order.date}<br>
        <b>Customer Info:</b> ${order.customer_details}<br>
        <b>Type:</b> ${order.delivery_type} | <b>Payment:</b> ${order.payment_mode}</p>
        <hr>
        <table style="width: 100%; text-align: left; border-collapse: collapse;">
            <tr>
                <th style="border-bottom: 1px solid #eee; padding-bottom: 5px;">Item</th>
                <th style="border-bottom: 1px solid #eee; padding-bottom: 5px;">Qty</th>
                <th style="border-bottom: 1px solid #eee; padding-bottom: 5px;">Price</th>
                <th style="border-bottom: 1px solid #eee; padding-bottom: 5px;">Total</th>
            </tr>`;
            
    order.items.forEach(item => { 
        const itemUnit = item.unit ? ` (${item.unit})` : '';
        const itemTotal = item.price * item.qty;
        html += `
            <tr>
                <td style="padding: 5px 0;">${item.name}${itemUnit}</td>
                <td style="padding: 5px 0;">${item.qty}</td>
                <td style="padding: 5px 0;">₹${item.price}</td>
                <td style="padding: 5px 0;">₹${itemTotal}</td>
            </tr>`; 
    });
    
    html += `
        </table>
        <hr>
        <h3 style="text-align: right;">Grand Total: ₹${order.total}</h3>
        <button onclick="window.print()" style="width: 100%; padding: 10px; background: black; color: white; cursor: pointer;">🖨️ PRINT BILL</button>
    </div>`;
    res.send(html);
});

app.listen(3000, () => console.log("Pro System Live on port 3000!"));

// ==========================================
// 🤖 TELEGRAM BOT LOGIC
// ==========================================

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    initUser(chatId);

    // 1. Handling Product Search (NEW)
    if (userStates[chatId].status === 'waiting_for_search') {
        const keyword = text.toLowerCase();
        const products = readDB('products.json');
        const results = products.filter(p => p.name.toLowerCase().includes(keyword) || p.category.toLowerCase().includes(keyword));

        if (results.length === 0) {
            bot.sendMessage(chatId, "No products found for your search. Please try another keyword or browse categories.");
        } else {
            bot.sendMessage(chatId, `🔍 Found ${results.length} products for "${text}":`);
            results.forEach(product => {
                const productUnit = product.unit ? ` (${product.unit})` : '';
                bot.sendPhoto(chatId, product.image, {
                    caption: `📦 ${product.name}${productUnit}\n💰 Price: ₹${product.price}`,
                    reply_markup: { inline_keyboard: [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] }
                });
            });
        }
        userStates[chatId].status = 'idle';
        return;
    }

    // 2. Handling Quantity Input
    if (userStates[chatId].status === 'waiting_for_quantity') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return bot.sendMessage(chatId, "Please enter a valid number (e.g., 1, 2, 3):");

        const product = readDB('products.json').find(p => p.id === userStates[chatId].tempProductId);
        if (product) {
            const existingItem = userStates[chatId].cart.find(p => p.id === product.id);
            if (existingItem) {
                existingItem.qty += qty;
            } else {
                userStates[chatId].cart.push({ ...product, qty: qty });
            }
            bot.sendMessage(chatId, `✅ Added ${qty} x ${product.name} to your cart!`, {
                reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart & Checkout', callback_data: 'view_cart' }]] }
            });
        }
        userStates[chatId].status = 'idle';
        userStates[chatId].tempProductId = null;
        return;
    }

    // 3. Handling Address/Name Input
    if (userStates[chatId].status === 'waiting_for_address' || userStates[chatId].status === 'waiting_for_pickup_name') {
        userStates[chatId].tempAddress = text;
        userStates[chatId].status = 'waiting_for_payment';
        
        let total = userStates[chatId].cart.reduce((sum, p) => sum + (p.price * p.qty), 0);
        bot.sendMessage(chatId, `Your total bill is: ₹${total}\nPlease choose your payment method:`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📱 Pay via UPI (Online)', callback_data: 'pay_upi' }],
                    [{ text: '💵 Cash / Pay at Store', callback_data: 'pay_cash' }]
                ]
            }
        });
        return;
    }

    // Main Menu
    if (text === '/start') {
        bot.sendMessage(chatId, `Welcome to ${myStoreName}! 🌾\nWhat would you like to browse today?`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Search Product', callback_data: 'search_product' }], // NEW SEARCH BUTTON
                    [{ text: '🛍️ Browse Categories', callback_data: 'browse_categories' }],
                    [{ text: `🛒 View Cart (${userStates[chatId].cart.length} items)`, callback_data: 'view_cart' }]
                ]
            }
        });
    }
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
    initUser(chatId);

    // SEARCH LOGIC
    if (data === 'search_product') {
        userStates[chatId].status = 'waiting_for_search';
        bot.sendMessage(chatId, "🔍 Please type the name of the product you are looking for (e.g., Atta, Maggi):");
    }
    else if (data === 'browse_categories') {
        const products = readDB('products.json');
        if (products.length === 0) return bot.sendMessage(chatId, "Store is empty right now.");

        const categories = [...new Set(products.map(p => p.category))];
        const categoryButtons = categories.map(cat => [{ text: `📂 ${cat}`, callback_data: `cat_${cat}` }]);
        bot.sendMessage(chatId, "Please choose a category:", { reply_markup: { inline_keyboard: categoryButtons } });
    } 
    else if (data.startsWith('cat_')) {
        const categoryName = data.replace('cat_', '');
        const products = readDB('products.json').filter(p => p.category === categoryName);
        products.forEach(product => {
            const productUnit = product.unit ? ` (${product.unit})` : '';
            bot.sendPhoto(chatId, product.image, {
                caption: `📦 ${product.name}${productUnit}\n💰 Price: ₹${product.price}`,
                reply_markup: { inline_keyboard: [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] }
            });
        });
    }
    else if (data.startsWith('add_')) {
        const productId = data.replace('add_', '');
        const product = readDB('products.json').find(p => p.id === productId);
        if (product) {
            userStates[chatId].tempProductId = productId;
            userStates[chatId].status = 'waiting_for_quantity';
            bot.sendMessage(chatId, `How many units of ${product.name} do you want?\n(Please type a number, e.g., 1, 2, 5)`);
        }
    }
    // VIEW CART & REMOVE ITEM LOGIC (NEW)
    else if (data === 'view_cart') {
        const cart = userStates[chatId].cart;
        if (cart.length === 0) return bot.sendMessage(chatId, "Your cart is empty.");

        let billText = "🛒 Your Cart:\n\n";
        let total = 0;
        let actionButtons = []; // Dynamic buttons array
        
        cart.forEach(p => { 
            const itemUnit = p.unit ? ` (${p.unit})` : '';
            const itemTotal = p.price * p.qty;
            billText += `- ${p.name}${itemUnit} x ${p.qty} = ₹${itemTotal}\n`; 
            total += itemTotal; 
            
            // Add a remove button for each item
            actionButtons.push([{ text: `❌ Remove ${p.name}`, callback_data: `remove_${p.id}` }]);
        });
        
        billText += `\n💰 Grand Total: ₹${total}\n\nHow would you like to receive your order?`;

        // Add clear cart and checkout buttons
        actionButtons.push([{ text: '🗑️ Clear Entire Cart', callback_data: 'clear_cart' }]);
        actionButtons.push([{ text: '🏍️ Home Delivery', callback_data: 'checkout_delivery' }]);
        actionButtons.push([{ text: '🚶‍♂️ Store Pickup', callback_data: 'checkout_pickup' }]);

        bot.sendMessage(chatId, billText, {
            reply_markup: { inline_keyboard: actionButtons }
        });
    }
    // REMOVE SINGLE ITEM LOGIC
    else if (data.startsWith('remove_')) {
        const productId = data.replace('remove_', '');
        userStates[chatId].cart = userStates[chatId].cart.filter(p => p.id !== productId);
        bot.sendMessage(chatId, "✅ Item removed from your cart.");
        // Automatically show updated cart
        bot.sendMessage(chatId, "Click /start to continue shopping or view your updated cart.");
    }
    // CLEAR ENTIRE CART LOGIC
    else if (data === 'clear_cart') {
        userStates[chatId].cart = [];
        bot.sendMessage(chatId, "🗑️ Your cart has been completely cleared. Click /start to browse again.");
    }
    else if (data === 'checkout_delivery') {
        userStates[chatId].deliveryType = 'Home Delivery';
        userStates[chatId].status = 'waiting_for_address';
        bot.sendMessage(chatId, "Please send your Full Name, Address, and Phone Number:");
    }
    else if (data === 'checkout_pickup') {
        userStates[chatId].deliveryType = 'Store Pickup';
        userStates[chatId].status = 'waiting_for_pickup_name';
        bot.sendMessage(chatId, "Please send your Name and Phone Number:");
    }
    
    // PAYMENT LOGIC & ORDER COMPLETE
    else if (data === 'pay_upi' || data === 'pay_cash') {
        let total = userStates[chatId].cart.reduce((sum, p) => sum + (p.price * p.qty), 0);
        let orderId = `ORD_${Date.now()}`;
        let paymentMode = data === 'pay_upi' ? 'UPI' : 'Cash';
        
        let orders = readDB('orders.json');
        orders.push({
            id: orderId,
            date: new Date().toLocaleString(),
            customer_details: userStates[chatId].tempAddress,
            delivery_type: userStates[chatId].deliveryType,
            payment_mode: paymentMode,
            items: userStates[chatId].cart,
            total: total
        });
        writeDB('orders.json', orders);

        if (paymentMode === 'UPI') {
            const upiLink = `upi://pay?pa=${myUpiId}&pn=${myStoreName.replace(/ /g, '%20')}&am=${total}`;
            bot.sendMessage(chatId, `🎉 Order Saved! (ID: ${orderId})\n\nPlease click this link to pay ₹${total}:\n${upiLink}\n\n*(Don't forget to send a screenshot after payment)*`);
        } else {
            bot.sendMessage(chatId, `🎉 Order Confirmed! (ID: ${orderId})\nWe will pack your order shortly. Please keep the cash ready!`);
        }

        const printUrl = `https://mystore-bot-live.onrender.com/print-bill/${orderId}`; 
        const adminAlert = `🚨 NEW ORDER RECEIVED 🚨\n\n👤 Name/Address: ${userStates[chatId].tempAddress}\n🚚 Mode: ${userStates[chatId].deliveryType}\n💰 Payment: ${paymentMode} (₹${total})\n\n🖨️ Print Bill Here:\n${printUrl}`;
        bot.sendMessage(adminChatId, adminAlert);

        userStates[chatId].cart = []; 
        userStates[chatId].status = 'idle';
    }
});