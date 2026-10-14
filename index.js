const { Telegraf, Markup } = require('telegraf');
const express = require('express');

// API Configuration
const API_BASE = "https://axnumberserver.shop/number/api";
const API_KEY = "3fc9716c1eccdd7cf02bdc83f8e23b974b0bf475";

const BOT_TOKEN = process.env.BOT_TOKEN || "8859133558:AAEfN1MvkIIcdAHeNFii2rsa7GOk60LvmbY";
const bot = new Telegraf(BOT_TOKEN);

// Helper function for API requests
async function apiRequest(params) {
    let url = `${API_BASE}?key=${API_KEY}`;
    for (const [k, v] of Object.entries(params)) {
        url += `&${k}=${encodeURIComponent(v)}`;
    }
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (err) {
        console.error(`API Error [${params.action}]:`, err);
        return null;
    }
}

// Mask phone numbers to prevent scraping
function maskNumber(phone) {
    if (!phone || phone.length < 8) return "***";
    return phone.slice(0, 4) + "***" + phone.slice(-4);
}

// Main Menu Markup
const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📱 Buy Paid Number', 'menu_buy')],
    [Markup.button.callback('🌐 Free Temporary Numbers', 'menu_free_numbers')],
    [Markup.button.callback('📨 Latest Public SMS', 'menu_free_sms')]
]);

// Bot Handlers
bot.start(async (ctx) => {
    await ctx.reply("🤖 <b>Welcome to the Reseller Number & SMS Bot!</b>\n\nSelect an option below:", {
        parse_mode: 'HTML',
        ...mainMenuKeyboard
    });
});

bot.action('main_menu', async (ctx) => {
    await ctx.editMessageText("🤖 <b>Welcome to the Reseller Number & SMS Bot!</b>\n\nSelect an option below:", {
        parse_mode: 'HTML',
        ...mainMenuKeyboard
    });
});

