const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

// --- CREDENTIALS & SETTINGS ---
const token = '8998018950:AAECsgWiq5cSLYyh63MC2lqRmKw2a8-TzTU';
const adminChatId = '1703328653'; 
const myUpiId = 'ar844042@okicici'; 
const myStoreName = 'My Kirana Store';
const myBotUsername = 'YOUR_BOT_USERNAME_HERE'; // 🛠️ YAHAN APNE BOT KA USERNAME DAALEIN (Bina @ ke)

const bot = new TelegramBot(token, {polling: true});
const app = express();
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 

const userStates = {};

// ==========================================
// 🗄️ DATABASE HELPERS
// ==========================================
function readDB(file) {
    const dbPath = path.join(__dirname, file);
    if (fs.existsSync(dbPath)) return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    if (file === 'profiles.json' || file === 'promos.json' || file === 'wallet.json') return {};
    return [];
}
function writeDB(file, data) {
    fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2));
}

function initUser(chatId) {
    if (!userStates[chatId]) {
        userStates[chatId] = { 
            status: 'idle', cart: [], tempAddress: '', phone: '', deliveryType: '', 
            tempProductId: null, discount: 0, promoName: '', currentCategory: '', 
            categoryPage: 0, walletUsed: 0, walletDeduction: 0
        };
    }
}

function isStoreOpen() {
    let hour = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata", hour: 'numeric', hour12: false});
    hour = parseInt(hour);
    return hour >= 8 && hour < 22;
}

function checkWalletAndProceed(chatId) {
    let wallets = readDB('wallet.json');
    if (wallets[chatId] && wallets[chatId] > 0) {
        bot.sendMessage(chatId, `🪙 Aapke Kirana Wallet mein **₹${wallets[chatId]}** hain. Kya aap inhe is order mein use karna chahte hain?`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: `✅ Haan, Use ₹${wallets[chatId]}`, callback_data: 'use_wallet' }],
                [{ text: '❌ Nahi, Bacha kar rakhein', callback_data: 'skip_wallet' }]
            ]}
        });
    } else {
        userStates[chatId].walletUsed = 0;
        userStates[chatId].status = 'waiting_for_payment';
        sendPaymentOptions(chatId);
    }
}

function sendPaymentOptions(chatId) {
    let itemsTotal = userStates[chatId].cart.reduce((sum, p) => sum + (p.price * p.qty), 0);
    let deliveryFee = (userStates[chatId].deliveryType === 'Home Delivery' && itemsTotal < 500) ? 30 : 0;
    
    let total = itemsTotal + deliveryFee - userStates[chatId].discount;
    let walletDeduction = 0;
    if (userStates[chatId].walletUsed > 0) {
        walletDeduction = userStates[chatId].walletUsed >= total ? total : userStates[chatId].walletUsed;
    }
    
    total = total - walletDeduction;
    if (total < 0) total = 0;

    userStates[chatId].finalTotal = total; 
    userStates[chatId].deliveryFee = deliveryFee;
    userStates[chatId].walletDeduction = walletDeduction;

    let msgText = `🛍️ Items Total: ₹${itemsTotal}\n`;
    if (userStates[chatId].deliveryType === 'Home Delivery') msgText += `🚚 Delivery Charge: ₹${deliveryFee} ${deliveryFee === 0 ? '(🎉 FREE DELIVERY)' : ''}\n`;
    if (userStates[chatId].discount > 0) msgText += `🏷️ Discount (${userStates[chatId].promoName}): -₹${userStates[chatId].discount}\n`;
    if (walletDeduction > 0) msgText += `🪙 Wallet Used: -₹${walletDeduction}\n`;
    
    msgText += `\n💰 Grand Total: ₹${total}\n\nPlease choose your payment method:`;
    
    bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: [ [{ text: '📱 Pay via UPI (Online)', callback_data: 'pay_upi' }], [{ text: '💵 Cash / Pay at Store', callback_data: 'pay_cash' }] ] } });
}

