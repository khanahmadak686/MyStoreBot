const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');

// ==========================================
// 🛡️ CRASH PREVENTION (Bot will never go offline)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection Caught and Ignored:', reason.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception Caught and Ignored:', err.message || err);
});

// --- CREDENTIALS & SETTINGS ---
const token = process.env.TELEGRAM_TOKEN; 
const adminChatId = '1703328653'; 
const myUpiId = 'ar844042@okicici'; 
const myStoreName = 'My Kirana Store';
const myBotUsername = 'TheSmartSeller_store'; 

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; 

// ==========================================
// 🗄️ MONGODB CONNECTION & SCHEMAS
// ==========================================
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch(err => console.log('❌ MongoDB Connection Error:', err));

const Product = mongoose.model('Product', new mongoose.Schema({ id: String, name: String, category: String, unit: String, price: Number, stock: Number, image: String }));
const Order = mongoose.model('Order', new mongoose.Schema({ id: String, chatId: Number, date: String, status: String, customer_details: String, delivery_type: String, payment_mode: String, items: Array, delivery_fee: Number, discount: Number, wallet_used: Number, total: Number }));
const User = mongoose.model('User', new mongoose.Schema({ chatId: Number }));
const Wallet = mongoose.model('Wallet', new mongoose.Schema({ chatId: Number, balance: { type: Number, default: 0 } }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ chatId: Number, address: String }));
const Promo = mongoose.model('Promo', new mongoose.Schema({ code: String, discount: Number }));

// ==========================================
// 🌐 SERVER & WEBHOOK SETUP
// ==========================================
const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(`https://mystore-bot-live.onrender.com/bot${token}`);

const app = express();
app.use(express.urlencoded({ extended: true })); 
app.use(express.json()); 

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

const userStates = {};

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
    return parseInt(hour) >= 8 && parseInt(hour) < 22;
}

