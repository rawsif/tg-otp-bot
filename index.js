require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { Telegraf, Markup, session } = require("telegraf");

const {
    BOT_TOKEN = "8859133558:AAHQYxh_-ybGhrKTLSsHtM8tgfJVv67FEx8",
    API_URL = "https://axnumberserver.shop/number/api",
    API_KEY,
    PORT = 3000
} = process.env;

if (!BOT_TOKEN || !API_KEY) {
    throw new Error("Missing BOT_TOKEN or API_KEY environment variable.");
}

// =====================================================
// EXPRESS SERVER
// =====================================================

const app = express();

app.get("/", (req, res) => {
    res.status(200).send("Reseller Bot is running.");
});

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server listening on port ${PORT}`);
});

// =====================================================
// RESELLER API
// =====================================================

const api = axios.create({
    baseURL: API_URL,
    timeout: 15000
});

async function apiRequest(action, params = {}) {
    const response = await api.get("", {
        params: {
            key: API_KEY,
            action,
            ...params
        }
    });

    const data = response.data;

    if (!data || typeof data !== "object") {
        throw new Error("Invalid API response.");
    }

    if (
        !Array.isArray(data) &&
        (data.status === "error" || data.success === false)
    ) {
        throw new Error(data.message || "API request failed.");
    }

    return data;
}

function normalizeItems(data, wrappers = []) {
    if (Array.isArray(data)) {
        return data.map((value, index) => ({
            key: String(
                value && typeof value === "object"
                    ? value.key ?? value.id ?? value.code ?? index
                    : value
            ),
            value
        }));
    }

    if (!data || typeof data !== "object") {
        return [];
    }

    for (const wrapper of wrappers) {
        if (
            data[wrapper] &&
            typeof data[wrapper] === "object"
        ) {
            return normalizeItems(data[wrapper]);
        }
    }

    return Object.entries(data).map(([key, value]) => ({
        key,
        value
    }));
}

function displayName(key, value) {
    if (value && typeof value === "object") {
        return String(value.text_en || value.name || key);
    }

    return String(key);
}

function makeKeyboard(items, prefix, labelFunction, backButton) {
    const rows = [];

    for (const item of items) {
        const callbackData = `${prefix}:${item.key}`;

        if (Buffer.byteLength(callbackData, "utf8") > 64) {
            continue;
        }

        rows.push([
            Markup.button.callback(
                String(labelFunction(item)).slice(0, 60),
                callbackData
            )
        ]);
    }

    if (backButton) {
        rows.push([
            Markup.button.callback(
                backButton.text,
                backButton.callback
            )
        ]);
    }

    return Markup.inlineKeyboard(rows);
}

// =====================================================
// TELEGRAM BOT
// =====================================================

const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

bot.use(async (ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
});

async function safeEdit(ctx, text, extra = {}) {
    try {
        await ctx.editMessageText(text, extra);
    } catch (error) {
        if (String(error.message).includes("message is not modified")) {
            return;
        }

        if (String(error.message).includes("message can't be edited")) {
            await ctx.reply(text, extra);
            return;
        }

        throw error;
    }
}

async function showHome(ctx, edit = false) {
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🌍 Countries", "countries")],
        [Markup.button.callback("📋 Current Selection", "my_session")]
    ]);

    const text = [
        "🤖 RESELLER BOT",
        "",
        "Browse available countries, services, and operators.",
        "",
        "Select an option below."
    ].join("\n");

    if (edit) {
        await safeEdit(ctx, text, keyboard);
    } else {
        await ctx.reply(text, keyboard);
    }
}

bot.start(async (ctx) => {
    ctx.session = {
        country: null,
        product: null
    };

    await showHome(ctx);
});

bot.command("menu", async (ctx) => {
    await showHome(ctx);
});

// =====================================================
// COUNTRY MENU
// =====================================================

bot.action("countries", async (ctx) => {
    await ctx.answerCbQuery();

    try {
        const data = await apiRequest("countries");

        const countries = normalizeItems(data, ["data", "countries"]);

        if (!countries.length) {
            await safeEdit(ctx, "No countries are currently available.");
            return;
        }

        const keyboard = makeKeyboard(
            countries,
            "country",
            ({ key, value }) => `🌍 ${displayName(key, value)}`,
            { text: "⬅️ Main Menu", callback: "home" }
        );

        await safeEdit(
            ctx,
            "🌍 SELECT A COUNTRY\n\nChoose a country:",
            keyboard
        );
    } catch (error) {
        console.error("Country request failed:", error.message);
        await safeEdit(
            ctx,
            "⚠️ Unable to load countries. Please try again later."
        );
    }
});

// =====================================================
// SERVICE MENU
// =====================================================

bot.action(/^country:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const country = ctx.match[1];

    ctx.session.country = country;
    ctx.session.product = null;

    try {
        const data = await apiRequest("products", { country });

        const products = normalizeItems(data, ["data", "products"]);

        if (!products.length) {
            await safeEdit(
                ctx,
                `No services are currently available for ${country}.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Countries", "countries")]
                ])
            );
            return;
        }

        const keyboard = makeKeyboard(
            products,
            "product",
            ({ key, value }) => {
                if (value && typeof value === "object") {
                    const stock = value.Qty ?? value.qty ?? "?";
                    return `📦 ${displayName(key, value)} · Stock: ${stock}`;
                }

                return `📦 ${key}`;
            },
            { text: "⬅️ Countries", callback: "countries" }
        );

        await safeEdit(
            ctx,
            `🌍 COUNTRY: ${displayName(country, null)}\n\nSelect a service:`,
            keyboard
        );
    } catch (error) {
        console.error("Product request failed:", error.message);
        await safeEdit(ctx, "⚠️ Unable to load services. Please try again.");
    }
});

