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

const savedSession = "1BQANOTEuMTA4LjU2LjEyNgG7KDOESQ3XBdQTSCEP8DoKSuL4aNa43T2IlWl7FYtA/V0ztSL3NOo7Ma1g6sro3QYykFst4P6EvfdFlgCd13BhHU415BlghLlbauWU5mkgUSKOnq9562pL41HJnt+Wh1d+6iLM+7+MAcUk9F7Pf91UQ8raTtJyEgj9AIFVdbKkzoNfLBSlIklBglNKfvfUUxhzky8OYo911tfsPuOjoXtKdngQDlTuf21DnO3rmn/vBIFqFlclCqaqLN1ycD6SjOYqCiBFw6GsP7eDBcu799XpPVEWxSi5/NA+dMsgiTanjqouhM1imNQa6TX7N0UcZo0VgzaWVypB52wfh0gAXtcd4A==";

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
}, new NewMessage({ chats: [CHANNEL] }));

    console.log(`Monitoring channel: ${CHANNEL}`);
}

main().catch(console.error);
