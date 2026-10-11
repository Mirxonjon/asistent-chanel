import { connectDb, disconnectDb } from './db.js';
import { bot } from './bot.js';
import { config } from './config.js';
import { startScheduler, repairSchedules } from './scheduler.js';

await connectDb();

const me = await bot.telegram.getMe();
console.log(`✅ Bot ulandi: @${me.username}  (${me.first_name})`);
console.log(`   AI model: ${config.openaiModel}`);

// Telegram menyusida komandalar ko'rinib tursin
await bot.telegram
  .setMyCommands([
    { command: 'start', description: 'Boshlash' },
    { command: 'menyu', description: 'Asosiy menyu' },
    { command: 'kanal', description: 'Yangi kanal ulash' },
    { command: 'kanallarim', description: 'Ulangan kanallar' },
    { command: 'mavzu', description: 'Mavzu bo‘yicha post yozish' },
    { command: 'reja', description: 'Avtomatik post rejasi' },
    { command: 'bekor', description: 'Amalni bekor qilish' },
  ])
  .catch((err) => console.warn('⚠️  Komandalar ro‘yxati o‘rnatilmadi:', err.message));

// Bot o'chib turganda o'tib ketgan vaqtlarni tartibga solamiz
await repairSchedules();

startScheduler(bot);

// bot.launch() bot to'xtaguncha kutadi — shuning uchun await qilmaymiz
bot.launch();
console.log('🚀 Ishga tushdi. To‘xtatish: Ctrl+C\n');

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;

  console.log(`\n${signal} — to‘xtatilmoqda...`);
  try {
    bot.stop(signal);
  } catch {
    // allaqachon to'xtagan bo'lishi mumkin
  }
  await disconnectDb();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('❌ Ushlanmagan rejection:', reason?.message ?? reason);
});
