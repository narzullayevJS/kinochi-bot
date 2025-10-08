require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

const MOVIES_FILE = path.join(__dirname, 'movies.json');
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

if (!BOT_TOKEN) {
  console.error('Please set BOT_TOKEN in .env');
  process.exit(1);
}
if (!ADMIN_TELEGRAM_ID) {
  console.error('Please set ADMIN_TELEGRAM_ID in .env');
  process.exit(1);
}

function loadMovies() {
  try {
    const raw = fs.readFileSync(MOVIES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}
function saveMovies(movies) {
  fs.writeFileSync(MOVIES_FILE, JSON.stringify(movies, null, 2));
}

if (!fs.existsSync(MOVIES_FILE)) saveMovies({});
const movies = loadMovies();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Telegram bot started');

const adminStates = {};
function isAdminTelegramId(id) {
  return id && id.toString() === ADMIN_TELEGRAM_ID.toString();
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '🎥 Salom! Kinoning raqamini yuboring (masalan 202)');
});

bot.onText(/\/addmovie/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminTelegramId(msg.from.id)) {
    return bot.sendMessage(chatId, '❌ Siz admin emassiz.');
  }
  adminStates[chatId] = { step: 'wait_id', temp: {} };
  bot.sendMessage(chatId, 'Kino ID kiriting (masalan 202):');
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (adminStates[chatId]) {
    const state = adminStates[chatId];

    if (state.step === 'wait_id') {
      // ✅ Dublikat kino tekshiruvi — agar shu ID bor bo‘lsa, kino qo‘shilmaydi
      if (movies[text]) {
        delete adminStates[chatId];
        return bot.sendMessage(chatId, `⚠️ ${text} kodli kino allaqachon mavjud!`);
      }
      state.temp.id = text;
      state.step = 'wait_title';
      return bot.sendMessage(chatId, 'Kino title yuboring:');
    }
    if (state.step === 'wait_title') {
      state.temp.title = text;
      state.step = 'wait_desc';
      return bot.sendMessage(chatId, 'Kino description yuboring (yoki skip):');
    }
    if (state.step === 'wait_desc') {
      state.temp.description = text.toLowerCase() === 'skip' ? '' : text;
      state.step = 'wait_year';
      return bot.sendMessage(chatId, 'Chiqarilgan yili (yoki skip):');
    }
    if (state.step === 'wait_year') {
      state.temp.year = text.toLowerCase() === 'skip' ? '' : text;
      const id = state.temp.id.toString();
      movies[id] = {
        title: state.temp.title,
        description: state.temp.description,
        year: state.temp.year,
        file_id: ''
      };
      saveMovies(movies);
      bot.sendMessage(chatId, `✅ Kino qo'shildi: ${id} - ${movies[id].title}\nEndi video fayl yuboring (ixtiyoriy).`);
      delete adminStates[chatId];
      return;
    }
  }

  const maybeNum = text.match(/^(\d{1,6})$/);
  if (maybeNum) {
    const id = maybeNum[1];
    const mv = movies[id];
    if (!mv) return bot.sendMessage(chatId, `❌ ${id} raqamli kino topilmadi.`);

    let caption = `🎬 <b>${mv.title}</b>\n`;
    if (mv.year) caption += `Yili: ${mv.year}\n`;
    if (mv.description) caption += `\n${mv.description}\n`;
    caption += `\nID: ${id}`;

    if (mv.file_id && mv.file_id !== '') {
      return bot.sendVideo(chatId, mv.file_id, { caption, parse_mode: 'HTML' });
    } else {
      return bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
    }
  }
});

// Admin video yuklaganda saqlash
bot.on('video', (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminTelegramId(msg.from.id)) return;

  const video = msg.video;
  const fileId = video.file_id;

  bot.sendMessage(chatId, 'Kino ID ni kiriting (shu videoga mos):');

  const listener = (ans) => {
    const movieId = ans.text.trim();
    if (movies[movieId]) {
      movies[movieId].file_id = fileId;
      saveMovies(movies);
      bot.sendMessage(chatId, `🎥 Video saqlandi! Kino ID: ${movieId}`);
    } else {
      bot.sendMessage(chatId, '❌ Bunday ID topilmadi. Avval kino qo‘shing.');
    }
    bot.removeListener('message', listener);
  };

  bot.on('message', listener);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stopPolling();
  process.exit();
});