function sendCategoryBatch(chatId) {
    const products = readDB('products.json').filter(p => p.category === userStates[chatId].currentCategory);
    const page = userStates[chatId].categoryPage;
    const limit = 5; 
    const start = page * limit;
    const end = start + limit;
    const currentBatch = products.slice(start, end);

    currentBatch.forEach(product => {
        let stockText = product.stock > 0 ? `📦 Stock Available` : `🔴 OUT OF STOCK`;
        let buttons = product.stock > 0 ? [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] : [];
        bot.sendPhoto(chatId, product.image, {
            caption: `📦 ${product.name} (${product.unit||''})\n💰 Price: ₹${product.price}\n${stockText}`,
            reply_markup: { inline_keyboard: buttons }
        });
    });

    if (end < products.length) bot.sendMessage(chatId, `Showing ${end} of ${products.length} items.`, { reply_markup: { inline_keyboard: [[{ text: '⬇️ Show More', callback_data: 'next_page' }]] } });
    else if (products.length > 0) bot.sendMessage(chatId, `✅ End of category. Check your cart:`, { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
}

// ==========================================
// 🌐 WEB DASHBOARD, RIDER & ROUTES (Unchanged)
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/rider', (req, res) => res.sendFile(path.join(__dirname, 'rider.html')));

app.get('/api/rider-orders', (req, res) => {
    const orders = readDB('orders.json');
    res.json(orders.filter(o => o.status === 'PACKED' || o.status === 'OUT'));
});

app.post('/api/mark-delivered/:orderId', (req, res) => {
    let orders = readDB('orders.json');
    let orderIndex = orders.findIndex(o => o.id === req.params.orderId);
    if(orderIndex !== -1) {
        orders[orderIndex].status = 'DELIVERED'; writeDB('orders.json', orders);
        bot.sendMessage(orders[orderIndex].chatId, `✅ Aapka order (ID: ${orders[orderIndex].id}) successfully deliver ho gaya hai. Humse judne ke liye shukriya!`);
        bot.sendMessage(adminChatId, `🚨 **DELIVERY UPDATE** 🚨\nRider ne Order ID: ${orders[orderIndex].id} successfully deliver kar diya hai!`);
        res.json({success: true});
    } else res.json({success: false});
});

app.post('/add-product', (req, res) => {
    let products = readDB('products.json');
    products.push({ name: req.body.name, category: req.body.category, unit: req.body.unit || '', price: Number(req.body.price), stock: Number(req.body.stock) || 100, image: req.body.image, id: `prod_${Date.now()}` });
    writeDB('products.json', products); res.send('<h2 style="text-align:center; margin-top:50px;">✅ Item Added! <br><a href="/">Go Back</a></h2>');
});

app.post('/broadcast', (req, res) => {
    const message = `📢 SPECIAL OFFER 📢\n\n${req.body.message}`;
    readDB('users.json').forEach(userId => { bot.sendMessage(userId, message).catch(err => console.log("Blocked")); });
    res.send(`<h2 style="text-align:center; margin-top:50px;">✅ Message sent! <br><a href="/">Go Back</a></h2>`);
});

app.get('/download-sales', (req, res) => {
    const orders = readDB('orders.json');
    let csv = 'Order ID,Date,Status,Customer Info,Type,Payment Mode,Items Total,Delivery Fee,Discount,Grand Total\n';
    orders.forEach(o => {
        let safeInfo = o.customer_details ? o.customer_details.replace(/,/g, ' ') : ''; 
        csv += `${o.id},"${o.date}",${o.status},${safeInfo},${o.delivery_type},${o.payment_mode},${o.items.reduce((s,i)=>s+(i.price*i.qty),0)},${o.delivery_fee||0},${o.discount||0},${o.total}\n`;
    });
    res.header('Content-Type', 'text/csv'); res.attachment(`kirana_sales_${Date.now()}.csv`); return res.send(csv);
});

app.get('/print-bill/:orderId', (req, res) => {
    const orders = readDB('orders.json');
    const order = orders.find(o => o.id === req.params.orderId);
    if(!order) return res.send("Order not found!");
    let html = `<div style="font-family: Arial; max-width: 400px; margin: auto; padding: 20px; border: 1px solid #ccc;"><h2 style="text-align: center;">${myStoreName} - Receipt</h2><p><b>Order ID:</b> ${order.id}<br><b>Date:</b> ${order.date}<br><b>Customer Info:</b> ${order.customer_details}<br><b>Type:</b> ${order.delivery_type} | <b>Payment:</b> ${order.payment_mode}</p><hr><table style="width: 100%; text-align: left; border-collapse: collapse;"><tr><th style="border-bottom: 1px solid #eee;">Item</th><th style="border-bottom: 1px solid #eee;">Qty</th><th style="border-bottom: 1px solid #eee;">Total</th></tr>`;
    order.items.forEach(item => { html += `<tr><td>${item.name} (${item.unit||''})</td><td>${item.qty}</td><td>₹${item.price * item.qty}</td></tr>`; });
    html += `</table><hr>`;
    if (order.delivery_fee > 0) html += `<h4 style="text-align: right; margin: 5px 0;">Delivery: ₹${order.delivery_fee}</h4>`;
    if (order.discount > 0) html += `<h4 style="text-align: right; margin: 5px 0; color: green;">Discount: -₹${order.discount}</h4>`;
    if (order.wallet_used > 0) html += `<h4 style="text-align: right; margin: 5px 0; color: #d35400;">Wallet Used: -₹${order.wallet_used}</h4>`;
    html += `<h3 style="text-align: right; margin: 5px 0;">Grand Total: ₹${order.total}</h3><button onclick="window.print()" style="width: 100%; padding: 10px; background: black; color: white; cursor: pointer;">🖨️ PRINT BILL</button></div>`;
    res.send(html);
});

app.listen(3000, () => console.log("Viral Referral System Live on port 3000!"));

// ==========================================
// 🤖 TELEGRAM BOT LOGIC
// ==========================================

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    initUser(chatId);

    // 🎁 REFERRAL SYSTEM LOGIC (New feature)
    if (text.startsWith('/start')) {
        let users = readDB('users.json');
        let isNewUser = !users.includes(chatId);

        // Check if user came from a referral link (e.g. /start 123456789)
        const parts = text.split(' ');
        if (parts.length > 1 && isNewUser) {
            const referrerId = parts[1];
            if (referrerId != chatId) { // Khud ko refer nahi kar sakte
                let wallets = readDB('wallet.json');
                wallets[referrerId] = (wallets[referrerId] || 0) + 20; // Referrer gets ₹20
                wallets[chatId] = (wallets[chatId] || 0) + 20;         // New User gets ₹20
                writeDB('wallet.json', wallets);

                bot.sendMessage(referrerId, `🎉 **Dhamaka!** Aapke dost ne aapke link se humari dukan par aana shuru kiya hai. Aapke Kirana Wallet mein ₹20 add kar diye gaye hain! 🎁`);
                bot.sendMessage(chatId, `🎁 **Welcome Bonus!** Aapko invite link se aane par ₹20 ka free wallet balance mila hai. Ise aap apne pehle order mein use kar sakte hain!`);
            }
        }

        // Save new user
        if (isNewUser) {
            users.push(chatId);
            writeDB('users.json', users);
        }

        // Standard Start Menu
        let wallets = readDB('wallet.json');
        let walletBalance = wallets[chatId] ? `(Wallet: ₹${wallets[chatId]})` : '';
        
        bot.sendMessage(chatId, `Welcome to ${myStoreName}! 🌾 ${walletBalance}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Search Product', callback_data: 'search_product' }],
                    [{ text: '🛍️ Browse Categories', callback_data: 'browse_categories' }],
                    [{ text: `🛒 View Cart (${userStates[chatId].cart.length})`, callback_data: 'view_cart' }],
                    [{ text: '🔄 Repeat Last Order', callback_data: 'repeat_order' }, { text: '🎁 Refer & Earn', callback_data: 'refer_earn' }],
                    [{ text: '💬 Support / Chat with Shop', callback_data: 'support_chat' }] 
                ]
            }
        });
        return;
    }

    // 👨‍💼 ADMIN REPLY LOGIC
    if (chatId == adminChatId && text.startsWith('/reply ')) {
        const parts = text.split(' '); const targetChatId = parts[1]; const replyMsg = parts.slice(2).join(' ');
        bot.sendMessage(targetChatId, `👨‍💼 **Store Owner Reply:**\n${replyMsg}`); bot.sendMessage(adminChatId, "✅ Customer ko reply bhej diya gaya hai."); return;
    }

    if (userStates[chatId].status === 'waiting_for_support') {
        const adminMsg = `📩 **New Support Message**\n👤 Name: ${msg.from.first_name}\n🆔 ID: ${chatId}\n💬 Message: ${text}\n\n👉 **Reply kaise karein?**\n\`/reply ${chatId} Aapka Message Yahan\` `;
        bot.sendMessage(adminChatId, adminMsg, {parse_mode: 'Markdown'}); bot.sendMessage(chatId, "✅ Aapka message hum tak pahunch gaya hai. Hum jaldi hi reply karenge!");
        userStates[chatId].status = 'idle'; return;
    }

    if (userStates[chatId].status === 'waiting_for_contact' && msg.contact) {
        userStates[chatId].phone = msg.contact.phone_number; userStates[chatId].status = 'waiting_for_address_only';
        bot.sendMessage(chatId, "✅ Number verified! Kripya apna poora Delivery Address likh kar bhejein:", { reply_markup: { remove_keyboard: true } }); return;
    }
    if (userStates[chatId].status === 'waiting_for_contact' && !msg.contact) return bot.sendMessage(chatId, "Kripya niche diye gaye '📲 Share Contact' button par click karein.");

    if (userStates[chatId].status === 'waiting_for_address_only') {
        userStates[chatId].tempAddress = `${msg.from.first_name || "Customer"}, ${text} (Phone: ${userStates[chatId].phone})`;
        if (userStates[chatId].deliveryType === 'Home Delivery') {
            let profiles = readDB('profiles.json'); profiles[chatId] = userStates[chatId].tempAddress; writeDB('profiles.json', profiles);
        }
        userStates[chatId].status = 'waiting_for_promo';
        bot.sendMessage(chatId, "🏷️ Do you have a Promo Code?\nType the code below, or click 'Skip':", { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip Promo', callback_data: 'skip_promo' }]] } }); return;
    }

    if (userStates[chatId].status === 'waiting_for_promo') {
        const promos = readDB('promos.json');
        if (promos[text.toUpperCase()]) {
            userStates[chatId].discount = promos[text.toUpperCase()]; userStates[chatId].promoName = text.toUpperCase();
            bot.sendMessage(chatId, `🎉 Awesome! Promo code applied. You saved ₹${userStates[chatId].discount}.`);
        } else bot.sendMessage(chatId, "❌ Invalid Promo Code. Proceeding without discount.");
        checkWalletAndProceed(chatId); return;
    }

    if (userStates[chatId].status === 'waiting_for_quantity') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return bot.sendMessage(chatId, "Enter valid number:");
        const product = readDB('products.json').find(p => p.id === userStates[chatId].tempProductId);
        if (product) {
            let existingQty = 0;
            const existingItem = userStates[chatId].cart.find(p => p.id === product.id);
            if (existingItem) existingQty = existingItem.qty;
            if ((existingQty + qty) > (product.stock || 100)) return bot.sendMessage(chatId, `⚠️ Sorry, humare paas is item ka sirf ${product.stock} stock bacha hai.`);
            
            if (existingItem) existingItem.qty += qty; else userStates[chatId].cart.push({ ...product, qty: qty });
            bot.sendMessage(chatId, `✅ Added ${qty} x ${product.name} to cart!`, { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
        }
        userStates[chatId].status = 'idle'; return;
    }
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
    initUser(chatId);

    // 🎁 REFER & EARN CALLBACK
    if (data === 'refer_earn') {
        const referLink = `https://t.me/${myBotUsername}?start=${chatId}`;
        const referMsg = `🎁 **Refer & Earn ₹20!**\n\nIs link ko apne doston aur padosiyon ke sath WhatsApp par share karein. \nJaise hi koi is link se humari dukan join karega, **Aapko aur aapke dost dono ko ₹20 ka free Kirana Wallet balance milega!**\n\n👇 Aapka Link Ise Copy Karein:\n${referLink}`;
        bot.sendMessage(chatId, referMsg, {parse_mode: 'Markdown'});
        return;
    }

    if (data === 'use_wallet') {
        let wallets = readDB('wallet.json'); userStates[chatId].walletUsed = wallets[chatId] || 0;
        userStates[chatId].status = 'waiting_for_payment'; sendPaymentOptions(chatId); return;
    }
    if (data === 'skip_wallet') {
        userStates[chatId].walletUsed = 0; userStates[chatId].status = 'waiting_for_payment'; sendPaymentOptions(chatId); return;
    }

    if (data === 'support_chat') {
        userStates[chatId].status = 'waiting_for_support'; bot.sendMessage(chatId, "💬 Kripya apna sawaal ya problem yahan likhein:"); return;
    }

    if (data.startsWith('status_')) {
        const parts = data.split('_'); const status = parts[1]; const custChatId = parts[2]; const orderId = parts[3];
        let orders = readDB('orders.json'); let orderIndex = orders.findIndex(o => o.id === orderId);
        if(orderIndex !== -1) { orders[orderIndex].status = status; writeDB('orders.json', orders); }
        let msg = "";
        if (status === 'PACKED') msg = `📦 Aapka order (ID: ${orderId}) pack ho gaya hai!`;
        if (status === 'OUT') msg = `🚚 Aapka order delivery ke liye nikal chuka hai.`;
        if (status === 'DELIVERED') msg = `✅ Aapka order successfully deliver ho gaya hai. Shukriya!`;
        bot.sendMessage(custChatId, msg); bot.sendMessage(chatId, `✅ Status updated to ${status}`); return;
    }

    if (data.startsWith('add_') || data === 'checkout_delivery' || data === 'checkout_pickup') {
        if (!isStoreOpen()) return bot.sendMessage(chatId, "🌙 Sorry, humari dukan abhi band hai (Subah 8 AM se Raat 10 PM).");
    }

    if (data === 'skip_promo') {
        userStates[chatId].discount = 0; userStates[chatId].promoName = ''; checkWalletAndProceed(chatId);
    }
    else if (data === 'repeat_order') {
        const orders = readDB('orders.json'); const lastOrder = [...orders].reverse().find(o => o.chatId === chatId);
        if (lastOrder && lastOrder.items) {
            userStates[chatId].cart = [...lastOrder.items]; bot.sendMessage(chatId, "🔄 Aapka pichla order cart mein add ho gaya hai!", { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
        } else bot.sendMessage(chatId, "❌ Humein aapka koi pichla order nahi mila.");
    }
    else if (data === 'search_product') {
        userStates[chatId].status = 'waiting_for_search'; bot.sendMessage(chatId, "🔍 Type the product name:");
    }
    else if (data === 'browse_categories') {
        const products = readDB('products.json');
        if (products.length === 0) return bot.sendMessage(chatId, "Store is empty.");
        const categories = [...new Set(products.map(p => p.category))];
        const categoryButtons = categories.map(cat => [{ text: `📂 ${cat}`, callback_data: `cat_${cat}` }]);
        bot.sendMessage(chatId, "Choose a category:", { reply_markup: { inline_keyboard: categoryButtons } });
    } 
    else if (data.startsWith('cat_')) {
        userStates[chatId].currentCategory = data.replace('cat_', ''); userStates[chatId].categoryPage = 0; sendCategoryBatch(chatId);
    }
    else if (data === 'next_page') {
        userStates[chatId].categoryPage += 1; sendCategoryBatch(chatId);
    }
    else if (data.startsWith('add_')) {
        userStates[chatId].tempProductId = data.replace('add_', ''); userStates[chatId].status = 'waiting_for_quantity'; bot.sendMessage(chatId, `How many units do you want?`);
    }
    else if (data === 'view_cart') {
        if (userStates[chatId].cart.length === 0) return bot.sendMessage(chatId, "Your cart is empty.");
        let billText = "🛒 Your Cart:\n\n"; let total = 0; let actionButtons = [];
        userStates[chatId].cart.forEach(p => { 
            billText += `- ${p.name} x ${p.qty} = ₹${p.price * p.qty}\n`; total += p.price * p.qty; 
            actionButtons.push([{ text: `❌ Remove ${p.name}`, callback_data: `remove_${p.id}` }]);
        });
        billText += `\n🛍️ Total: ₹${total}\n\nDelivery/Pickup?`;
        actionButtons.push([{ text: '🗑️ Clear Cart', callback_data: 'clear_cart' }]);
        actionButtons.push([{ text: '🏍️ Home Delivery', callback_data: 'checkout_delivery' }, { text: '🚶‍♂️ Store Pickup', callback_data: 'checkout_pickup' }]);
        bot.sendMessage(chatId, billText, { reply_markup: { inline_keyboard: actionButtons } });
    }
    else if (data.startsWith('remove_')) {
        userStates[chatId].cart = userStates[chatId].cart.filter(p => p.id !== data.replace('remove_', '')); bot.sendMessage(chatId, "✅ Removed.");
    }
    else if (data === 'clear_cart') {
        userStates[chatId].cart = []; bot.sendMessage(chatId, "🗑️ Cart cleared.");
    }
    else if (data === 'checkout_delivery') {
        userStates[chatId].deliveryType = 'Home Delivery';
        let profiles = readDB('profiles.json');
        if (profiles[chatId]) {
            bot.sendMessage(chatId, `🏠 Save Address:\n${profiles[chatId]}\nUse this?`, { reply_markup: { inline_keyboard: [ [{ text: '✅ Yes', callback_data: 'use_saved_address' }], [{ text: '📝 New Address', callback_data: 'enter_new_address' }] ] } });
        } else {
            userStates[chatId].status = 'waiting_for_contact'; 
            bot.sendMessage(chatId, "📲 Kripya apna verified phone number share karein:", { reply_markup: { keyboard: [[{ text: '📲 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
        }
    }
    else if (data === 'use_saved_address') {
        userStates[chatId].tempAddress = readDB('profiles.json')[chatId]; userStates[chatId].status = 'waiting_for_promo';
        bot.sendMessage(chatId, "🏷️ Do you have a Promo Code?\nType the code below, or click 'Skip':", { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip Promo', callback_data: 'skip_promo' }]] } });
    }
    else if (data === 'enter_new_address') {
        userStates[chatId].status = 'waiting_for_contact'; 
        bot.sendMessage(chatId, "📲 Kripya apna verified phone number share karein:", { reply_markup: { keyboard: [[{ text: '📲 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    }
    else if (data === 'checkout_pickup') {
        userStates[chatId].deliveryType = 'Store Pickup'; userStates[chatId].status = 'waiting_for_pickup_name'; bot.sendMessage(chatId, "Send Name and Phone:");
    }
    
    else if (data === 'pay_upi' || data === 'pay_cash') {
        let orderId = `ORD_${Date.now()}`; let paymentMode = data === 'pay_upi' ? 'UPI' : 'Cash';
        
        let orders = readDB('orders.json');
        orders.push({
            id: orderId, chatId: chatId, date: new Date().toLocaleString(), status: 'PENDING', 
            customer_details: userStates[chatId].tempAddress, delivery_type: userStates[chatId].deliveryType,
            payment_mode: paymentMode, items: userStates[chatId].cart, 
            delivery_fee: userStates[chatId].deliveryFee, discount: userStates[chatId].discount, 
            wallet_used: userStates[chatId].walletDeduction, total: userStates[chatId].finalTotal
        });
        writeDB('orders.json', orders);

        let products = readDB('products.json');
        userStates[chatId].cart.forEach(cartItem => { let p = products.find(prod => prod.id === cartItem.id); if(p && p.stock) p.stock -= cartItem.qty; });
        writeDB('products.json', products);

        let wallets = readDB('wallet.json');
        if (userStates[chatId].walletDeduction > 0) wallets[chatId] -= userStates[chatId].walletDeduction;
        let cashbackEarned = Math.round(userStates[chatId].finalTotal * 0.05); 
        if (!wallets[chatId]) wallets[chatId] = 0;
        if (cashbackEarned > 0) wallets[chatId] += cashbackEarned;
        writeDB('wallet.json', wallets);

        if (paymentMode === 'UPI') {
            const upiLink = `upi://pay?pa=${myUpiId}&pn=${myStoreName.replace(/ /g, '%20')}&am=${userStates[chatId].finalTotal}`;
            bot.sendMessage(chatId, `🎉 Order Saved! (ID: ${orderId})\nLink to pay ₹${userStates[chatId].finalTotal}:\n${upiLink}`);
        } else {
            bot.sendMessage(chatId, `🎉 Order Confirmed! (ID: ${orderId})\nKeep ₹${userStates[chatId].finalTotal} cash ready!`);
        }

        if (cashbackEarned > 0) bot.sendMessage(chatId, `🎁 **Badhai ho!** Aapko ₹${cashbackEarned} ka Cashback mila hai!`, {parse_mode: 'Markdown'});

        const printUrl = `https://mystore-bot-live.onrender.com/print-bill/${orderId}`; 
        const adminAlert = `🚨 NEW ORDER RECEIVED 🚨\n\n👤 Details: ${userStates[chatId].tempAddress}\n🚚 Mode: ${userStates[chatId].deliveryType}\n💰 Total: ₹${userStates[chatId].finalTotal} (${paymentMode})\n\n🖨️ Print Bill:\n${printUrl}`;
        
        bot.sendMessage(adminChatId, adminAlert, {
            reply_markup: {
                inline_keyboard: [
                    [{text: '📦 Mark as Packed', callback_data: `status_PACKED_${chatId}_${orderId}`}],
                    [{text: '🚚 Out for Delivery', callback_data: `status_OUT_${chatId}_${orderId}`}],
                    [{text: '✅ Delivered', callback_data: `status_DELIVERED_${chatId}_${orderId}`}]
                ]
            }
        });

        userStates[chatId].cart = []; userStates[chatId].discount = 0; 
        userStates[chatId].walletUsed = 0; userStates[chatId].walletDeduction = 0;
        userStates[chatId].status = 'idle';
    }
});