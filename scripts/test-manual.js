/**
 * "O'zim yozaman" sinovi — o'z mavzuingizni rejaga qo'yish.
 * Ikkala usul tekshiriladi: bir yo'la ("2 = matn") va ikki qadam.
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';
import { createPlan, handleManualNumber, handleManualTopic } from '../src/handlers/plan.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });

const replies = [];
const ctx = {
  from: { id: user.telegramId, first_name: user.firstName, is_bot: false },
  chat: { id: user.telegramId },
  user,
  callbackQuery: null,
  async answerCbQuery() {},
  async sendChatAction() {},
  async reply(t) {
    replies.push(String(t).split('\n')[0]);
    return { chat: { id: user.telegramId }, message_id: 1 };
  },
  async editMessageText() {},
  telegram: {
    async sendMessage() {
      return { message_id: 2 };
    },
    async deleteMessage() {},
  },
};

const list = () =>
  Post.find({ channelId: channel._id, status: 'planned' }).sort({ scheduledFor: 1 }).lean();

console.log(`\nKanal: "${channel.title}"\n`);

// --- Tayyorgarlik: 4 kunlik reja ---
console.log('Reja tuzilmoqda (4 kun)...');
await createPlan(ctx, String(channel._id), 4);
const before = await list();
before.forEach((p, i) => console.log(`  ${i + 1}. ${p.topic}`));

const problems = [];

// === 1-usul: bir yo'la "2 = matn" ===
console.log('\n1) Bir yo‘la:  "2 = Bitcoin yarimlanishi nima"');
ctx.user.state = { name: 'awaiting_manual_number', channelId: String(channel._id) };
await handleManualNumber(ctx, '2 = Bitcoin yarimlanishi nima');

let after = await list();
console.log(`   2-mavzu endi: "${after[1].topic}"`);
if (after[1].topic !== 'Bitcoin yarimlanishi nima') {
  problems.push('bir yo‘la usul ishlamadi');
}

// === 2-usul: ikki qadam ===
console.log('\n2) Ikki qadam:  "4"  →  "Fyuchers va spot farqi"');
ctx.user.state = { name: 'awaiting_manual_number', channelId: String(channel._id) };
await handleManualNumber(ctx, '4');

// handleManualNumber state ni o'zgartirdi — soxta ctx da qo'lda o'qiymiz
const fresh = await User.findById(user._id).lean();
ctx.user.state = fresh.state;
console.log(`   holat: ${fresh.state?.name}  (post #${fresh.state?.number})`);

await handleManualTopic(ctx, 'Fyuchers va spot farqi');

after = await list();
console.log(`   4-mavzu endi: "${after[3].topic}"`);
if (after[3].topic !== 'Fyuchers va spot farqi') {
  problems.push('ikki qadam usuli ishlamadi');
}

// === Tekshiruvlar ===
console.log('\n3) Tekshiruvlar:');

if (after.length !== before.length) problems.push('mavzular soni o‘zgarib ketdi');

// Tegilmagan mavzular joyida qolganmi
for (const i of [0, 2]) {
  if (after[i].topic !== before[i].topic) {
    problems.push(`${i + 1}-mavzu tegilmasligi kerak edi`);
  }
}

// Sanalar o'zgarmaganmi
const sameDates = before.every(
  (b, i) => b.scheduledFor.getTime() === after[i].scheduledFor.getTime()
);
if (!sameDates) problems.push('sanalar o‘zgarib ketdi');

// Juda qisqa mavzu rad etiladimi
ctx.user.state = { name: 'awaiting_manual_number', channelId: String(channel._id) };
replies.length = 0;
await handleManualNumber(ctx, '1 = ab');
after = await list();
if (after[0].topic === 'ab') problems.push('juda qisqa mavzu qabul qilindi');

// Noto'g'ri raqam rad etiladimi
ctx.user.state = { name: 'awaiting_manual_number', channelId: String(channel._id) };
await handleManualNumber(ctx, '99');
after = await list();
if (after.length !== before.length) problems.push('noto‘g‘ri raqam zarar yetkazdi');

if (problems.length) {
  console.log('   ❌ ' + problems.join('\n   ❌ '));
} else {
  console.log('   ✅ bir yo‘la usul ishladi');
  console.log('   ✅ ikki qadam usuli ishladi');
  console.log('   ✅ boshqa mavzular tegilmadi');
  console.log('   ✅ sanalar o‘zgarmadi');
  console.log('   ✅ qisqa mavzu va noto‘g‘ri raqam rad etildi');
}

console.log('\nYakuniy reja:');
(await list()).forEach((p, i) => console.log(`  ${i + 1}. ${p.topic}`));

await Post.deleteMany({ channelId: channel._id, status: 'planned' });
await User.updateOne({ _id: user._id }, { $set: { state: null } });
console.log('\n(tozalandi)\n');

await disconnectDb();