// =====================================================
// OPERATOR MENU
// =====================================================

bot.action(/^product:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const product = ctx.match[1];
    const country = ctx.session.country;

    if (!country) {
        await safeEdit(
            ctx,
            "Your session has expired. Send /start to begin again."
        );
        return;
    }

    ctx.session.product = product;

    try {
        const data = await apiRequest("operators", {
            country,
            product
        });

        const operators = normalizeItems(data, ["data", "operators"]);

        if (!operators.length) {
            await safeEdit(
                ctx,
                "No operators are currently available.",
                Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Services", `country:${country}`)],
                    [Markup.button.callback("🏠 Main Menu", "home")]
                ])
            );
            return;
        }

        const lines = [
            "📋 OPERATOR AVAILABILITY",
            "",
            `🌍 Country: ${country}`,
            `📦 Service: ${product}`,
            ""
        ];

        for (const { key, value } of operators) {
            const details =
                value && typeof value === "object"
                    ? {
                        name: displayName(key, value),
                        price: value.customer_price ?? value.Price ?? "N/A",
                        stock: value.available_count ?? value.Qty ?? 0
                    }
                    : {
                        name: key,
                        price: "N/A",
                        stock: "N/A"
                    };

            lines.push(
                `• ${details.name}`,
                `  Price: ${details.price}`,
                `  Available: ${details.stock}`,
                ""
            );
        }

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("⬅️ Services", `country:${country}`)],
            [Markup.button.callback("🌍 Countries", "countries")],
            [Markup.button.callback("🏠 Main Menu", "home")]
        ]);

        await safeEdit(ctx, lines.join("\n").slice(0, 4000), keyboard);
    } catch (error) {
        console.error("Operator request failed:", error.message);
        await safeEdit(ctx, "⚠️ Unable to load operators. Please try again.");
    }
});

// =====================================================
// CURRENT SESSION
// =====================================================

bot.action("my_session", async (ctx) => {
    await ctx.answerCbQuery();

    const country = ctx.session.country || "Not selected";
    const product = ctx.session.product || "Not selected";

    await safeEdit(
        ctx,
        [
            "📋 CURRENT SELECTION",
            "",
            `🌍 Country: ${country}`,
            `📦 Service: ${product}`
        ].join("\n"),
        Markup.inlineKeyboard([
            [Markup.button.callback("🌍 Countries", "countries")],
            [Markup.button.callback("🏠 Main Menu", "home")]
        ])
    );
});

// =====================================================
// MAIN MENU NAVIGATION
// =====================================================

bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    await showHome(ctx, true);
});

// =====================================================
// ERROR HANDLING
// =====================================================

bot.catch((error, ctx) => {
    console.error(
        `Bot error for update ${ctx.update.update_id}:`,
        error.message
    );
});

bot.launch()
    .then(() => console.log("Telegram bot started successfully."))
    .catch((error) => {
        console.error("Failed to start Telegram bot:", error.message);
        process.exit(1);
    });

async function shutdown(signal) {
    console.log(`${signal} received. Shutting down...`);

    bot.stop(signal);

    server.close(() => {
        process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
