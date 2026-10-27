// Setup:   npm i telegram input express
// Debug:   DEBUG=1 node monitor.js   (logs every message the account receives)

const express = require("express");
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { generateRandomBigInt } = require("telegram/Helpers");
const input = require("input");
const fs = require("fs");

const apiId = 38564953;
const apiHash = "55caa3ce808da805b803bf6661f457b3";

const SESSION_FILE = "telegram-session.txt";

// Uses the session saved by a previous login if there is one,
// otherwise falls back to the hardcoded session string below.
const SESSION = fs.existsSync(SESSION_FILE)
  ? fs.readFileSync(SESSION_FILE, "utf8").trim()
  : "1BQANOTEuMTA4LjU2LjEyNgG7KDOESQ3XBdQTSCEP8DoKSuL4aNa43T2IlWl7FYtA/V0ztSL3NOo7Ma1g6sro3QYykFst4P6EvfdFlgCd13BhHU415BlghLlbauWU5mkgUSKOnq9562pL41HJnt+Wh1d+6iLM+7+MAcUk9F7Pf91UQ8raTtJyEgj9AIFVdbKkzoNfLBSlIklBglNKfvfUUxhzky8OYo911tfsPuOjoXtKdngQDlTuf21DnO3rmn/vBIFqFlclCqaqLN1ycD6SjOYqCiBFw6GsP7eDBcu799XpPVEWxSi5/NA+dMsgiTanjqouhM1imNQa6TX7N0UcZo0VgzaWVypB52wfh0gAXtcd4A==";

const CHANNEL = "klyx_news";
const TARGET_BOT = "klyxx_bot";
const DEBUG = process.env.DEBUG === "1";

// Test channel: any new message here (even your own) gets a reply in the same channel.
const TEST_CHANNEL = "testerx2026";
const TEST_REPLY = "Bot is working";

// Used when the code is plain text, e.g. "Activation code: ABC123".
// ADJUST this to match the real message format.
const TEXT_CODE_REGEX = /code\s*[:\-]?\s*`?([A-Za-z0-9_-]{4,})/i;

// ---------- keep-alive web server ----------
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.status(200).send("Telegram monitor is running."));
app.listen(PORT, "0.0.0.0", () => console.log(`Express server running on port ${PORT}`));

// ---------- helpers ----------
function codeFromLink(link) {
  try {
    const url = new URL(link);
    let botName;

    if (["t.me", "telegram.me"].includes(url.hostname)) {
      botName = url.pathname.split("/").filter(Boolean)[0];
    } else if (url.protocol === "tg:" && url.hostname === "resolve") {
      botName = url.searchParams.get("domain");
    } else {
      return [];
    }

    if (botName?.toLowerCase() !== TARGET_BOT.toLowerCase()) return [];
    const param = url.searchParams.get("start");
    return param ? [param] : [];
  } catch {
    return [];
  }
}

function extractCodes(message) {
  const codes = [];

  // 1. Inline buttons (read replyMarkup directly; message.buttons can be undefined)
  for (const row of message.replyMarkup?.rows ?? []) {
    for (const button of row.buttons ?? []) {
      if (button.url) codes.push(...codeFromLink(button.url));
    }
  }

  // 2. Hyperlinked text
  for (const ent of message.entities ?? []) {
    if (ent instanceof Api.MessageEntityTextUrl && ent.url) {
      codes.push(...codeFromLink(ent.url));
    }
  }

  // 3. Raw links in the message text
  const text = message.message ?? "";
  for (const m of text.matchAll(/(?:https?|tg):\/\/[^\s)]+/gi)) {
    codes.push(...codeFromLink(m[0]));
  }

  // 4. Plain-text code
  const plain = text.match(TEXT_CODE_REGEX);
  if (plain) codes.push(plain[1]);

  return [...new Set(codes)];
}

async function startBotWith(client, code) {
  const bot = await client.getInputEntity(TARGET_BOT);
  await client.invoke(
    new Api.messages.StartBot({
      bot,
      peer: bot,
      randomId: generateRandomBigInt(),
      startParam: code,
    })
  );
}

// ---------- main ----------
async function main() {
  const client = new TelegramClient(new StringSession(SESSION), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => input.text("Phone number: "),
    phoneCode: () => input.text("Telegram login code: "),
    password: () => input.text("Two-step verification password: "),
    onError: console.error,
  });

  fs.writeFileSync(SESSION_FILE, client.session.save(), { mode: 0o600 });
  console.log("Login successful. Session saved automatically.");

  const channel = await client.getEntity(CHANNEL);
  const channelId = channel.id.toString();
  await client.getDialogs({ limit: 100 }); // warms the cache so channel updates arrive

  let testChannel = null;
  let testChannelId = null;
  try {
    testChannel = await client.getEntity(TEST_CHANNEL);
    testChannelId = testChannel.id.toString();
  } catch (err) {
    console.error(`Could not resolve test channel ${TEST_CHANNEL}:`, err.message);
  }

  const processed = new Set();
  const sentIds = new Set(); // IDs of our own replies, so we never answer ourselves

  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message) return;

      // chatId for channels looks like -100<id>
      const chatId = String(message.chatId).replace(/^-100/, "");

      if (DEBUG) {
        console.log(
          `[incoming] chat=${message.chatId} id=${message.id} ` +
            `markup=${!!message.replyMarkup} text=${JSON.stringify((message.message ?? "").slice(0, 80))}`
        );
      }

      // ---- test channel: reply to any new message, including your own ----
      if (testChannelId && chatId === testChannelId) {
        // Skip our own reply, otherwise this would loop forever
        if (sentIds.has(message.id) || (message.message ?? "").trim() === TEST_REPLY) return;

        try {
          const sent = await client.sendMessage(testChannel, { message: TEST_REPLY });
          sentIds.add(sent.id);
          console.log(`Test channel: replied "${TEST_REPLY}" to message ${message.id}`);
        } catch (err) {
          console.error("Test reply failed:", err.message);
        }
        return;
      }

      // ---- main channel: look for activation codes ----
      if (chatId !== channelId) return;

      const key = `${chatId}-${message.id}`;
      if (processed.has(key)) return;

      const [code] = extractCodes(message);
      if (!code) return;

      processed.add(key);
      try {
        await startBotWith(client, code);
        console.log(`Started @${TARGET_BOT} with parameter: ${code}`);
      } catch (err) {
        processed.delete(key);
        console.error("StartBot failed:", err.message);
      }
    } catch (err) {
      console.error("Handler error:", err);
    }
  }, new NewMessage({}));

  console.log(`Monitoring channel: ${CHANNEL} (id ${channelId})`);
  if (testChannelId) console.log(`Test channel: ${TEST_CHANNEL} (id ${testChannelId})`);
}

main().catch(console.error);
