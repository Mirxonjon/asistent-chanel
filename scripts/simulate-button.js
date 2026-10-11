/**
 * Telegram'siz tugma bosishni taqlid qiladi.
 * Hech kimga xabar yuborilmaydi — hamma chaqiruv yozib olinadi.
 *
 *   node scripts/simulate-button.js
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { handleAutoTopic } from '../src/handlers/write.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });
console.log(`\nUser:   ${user.firstName} (${user.telegramId})`);
console.log(`Kanal:  "${channel.title}"  id=${channel._id}\n`);

const calls = [];
let fakeMsgId = 1000;

/** Haqiqiy ctx o'rniga — hamma narsani yozib oladi, hech narsa yubormaydi */
const ctx = {
  from: { id: user.telegramId, first_name: user.firstName, is_bot: false },
  chat: { id: user.telegramId },
  user,
  callbackQuery: { data: `write:auto:${channel._id}` },
  botInfo: { id: 1, username: 'postchi_AiBot' },

  async answerCbQuery(text) {
    calls.push(`answerCbQuery(${text ?? ''})`);
  },
  async sendChatAction(a) {
    calls.push(`sendChatAction(${a})`);
  },
  async reply(text) {
    calls.push(`reply("${String(text).slice(0, 60).replace(/\n/g, ' ')}...")`);
    return { chat: { id: user.telegramId }, message_id: ++fakeMsgId };
  },
  async editMessageText(text) {
    calls.push(`editMessageText("${String(text).slice(0, 40)}...")`);
  },
  telegram: {
    async sendMessage(chatId, text) {
      calls.push(`sendMessage(${chatId}, ${String(text).length} belgi)`);
      return { message_id: ++fakeMsgId };
    },
    async deleteMessage(chatId, id) {
      calls.push(`deleteMessage(${id})`);
    },
  },
};

console.log('🎲 "O‘zing tanla" tugmasi bosilmoqda...\n');

try {
  await handleAutoTopic(ctx, String(channel._id));
  console.log('✅ XATOSIZ O‘TDI\n');
} catch (err) {
  console.error('❌ XATO SHU YERDA:\n');
  console.error(`   nomi:   ${err.name}`);
  console.error(`   xabar:  ${err.message}`);
  if (err.status) console.error(`   status: ${err.status}`);
  if (err.code) console.error(`   kod:    ${err.code}`);
  console.error('\n--- stack ---');
  console.error(err.stack);
}

console.log('--- bajarilgan chaqiruvlar ---');
calls.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

await disconnectDb();
