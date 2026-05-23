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
// 🗄️ DATABASE SETUP (JSON File)
// ==========================================
const dbPath = path.join(__dirname, 'products.json');

function getProducts() {
    if (fs.existsSync(dbPath)) {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    }
    return [];
}

function saveProducts(productsArray) {
    fs.writeFileSync(dbPath, JSON.stringify(productsArray, null, 2));
}

// ==========================================
// 🌐 WEB DASHBOARD (FRONTEND & SERVER)
// ==========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.post('/add-product', (req, res) => {
    const products = getProducts();

    const newProduct = {
        name: req.body.name,
        price: req.body.price,
        image: req.body.image,
        id: `prod_${Date.now()}` 
    };
    
    products.push(newProduct); 
    saveProducts(products); 
    
    console.log("New Product Added & Saved to DB:", newProduct.name);
    
    res.send('<div style="text-align:center; margin-top:50px; font-family:Arial;"><h2>✅ Product Added Successfully!</h2><a href="/" style="text-decoration:none; color:blue;">Go Back to Dashboard</a></div>');
});

app.listen(3000, () => {
    console.log("=========================================");
    console.log("🗄️ Database is Connected!");
    console.log("🌐 Web Dashboard is running at: http://localhost:3000");
    console.log("🤖 Telegram Bot is listening for new messages...");
    console.log("=========================================");
});

// ==========================================
// 🤖 TELEGRAM BOT LOGIC (BACKEND)
// ==========================================

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (userStates[chatId] && userStates[chatId].status === 'waiting_for_address') {
        const productId = userStates[chatId].productId;
        
        // 🛠️ FIX: Database se product ki details nikalna
        const products = getProducts();
        const orderedProduct = products.find(p => p.id === productId);
        
        const productName = orderedProduct ? orderedProduct.name : "Unknown Product";
        const productPrice = orderedProduct ? orderedProduct.price : "N/A";

        const customerName = msg.from.first_name || "Customer";
        const username = msg.from.username ? `@${msg.from.username}` : "No username";
        
        bot.sendMessage(chatId, "🎉 Congratulations! Your order has been successfully placed.\nOur team will contact you shortly!");
        
        // 🛠️ FIX: Admin Alert mein Product ka Naam aur Price add kiya
        const adminAlert = `🚨 NEW ORDER RECEIVED! 🚨\n\n👤 Customer: ${customerName} (${username})\n📦 Product: ${productName}\n💰 Price: ₹${productPrice}\n📍 Address/Details: ${text}`;
        
        bot.sendMessage(adminChatId, adminAlert);
        
        delete userStates[chatId];
        return; 
    }

    if (text === '/start') {
        const menuOptions = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛍️ View Catalog', callback_data: 'show_catalog' }],
                    [{ text: '📞 Help / Contact Us', callback_data: 'contact_us' }]
                ]
            }
        };
        bot.sendMessage(chatId, "Welcome to My Store! 🙏 Please choose an option below:", menuOptions);
    } 
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data; 

    if (data === 'show_catalog') {
        const products = getProducts();

        if (products.length === 0) {
            bot.sendMessage(chatId, "Oops! Currently, there are no products in our store. Please check back later.");
            return;
        }

        products.forEach(product => {
            const options = {
                caption: `📦 Product: ${product.name}\n💰 Price: ₹${product.price}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛒 Order Now', callback_data: `buy_${product.id}` }]
                    ]
                }
            };
            bot.sendPhoto(chatId, product.image, options);
        });
    } 
    else if (data === 'contact_us') {
        bot.sendMessage(chatId, "You can email us at: support@mystore.com");
    }
    else if (data.startsWith('buy_')) {
        // 🛠️ FIX: Product ID sahi se nikalne ke liye replace use kiya
        const productId = data.replace('buy_', ''); 
        userStates[chatId] = { status: 'waiting_for_address', productId: productId };
        bot.sendMessage(chatId, "Great choice! 🤩\nPlease send your Full Name, Delivery Address, and Phone Number in a single message:");
    }
});