async function checkWalletAndProceed(chatId) {
    let walletData = await Wallet.findOne({ chatId: chatId });
    let balance = walletData ? walletData.balance : 0;
    
    if (balance > 0) {
        bot.sendMessage(chatId, `🪙 Your Kirana Wallet has a balance of **₹${balance}**. Would you like to use it for this order?`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
                [{ text: `✅ Yes, use ₹${balance}`, callback_data: 'use_wallet' }],
                [{ text: '❌ No, save it', callback_data: 'skip_wallet' }]
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

// 🛠️ FIX: Bulletproof Image Sending Logic
async function sendCategoryBatch(chatId) {
    const products = await Product.find({ category: userStates[chatId].currentCategory });
    const page = userStates[chatId].categoryPage;
    const limit = 5; 
    const start = page * limit;
    const end = start + limit;
    const currentBatch = products.slice(start, end);

    for (const product of currentBatch) {
        let stockText = product.stock > 0 ? `📦 Stock Available` : `🔴 OUT OF STOCK`;
        let buttons = product.stock > 0 ? [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] : [];
        let fallbackMsg = `📦 *${product.name}* (${product.unit||''})\n💰 Price: ₹${product.price}\n${stockText}\n\n*(Product image unavailable - Invalid Link)*`;
        
        if (!product.image || !product.image.startsWith('http')) {
            await bot.sendMessage(chatId, fallbackMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
        } else {
            bot.sendPhoto(chatId, product.image, {
                caption: `📦 ${product.name} (${product.unit||''})\n💰 Price: ₹${product.price}\n${stockText}`,
                reply_markup: { inline_keyboard: buttons }
            }).catch(async (err) => {
                // If Telegram rejects the image, send text instead of crashing
                await bot.sendMessage(chatId, fallbackMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
            });
        }
    }

    if (end < products.length) bot.sendMessage(chatId, `Showing ${end} of ${products.length} items.`, { reply_markup: { inline_keyboard: [[{ text: '⬇️ Show More', callback_data: 'next_page' }]] } });
    else if (products.length > 0) bot.sendMessage(chatId, `✅ End of category. Check your cart:`, { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
}

// ==========================================
// 🌐 WEB ROUTES & APIS
// ==========================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/rider', (req, res) => res.sendFile(path.join(__dirname, 'rider.html')));

app.get('/api/rider-orders', async (req, res) => {
    const orders = await Order.find({ status: { $in: ['PACKED', 'OUT'] } });
    res.json(orders);
});

app.post('/api/mark-delivered/:orderId', async (req, res) => {
    let order = await Order.findOne({ id: req.params.orderId });
    if(order) {
        order.status = 'DELIVERED';
        await order.save();
        bot.sendMessage(order.chatId, `✅ Your order (ID: ${order.id}) has been successfully delivered. Thank you for shopping with us!`);
        bot.sendMessage(adminChatId, `🚨 **DELIVERY UPDATE** 🚨\nThe rider has successfully delivered Order ID: ${order.id}!`);
        res.json({success: true});
    } else res.json({success: false});
});

app.post('/add-product', async (req, res) => {
    await Product.create({ name: req.body.name, category: req.body.category, unit: req.body.unit || '', price: Number(req.body.price), stock: Number(req.body.stock) || 100, image: req.body.image, id: `prod_${Date.now()}` });
    res.send('<h2 style="text-align:center; margin-top:50px; font-family:Arial;">✅ Item Added to Store! <br><br><a href="/" style="padding:10px 20px; background:#28a745; color:white; text-decoration:none; border-radius:5px;">Go Back</a></h2>');
});

app.post('/broadcast', async (req, res) => {
    const message = `📢 SPECIAL OFFER 📢\n\n${req.body.message}`;
    const users = await User.find({});
    users.forEach(u => { bot.sendMessage(u.chatId, message).catch(err => console.log("Blocked")); });
    res.send(`<h2 style="text-align:center; margin-top:50px;">✅ Message sent! <br><a href="/">Go Back</a></h2>`);
});

app.get('/download-sales', async (req, res) => {
    const orders = await Order.find({});
    let csv = 'Order ID,Date,Status,Customer Info,Type,Payment Mode,Items Total,Delivery Fee,Discount,Grand Total\n';
    orders.forEach(o => {
        let safeInfo = o.customer_details ? o.customer_details.replace(/,/g, ' ') : ''; 
        csv += `${o.id},"${o.date}",${o.status},${safeInfo},${o.delivery_type},${o.payment_mode},${o.items.reduce((s,i)=>s+(i.price*i.qty),0)},${o.delivery_fee||0},${o.discount||0},${o.total}\n`;
    });
    res.header('Content-Type', 'text/csv'); res.attachment(`kirana_sales_${Date.now()}.csv`); return res.send(csv);
});

app.get('/print-bill/:orderId', async (req, res) => {
    const order = await Order.findOne({ id: req.params.orderId });
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

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Database System Live on port ${PORT}!`));

// ==========================================
// 🤖 TELEGRAM BOT LOGIC
// ==========================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    initUser(chatId);

    // Search Logic with Bulletproof Image Handler
    if (userStates[chatId].status === 'waiting_for_search') {
        const searchTerm = text.toLowerCase();
        const products = await Product.find({ name: { $regex: searchTerm, $options: 'i' } });
        
        if (products.length === 0) {
            bot.sendMessage(chatId, "❌ No products found with that name. Please try another search:");
            return;
        }

        bot.sendMessage(chatId, `🔍 Found ${products.length} results for "${text}":`);
        
        const results = products.slice(0, 5); 
        for (const product of results) {
            let stockText = product.stock > 0 ? `📦 Stock Available` : `🔴 OUT OF STOCK`;
            let buttons = product.stock > 0 ? [[{ text: '➕ Add to Cart', callback_data: `add_${product.id}` }]] : [];
            let fallbackMsg = `📦 *${product.name}* (${product.unit||''})\n💰 Price: ₹${product.price}\n${stockText}\n\n*(Product image unavailable - Invalid Link)*`;

            if (!product.image || !product.image.startsWith('http')) {
                await bot.sendMessage(chatId, fallbackMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
            } else {
                bot.sendPhoto(chatId, product.image, {
                    caption: `📦 ${product.name} (${product.unit||''})\n💰 Price: ₹${product.price}\n${stockText}`,
                    reply_markup: { inline_keyboard: buttons }
                }).catch(async (err) => {
                    await bot.sendMessage(chatId, fallbackMsg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
                });
            }
        }
        userStates[chatId].status = 'idle';
        return;
    }

    if (text.startsWith('/start')) {
        let user = await User.findOne({ chatId: chatId });
        let isNewUser = !user;

        const parts = text.split(' ');
        if (parts.length > 1 && isNewUser) {
            const referrerId = Number(parts[1]);
            if (referrerId != chatId) {
                await Wallet.findOneAndUpdate({ chatId: referrerId }, { $inc: { balance: 20 } }, { upsert: true });
                await Wallet.findOneAndUpdate({ chatId: chatId }, { $inc: { balance: 20 } }, { upsert: true });

                bot.sendMessage(referrerId, `🎉 **Great News!** A friend joined our store using your link. ₹20 has been added to your Kirana Wallet! 🎁`);
                bot.sendMessage(chatId, `🎁 **Welcome Bonus!** You received ₹20 as a free wallet balance for joining via an invite link. You can use it on your first order!`);
            }
        }

        if (isNewUser) {
            await User.create({ chatId: chatId });
        }

        let walletData = await Wallet.findOne({ chatId: chatId });
        let walletBalance = walletData && walletData.balance > 0 ? `(Wallet: ₹${walletData.balance})` : '';
        
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

    if (chatId == adminChatId && text.startsWith('/reply ')) {
        const parts = text.split(' '); const targetChatId = parts[1]; const replyMsg = parts.slice(2).join(' ');
        bot.sendMessage(targetChatId, `👨‍💼 **Store Owner Reply:**\n${replyMsg}`); 
        bot.sendMessage(adminChatId, "✅ Reply successfully sent to the customer."); 
        return;
    }

    if (userStates[chatId].status === 'waiting_for_support') {
        const adminMsg = `📩 **New Support Message**\n👤 Name: ${msg.from.first_name}\n🆔 ID: ${chatId}\n💬 Message: ${text}\n\n👉 **How to reply?**\n\`/reply ${chatId} Your Message Here\` `;
        bot.sendMessage(adminChatId, adminMsg, {parse_mode: 'Markdown'}); 
        bot.sendMessage(chatId, "✅ Your message has been received. We will reply shortly!");
        userStates[chatId].status = 'idle'; return;
    }

    if (userStates[chatId].status === 'waiting_for_contact' && msg.contact) {
        userStates[chatId].phone = msg.contact.phone_number; userStates[chatId].status = 'waiting_for_address_only';
        bot.sendMessage(chatId, "✅ Number verified! Please type and send your complete Delivery Address:", { reply_markup: { remove_keyboard: true } }); return;
    }
    if (userStates[chatId].status === 'waiting_for_contact' && !msg.contact) return bot.sendMessage(chatId, "Please click the '📲 Share Contact' button below.");

    if (userStates[chatId].status === 'waiting_for_address_only') {
        userStates[chatId].tempAddress = `${msg.from.first_name || "Customer"}, ${text} (Phone: ${userStates[chatId].phone})`;
        if (userStates[chatId].deliveryType === 'Home Delivery') {
            await Profile.findOneAndUpdate({ chatId: chatId }, { address: userStates[chatId].tempAddress }, { upsert: true });
        }
        userStates[chatId].status = 'waiting_for_promo';
        bot.sendMessage(chatId, "🏷️ Do you have a Promo Code?\nType the code below, or click 'Skip':", { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip Promo', callback_data: 'skip_promo' }]] } }); return;
    }

    if (userStates[chatId].status === 'waiting_for_promo') {
        let promo = await Promo.findOne({ code: text.toUpperCase() });
        if (promo) {
            userStates[chatId].discount = promo.discount; userStates[chatId].promoName = promo.code;
            bot.sendMessage(chatId, `🎉 Awesome! Promo code applied. You saved ₹${promo.discount}.`);
        } else {
            bot.sendMessage(chatId, "❌ Invalid Promo Code. Proceeding without discount.");
        }
        await checkWalletAndProceed(chatId); return;
    }

    if (userStates[chatId].status === 'waiting_for_quantity') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return bot.sendMessage(chatId, "Please enter a valid number:");
        const product = await Product.findOne({ id: userStates[chatId].tempProductId });
        if (product) {
            let existingQty = 0;
            const existingItem = userStates[chatId].cart.find(p => p.id === product.id);
            if (existingItem) existingQty = existingItem.qty;
            if ((existingQty + qty) > (product.stock || 100)) return bot.sendMessage(chatId, `⚠️ Sorry, we only have ${product.stock} units of this item left in stock.`);
            
            if (existingItem) existingItem.qty += qty; else userStates[chatId].cart.push({ ...product.toObject(), qty: qty });
            bot.sendMessage(chatId, `✅ Added ${qty} x ${product.name} to cart!`, { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
        }
        userStates[chatId].status = 'idle'; return;
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 
    initUser(chatId);

    if (data === 'refer_earn') {
        const referLink = `https://t.me/${myBotUsername}?start=${chatId}`;
        const referMsg = `🎁 **Refer & Earn ₹20!**\n\nShare this link with your friends and neighbors on WhatsApp. \nAs soon as someone joins our store using this link, **both you and your friend will receive ₹20 free Kirana Wallet balance!**\n\n👇 Copy your link below:\n${referLink}`;
        bot.sendMessage(chatId, referMsg, {parse_mode: 'Markdown'});
        return;
    }

    if (data === 'use_wallet') {
        let walletData = await Wallet.findOne({ chatId: chatId });
        userStates[chatId].walletUsed = walletData ? walletData.balance : 0;
        userStates[chatId].status = 'waiting_for_payment'; sendPaymentOptions(chatId); return;
    }
    if (data === 'skip_wallet') {
        userStates[chatId].walletUsed = 0; userStates[chatId].status = 'waiting_for_payment'; sendPaymentOptions(chatId); return;
    }

    if (data === 'support_chat') {
        userStates[chatId].status = 'waiting_for_support'; bot.sendMessage(chatId, "💬 Please type your question or issue here:"); return;
    }

    if (data.startsWith('status_')) {
        const parts = data.split('_'); const status = parts[1]; const custChatId = parts[2]; const orderId = parts[3];
        let order = await Order.findOne({ id: orderId });
        if(order) { 
            order.status = status; await order.save(); 
        }
        let msg = "";
        if (status === 'PACKED') msg = `📦 Your order (ID: ${orderId}) has been packed!`;
        if (status === 'OUT') msg = `🚚 Your order is out for delivery.`;
        if (status === 'DELIVERED') msg = `✅ Your order has been successfully delivered. Thank you!`;
        bot.sendMessage(custChatId, msg); bot.sendMessage(chatId, `✅ Status updated to ${status}`); return;
    }

    if (data.startsWith('add_') || data === 'checkout_delivery' || data === 'checkout_pickup') {
        if (!isStoreOpen()) return bot.sendMessage(chatId, "🌙 Sorry, our store is currently closed. Operating hours are 8 AM to 10 PM.");
    }

    if (data === 'skip_promo') {
        userStates[chatId].discount = 0; userStates[chatId].promoName = ''; await checkWalletAndProceed(chatId);
    }
    else if (data === 'repeat_order') {
        const lastOrder = await Order.findOne({ chatId: chatId }).sort({ _id: -1 });
        if (lastOrder && lastOrder.items) {
            userStates[chatId].cart = [...lastOrder.items]; bot.sendMessage(chatId, "🔄 Your previous order has been added to the cart!", { reply_markup: { inline_keyboard: [[{ text: '🛒 View Cart', callback_data: 'view_cart' }]] } });
        } else bot.sendMessage(chatId, "❌ We couldn't find any previous orders for you.");
    }
    else if (data === 'search_product') {
        userStates[chatId].status = 'waiting_for_search'; bot.sendMessage(chatId, "🔍 Type the product name:");
    }
    else if (data === 'browse_categories') {
        const products = await Product.find({});
        if (products.length === 0) return bot.sendMessage(chatId, "Store is empty. Please add products via Admin Dashboard.");
        const categories = [...new Set(products.map(p => p.category))];
        const categoryButtons = categories.map(cat => [{ text: `📂 ${cat}`, callback_data: `cat_${cat}` }]);
        bot.sendMessage(chatId, "Choose a category:", { reply_markup: { inline_keyboard: categoryButtons } });
    } 
    else if (data.startsWith('cat_')) {
        userStates[chatId].currentCategory = data.replace('cat_', ''); userStates[chatId].categoryPage = 0; await sendCategoryBatch(chatId);
    }
    else if (data === 'next_page') {
        userStates[chatId].categoryPage += 1; await sendCategoryBatch(chatId);
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
        let profile = await Profile.findOne({ chatId: chatId });
        if (profile && profile.address) {
            bot.sendMessage(chatId, `🏠 Save Address:\n${profile.address}\nUse this?`, { reply_markup: { inline_keyboard: [ [{ text: '✅ Yes', callback_data: 'use_saved_address' }], [{ text: '📝 New Address', callback_data: 'enter_new_address' }] ] } });
        } else {
            userStates[chatId].status = 'waiting_for_contact'; 
            bot.sendMessage(chatId, "📲 Please share your verified phone number:", { reply_markup: { keyboard: [[{ text: '📲 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
        }
    }
    else if (data === 'use_saved_address') {
        let profile = await Profile.findOne({ chatId: chatId });
        userStates[chatId].tempAddress = profile.address; userStates[chatId].status = 'waiting_for_promo';
        bot.sendMessage(chatId, "🏷️ Do you have a Promo Code?\nType the code below, or click 'Skip':", { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip Promo', callback_data: 'skip_promo' }]] } });
    }
    else if (data === 'enter_new_address') {
        userStates[chatId].status = 'waiting_for_contact'; 
        bot.sendMessage(chatId, "📲 Please share your verified phone number:", { reply_markup: { keyboard: [[{ text: '📲 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    }
    else if (data === 'checkout_pickup') {
        userStates[chatId].deliveryType = 'Store Pickup'; userStates[chatId].status = 'waiting_for_pickup_name'; bot.sendMessage(chatId, "Send Name and Phone:");
    }
    
    else if (data === 'pay_upi' || data === 'pay_cash') {
        let orderId = `ORD_${Date.now()}`; let paymentMode = data === 'pay_upi' ? 'UPI' : 'Cash';
        
        await Order.create({
            id: orderId, chatId: chatId, date: new Date().toLocaleString(), status: 'PENDING', 
            customer_details: userStates[chatId].tempAddress, delivery_type: userStates[chatId].deliveryType,
            payment_mode: paymentMode, items: userStates[chatId].cart, 
            delivery_fee: userStates[chatId].deliveryFee, discount: userStates[chatId].discount, 
            wallet_used: userStates[chatId].walletDeduction, total: userStates[chatId].finalTotal
        });

        for (let cartItem of userStates[chatId].cart) {
            await Product.findOneAndUpdate({ id: cartItem.id }, { $inc: { stock: -cartItem.qty } });
        }

        if (userStates[chatId].walletDeduction > 0) {
            await Wallet.findOneAndUpdate({ chatId: chatId }, { $inc: { balance: -userStates[chatId].walletDeduction } });
        }
        
        let cashbackEarned = Math.round(userStates[chatId].finalTotal * 0.05); 
        if (cashbackEarned > 0) {
            await Wallet.findOneAndUpdate({ chatId: chatId }, { $inc: { balance: cashbackEarned } }, { upsert: true });
        }

        if (paymentMode === 'UPI') {
            const upiLink = `upi://pay?pa=${myUpiId}&pn=${myStoreName.replace(/ /g, '%20')}&am=${userStates[chatId].finalTotal}`;
            bot.sendMessage(chatId, `🎉 Order Saved! (ID: ${orderId})\nLink to pay ₹${userStates[chatId].finalTotal}:\n${upiLink}`);
        } else {
            bot.sendMessage(chatId, `🎉 Order Confirmed! (ID: ${orderId})\nKeep ₹${userStates[chatId].finalTotal} cash ready!`);
        }

        if (cashbackEarned > 0) bot.sendMessage(chatId, `🎁 **Congratulations!** You have received a cashback of ₹${cashbackEarned}!`, {parse_mode: 'Markdown'});

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
