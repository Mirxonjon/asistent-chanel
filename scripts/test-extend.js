/**
 * "Davom ettirish" sinovi — Telegram'siz, soxta ctx bilan.
 * Reja tuzadi, keyin ustiga qo'shadi va tekshiradi:
 *   • mavzular takrorlanmadimi
 *   • sanalar uzluksiz davom etdimi
 *   • eski mavzular joyida qoldimi
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';
import { createPlan, extendPlan } from '../src/handlers/plan.js';
import { formatInZone } from '../src/time.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });
console.log(`\nKanal: "${channel.title}"  kuniga ${channel.postsPerDay} ta  ${channel.times.join(', ')}\n`);

const ctx = {
  from: { id: user.telegramId, first_name: user.firstName, is_bot: false },
  chat: { id: user.telegramId },
  user,
  callbackQuery: null,
  async answerCbQuery() {},
  async sendChatAction() {},
  async reply() {
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
  Post.find({ channelId: channel._id, status: 'planned' })
    .sort({ scheduledFor: 1 })
    .lean();

// --- 1. Reja tuzish: 3 kun ---
console.log('1) Reja tuzilmoqda (3 kun)...');
await createPlan(ctx, String(channel._id), 3);
const first = await list();
console.log(`   ${first.length} ta mavzu:`);
first.forEach((p, i) =>
  console.log(`     ${i + 1}. ${formatInZone(p.scheduledFor, channel.timezone)} — ${p.topic}`)
);

// --- 2. Davom ettirish: +3 kun ---
console.log('\n2) Davom ettirilmoqda (+3 kun)...');
await extendPlan(ctx, String(channel._id), 3);
const all = await list();
console.log(`   endi ${all.length} ta:`);
all.forEach((p, i) => {
  const isNew = !first.some((f) => String(f._id) === String(p._id));
  console.log(
    `     ${String(i + 1).padStart(2)}. ${formatInZone(p.scheduledFor, channel.timezone)} — ${p.topic}${isNew ? '   ← YANGI' : ''}`
  );
});

// --- 3. Tekshiruvlar ---
console.log('\n3) Tekshiruvlar:');
const problems = [];

if (all.length !== first.length + 3 * channel.postsPerDay) {
  problems.push(`son noto'g'ri: ${all.length}, kutilgan ${first.length + 3 * channel.postsPerDay}`);
}

const topics = all.map((p) => p.topic.toLowerCase());
const dupes = topics.length - new Set(topics).size;
if (dupes) problems.push(`${dupes} ta takror mavzu`);

const keptAll = first.every((f) => all.some((a) => String(a._id) === String(f._id)));
if (!keptAll) problems.push('eski mavzular yo\'qolgan');

let ordered = true;
for (let i = 1; i < all.length; i++) {
  if (all[i].scheduledFor <= all[i - 1].scheduledFor) ordered = false;
}
if (!ordered) problems.push('sanalar tartibsiz');

const indexes = all.map((p) => p.planIndex);
const expected = [...Array(all.length).keys()].map((n) => n + 1);
if (JSON.stringify(indexes) !== JSON.stringify(expected)) {
  problems.push(`planIndex noto'g'ri: ${indexes.join(',')}`);
}

if (problems.length) {
  console.log('   ❌ ' + problems.join('\n   ❌ '));
} else {
  console.log('   ✅ son to‘g‘ri');
  console.log('   ✅ takror yo‘q');
  console.log('   ✅ eski mavzular saqlandi');
  console.log('   ✅ sanalar uzluksiz');
  console.log('   ✅ planIndex ketma-ket');
}

// --- Tozalash ---
await Post.deleteMany({ channelId: channel._id, status: 'planned' });
console.log('\n(sinov ma\'lumotlari tozalandi)\n');

await disconnectDb();
