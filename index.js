const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { Api } = require("telegram");
const input = require("input");
const fs = require("fs");
const crypto = require("crypto");

const apiId = 38564953;
const apiHash = "55caa3ce808da805b803bf6661f457b3";

const CHANNEL = "klyx_news";
const TARGET_BOT = "klyxx_bot";
const SESSION_FILE = "telegram-session.txt";

const savedSession = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, "utf8").trim()
    : "";

const client = new TelegramClient(
    new StringSession(savedSession),
    apiId,
    apiHash,
    { connectionRetries: 5 }
);

async function main() {
    await client.start({
        phoneNumber: () => input.text("Phone number: "),
        phoneCode: () => input.text("Telegram login code: "),
        password: () => input.text("Two-step verification password: "),
        onError: console.error,
    });

    fs.writeFileSync(SESSION_FILE, client.session.save(), {
        mode: 0o600,
    });

    console.log("Login successful. Session saved automatically.");

    const channel = await client.getEntity(CHANNEL);
    const processed = new Set();

    client.addEventHandler(async (event) => {
        const message = event.message;

        if (!message?.buttons) return;

        const messageKey = `${message.chatId}-${message.id}`;
        if (processed.has(messageKey)) return;

        for (const row of message.buttons) {
            for (const button of row) {
                if (!button.url) continue;

                let url;
                try {
                    url = new URL(button.url);
                } catch {
                    continue;
                }

                if (!["t.me", "telegram.me"].includes(url.hostname)) {
                    continue;
                }

                const parts = url.pathname.split("/").filter(Boolean);

                if (parts[0]?.toLowerCase() !== TARGET_BOT) continue;

                const startParam = url.searchParams.get("start");
                if (!startParam) continue;

                processed.add(messageKey);

                try {
                    const bot = await client.getInputEntity(TARGET_BOT);

                    await client.invoke(
                        new Api.messages.StartBot({
                            bot,
                            peer: bot,
                            randomId: BigInt(
                                "0x" + crypto.randomBytes(8).toString("hex")
                            ),
                            startParam,
                        })
                    );

                    console.log(
                        `Started @${TARGET_BOT} with parameter: ${startParam}`
                    );
                } catch (error) {
                    processed.delete(messageKey);
                    console.error("Failed:", error.message);
                }

                return;
            }
        }
    }, new NewMessage({ chats: [channel] }));

    console.log(`Monitoring channel: ${CHANNEL}`);
}

main().catch(console.error);