bot.action('menu_buy', async (ctx) => {
    await ctx.editMessageText("⏳ Fetching supported countries...");
    const countries = await apiRequest({ action: 'countries' });

    if (!countries || typeof countries !== 'object') {
        return ctx.editMessageText("❌ Failed to fetch countries.", {
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'main_menu')]])
        });
    }

    let buttons = [];
    let row = [];
    for (const [code, data] of Object.entries(countries)) {
        const name = (typeof data === 'object' && data.text_en) ? data.text_en : code.charAt(0).toUpperCase() + code.slice(1);
        row.push(Markup.button.callback(name, `country_${code}`));
        if (row.length === 2) {
            buttons.push(row);
            row = [];
        }
    }
    if (row.length > 0) buttons.push(row);
    buttons.push([Markup.button.callback('« Back', 'main_menu')]);

    await ctx.editMessageText("🌍 <b>Select a Country:</b>", {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^country_(.+)$/, async (ctx) => {
    const country = ctx.match[1];
    await ctx.editMessageText(`⏳ Fetching services for <b>${country.toUpperCase()}</b>...`, { parse_mode: 'HTML' });
    
    const products = await apiRequest({ action: 'products', country });
    if (!products || typeof products !== 'object') {
        return ctx.editMessageText(`❌ No services available for ${country.toUpperCase()}.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'menu_buy')]])
        });
    }

    let buttons = [];
    for (const [prodKey, prodInfo] of Object.entries(products)) {
        const qty = (typeof prodInfo === 'object' && prodInfo.Qty !== undefined) ? prodInfo.Qty : '?';
        const price = (typeof prodInfo === 'object' && prodInfo.Price !== undefined) ? prodInfo.Price : '';
        const btnText = `${prodKey.toUpperCase()} (Stock: ${qty} | $${price})`;
        buttons.push([Markup.button.callback(btnText, `product_${country}_${prodKey}`)]);
    }
    buttons.push([Markup.button.callback('« Back', 'menu_buy')]);

    await ctx.editMessageText(`📦 <b>Select Service for ${country.toUpperCase()}:</b>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^product_(.+)_(.+)$/, async (ctx) => {
    const country = ctx.match[1];
    const product = ctx.match[2];
    await ctx.editMessageText(`⏳ Fetching operators for <b>${product.toUpperCase()}</b> (${country.toUpperCase()})...`, { parse_mode: 'HTML' });

    const operators = await apiRequest({ action: 'operators', country, product });
    let buttons = [];

    if (Array.isArray(operators) && operators.length > 0) {
        for (const op of operators) {
            const opName = op.operator || 'any';
            const price = op.customer_price || '0.00';
            const count = op.available_count || 0;
            const btnText = `Op: ${opName.toUpperCase()} | $${price} | Stock: ${count}`;
            buttons.push([Markup.button.callback(btnText, `buy_${country}_${product}_${opName}`)]);
        }
    } else {
        buttons.push([Markup.button.callback("Buy with Any Operator (Auto)", `buy_${country}_${product}_any`)]);
    }
    buttons.push([Markup.button.callback('« Back', `country_${country}`)]);

    await ctx.editMessageText(`🔧 <b>Select Operator:</b>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.action(/^buy_(.+)_(.+)_(.+)$/, async (ctx) => {
    const country = ctx.match[1];
    const product = ctx.match[2];
    const operator = ctx.match[3];

    await ctx.editMessageText("⏳ Processing purchase and charging reseller balance...");
    const result = await apiRequest({ action: 'buy', country, product, operator });

    if (!result || result.status !== 'success') {
        const errReason = (result && result.message) ? result.message : 'Unknown error or insufficient balance.';
        return ctx.editMessageText(`❌ <b>Purchase Failed</b>\nReason: ${errReason}`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'main_menu')]])
        });
    }

    const orderId = result.order_id;
    const phone = result.phone;
    const opUsed = result.operator || operator;
    const price = result.price || 0.0;
    const balance = result.user_balance || 0.0;
    const maskedPhone = maskNumber(phone);

    const statusText = (
        `✅ <b>Number Purchased Successfully!</b>\n\n` +
        `📱 <b>Phone:</b> <code>${phone}</code> (Masked: ${maskedPhone})\n` +
        `🌍 <b>Country:</b> ${country.toUpperCase()}\n` +
        `📦 <b>Service:</b> ${product.toUpperCase()}\n` +
        `🔧 <b>Operator:</b> ${opUsed.toUpperCase()}\n` +
        `💰 <b>Price:</b> $${price}\n` +
        `💳 <b>New Balance:</b> $${balance}\n\n` +
        `⏳ Waiting for incoming SMS / OTP (Polling every 3s, timeout in 120s)...`
    );

    await ctx.editMessageText(statusText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🛑 Cancel & Refund', `cancel_${orderId}`)],
            [Markup.button.callback('✅ Finish Order', `finish_${orderId}`)]
        ])
    });

    pollSmsTask(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, orderId, phone, country, product);
});

async function pollSmsTask(ctx, chatId, messageId, orderId, phone, country, product) {
    let elapsed = 0;
    const timeout = 120000;
    const interval = 3000;

    while (elapsed < timeout) {
        await new Promise(resolve => setTimeout(resolve, interval));
        elapsed += interval;

        const res = await apiRequest({ action: 'check', order_id: orderId });
        if (!res) continue;

        const status = res.status;
        const smsText = res.sms || res.text || res.code || res.full_sms;

        if (smsText || ['received', 'success'].includes(status)) {
            const successText = (
                `🎉 <b>SMS / OTP Received!</b>\n\n` +
                `📱 <b>Phone:</b> <code>${phone}</code>\n` +
                `📦 <b>Service:</b> ${product.toUpperCase()} (${country.toUpperCase()})\n` +
                `💬 <b>Message / Code:</b>\n<code>${smsText}</code>\n\n` +
                `Order ID: ${orderId}`
            );
            try {
                await ctx.telegram.editMessageText(chatId, messageId, undefined, successText, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Finish Order', `finish_${orderId}`)],
                        [Markup.button.callback('« Main Menu', 'main_menu')]
                    ])
                });
            } catch (e) {
                console.error("Error updating message with SMS:", e);
            }
            return;
        }
    }

    await apiRequest({ action: 'cancel', order_id: orderId });
    const timeoutText = (
        `⏱️ <b>Timeout (120s) Reached - No SMS Received</b>\n\n` +
        `📱 <b>Phone:</b> <code>${phone}</code>\n` +
        `Order ID <code>${orderId}</code> has been automatically <b>canceled and refunded</b> to your reseller balance.`
    );
    try {
        await ctx.telegram.editMessageText(chatId, messageId, undefined, timeoutText, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Main Menu', 'main_menu')]])
        });
    } catch (e) {
        console.error("Error updating message on timeout:", e);
    }
}

bot.action(/^cancel_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery("Canceling order...");
    const res = await apiRequest({ action: 'cancel', order_id: orderId });
    
    let msg = `❌ Order <code>${orderId}</code> has been canceled and refunded.`;
    if (res && res.message) msg += `\nDetails: ${res.message}`;

    await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Main Menu', 'main_menu')]])
    });
});

bot.action(/^finish_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery("Finishing order...");
    const res = await apiRequest({ action: 'finish', order_id: orderId });

    let msg = `✅ Order <code>${orderId}</code> has been successfully finished and saved.`;
    if (res && res.message) msg += `\nDetails: ${res.message}`;

    await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Main Menu', 'main_menu')]])
    });
});

bot.action('menu_free_numbers', async (ctx) => {
    await ctx.editMessageText("⏳ Fetching free public temporary numbers...");
    const data = await apiRequest({ action: 'numbers' });

    let text = "🌐 <b>Free Public Temporary Numbers (Masked):</b>\n\n";
    if (!data) {
        text = "No free numbers available at the moment.";
    } else if (Array.isArray(data)) {
        for (const item of data.slice(0, 15)) {
            const phone = item.phone || item.number || 'N/A';
            const country = item.country || 'Unknown';
            text += `• <code>${maskNumber(phone)}</code> (${country.toUpperCase()})\n`;
        }
    } else if (typeof data === 'object') {
        for (const [k, v] of Object.entries(data).slice(0, 15)) {
            const phone = (typeof v === 'object' && (v.phone || v.number)) ? (v.phone || v.number) : String(v);
            text += `• <code>${maskNumber(phone)}</code> (${k})\n`;
        }
    } else {
        text += String(data);
    }

    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Main Menu', 'main_menu')]])
    });
});

bot.action('menu_free_sms', async (ctx) => {
    await ctx.editMessageText("⏳ Fetching latest free public SMS/OTP...");
    const data = await apiRequest({ action: 'sms' });

    let text = "📨 <b>Latest Free Public SMS / OTP (Masked):</b>\n\n";
    if (!data) {
        text = "No recent SMS messages found.";
    } else if (Array.isArray(data)) {
        for (const item of data.slice(0, 10)) {
            const phone = maskNumber(item.phone || '');
            const sms = item.sms || item.text || '';
            text += `📱 <code>${phone}</code>: ${sms}\n\n`;
        }
    } else if (typeof data === 'object') {
        for (const [k, v] of Object.entries(data).slice(0, 10)) {
            const phone = maskNumber(k);
            text += `📱 <code>${phone}</code>: ${v}\n\n`;
        }
    } else {
        text += String(data);
    }

    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Main Menu', 'main_menu')]])
    });
});

// Express App & Webhook Integration
const app = express();
const PORT = process.env.PORT || 3000;
const webhookPath = `/telegraf/${BOT_TOKEN}`;

// Handle incoming webhook requests from Telegram
app.use(bot.webhookCallback(webhookPath));

app.get('/', (req, res) => {
    res.send('Telegram Bot is active and running via Webhooks!');
});

app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);

    // If hosted on Render, automatically set the webhook URL using Render's domain
    if (process.env.RENDER_EXTERNAL_URL) {
        const fullWebhookUrl = `${process.env.RENDER_EXTERNAL_URL}${webhookPath}`;
        await bot.telegram.setWebhook(fullWebhookUrl);
        console.log(`Webhook successfully set to: ${fullWebhookUrl}`);
    } else {
        console.log("RENDER_EXTERNAL_URL not found. Running locally or webhook needs manual setup.");
    }
});
