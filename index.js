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
        userStates[chatId] = { status: 'idle', cart: [], tempAddress: '', deliveryType: '' };
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
        unit: req.body.unit || '', // NEW FIELD SAVED
        price: Number(req.body.price), 
        image: req.body.image, 
        id: `prod_${Date.now()}`
    });
    writeDB('products.json', products);
    res.send('<h2 style="text-align:center; margin-top:50px;">✅ Item Added! <br><a href="/">Go Back</a></h2>');
});

// Broadcast Route
app.post('/broadcast', (req, res) => {
    const message = `📢 SPECIAL OFFER 📢\n\n${req.body.message}`;
    const users = readDB('users.json');
    
    users.forEach(userId => {
        bot.sendMessage(userId, message).catch(err => console.log("User blocked bot"));
    });
    
    res.send(`<h2 style="text-align:center; margin-top:50px;">✅ Message sent to ${users.length} customers! <br><a href="/">Go Back</a></h2>`);
});

// Print Bill Route
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
        <table style="width: 100%; text-align: left;">
            <tr><th>Item</th><th>Price</th></tr>`;
            
    order.items.forEach(item => { 
        // Add Unit to Bill
        const itemUnit = item.unit ? ` (${item.unit})` : '';
        html += `<tr><td>${item.name}${itemUnit}</td><td>₹${item.price}</td></tr>`; 
    });
    
    html += `
        </table>
        <hr>
        <h3 style="text-align: right;">Total: ₹${order.total}</h3>
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

    if (userStates[chatId].status === 'waiting_for_address' || userStates[chatId].status === 'waiting_for_pickup_name') {
        userStates[chatId].tempAddress = text;
        userStates[chatId].status = 'waiting_for_payment';
        
        let total = userStates[chatId].cart.reduce((sum, p) => sum + p.price, 0);
        
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

    if (text === '/start') {
        bot.sendMessage(chatId, `Welcome to ${myStoreName}! 🌾\nWhat would you like to browse today?`, {
            reply_markup: {
                inline_keyboard: [
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

    if (data === 'browse_categories') {
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
            userStates[chatId].cart.push(product);
            bot.sendMessage(chatId, `✅ ${product.name} has been added to your cart!`, {
                reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart & Checkout', callback_data: 'view_cart' }]] }
            });
        }
    }
    else if (data === 'view_cart') {
        const cart = userStates[chatId].cart;
        if (cart.length === 0) return bot.sendMessage(chatId, "Your cart is empty.");

        let billText = "🛒 Your Cart:\n\n";
        let total = 0;
        cart.forEach(p => { 
            const itemUnit = p.unit ? ` (${p.unit})` : '';
            billText += `- ${p.name}${itemUnit} (₹${p.price})\n`; 
            total += p.price; 
        });
        billText += `\n💰 Total Amount: ₹${total}\n\nHow would you like to receive your order?`;

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
        userStates[chatId].deliveryType = 'Home Delivery';
        userStates[chatId].status = 'waiting_for_address';
        bot.sendMessage(chatId, "Please send your Full Name, Address, and Phone Number:");
    }
    else if (data === 'checkout_pickup') {
        userStates[chatId].deliveryType = 'Store Pickup';
        userStates[chatId].status = 'waiting_for_pickup_name';
        bot.sendMessage(chatId, "Please send your Name and Phone Number:");
    }
    
    else if (data === 'pay_upi' || data === 'pay_cash') {
        let total = userStates[chatId].cart.reduce((sum, p) => sum + p.price, 0);
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