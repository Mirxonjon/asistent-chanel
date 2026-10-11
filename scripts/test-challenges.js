/**
 * Challenge tarixi sinovi.
 * Eng muhimi: yangi challenge tuzilganda eskisi YO'QOLMASLIGI kerak.
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';
import { Challenge } from '../src/models/Challenge.js';
import { createPlan, confirmPlan, getActiveChallenge } from '../src/handlers/plan.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });

// Toza boshlaymiz
await Challenge.deleteMany({ ownerId: user.telegramId });
await Post.deleteMany({ channelId: channel._id, status: 'planned' });
await Channel.updateOne({ _id: channel._id }, { $set: { activeChallengeId: null } });

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

const problems = [];
const check = (cond, msg) => {
  console.log(`   ${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) problems.push(msg);
};

console.log(`\nKanal: "${channel.title}"\n`);

// --- 1-challenge ---
console.log('1) Birinchi challenge: «Texnik tahlil asoslari»');
await Channel.updateOne(
  { _id: channel._id },
  { $set: { planTopic: 'Texnik tahlil asoslari' } }
);
await createPlan(ctx, String(channel._id), 2);

let ch1 = await getActiveChallenge(await Channel.findById(channel._id));
console.log(`   challenge: "${ch1.topic}"  holat=${ch1.state}  mavzular=${ch1.totalTopics}`);
check(ch1.topic === 'Texnik tahlil asoslari', 'mavzu saqlandi');
check(ch1.state === 'draft', 'draft holatida');

await confirmPlan(ctx, String(channel._id));
ch1 = await Challenge.findById(ch1._id).lean();
check(ch1.state === 'active', 'tasdiqlangach active');

// Bitta post joylangandek qilamiz
const firstPost = await Post.findOne({ challengeId: ch1._id }).sort({ scheduledFor: 1 });
await Post.updateOne(
  { _id: firstPost._id },
  { $set: { status: 'published', publishedAt: new Date(), text: 'test' } }
);
console.log(`   1 ta post joylandi (test uchun)`);

// --- 2-challenge ---
console.log('\n2) Ikkinchi challenge: «Kripto fyuchers»');
await Channel.updateOne({ _id: channel._id }, { $set: { planTopic: 'Kripto fyuchers' } });
await createPlan(ctx, String(channel._id), 2);

const ch2 = await getActiveChallenge(await Channel.findById(channel._id));
console.log(`   challenge: "${ch2.topic}"  holat=${ch2.state}`);

// --- Tekshiruvlar ---
console.log('\n3) Tekshiruvlar:');

const all = await Challenge.find({ ownerId: user.telegramId }).sort({ createdAt: 1 }).lean();
console.log(`   bazada ${all.length} ta challenge:`);
all.forEach((c) => console.log(`     • "${c.topic}" — ${c.state}`));

check(all.length === 2, 'ikkala challenge ham saqlandi (eskisi yo‘qolmadi)');

const old = all.find((c) => String(c._id) === String(ch1._id));
check(old?.state === 'archived', 'eski challenge arxivga o‘tdi');
check(String(ch2._id) !== String(ch1._id), 'yangi challenge alohida yozuv');

// Eski challenge'ning joylangan posti saqlanganmi
const oldPublished = await Post.countDocuments({
  challengeId: ch1._id,
  status: 'published',
});
check(oldPublished === 1, 'eski challenge’ning joylangan posti tarixda qoldi');

// Eski challenge'ning chiqmagan mavzulari o'chirilganmi
const oldPlanned = await Post.countDocuments({ challengeId: ch1._id, status: 'planned' });
check(oldPlanned === 0, 'eski challenge’ning chiqmagan mavzulari tozalandi');

// Yangisining mavzulari o'ziga bog'langanmi
const newPlanned = await Post.countDocuments({ challengeId: ch2._id, status: 'planned' });
check(newPlanned === ch2.totalTopics, `yangi challenge mavzulari bog‘landi (${newPlanned} ta)`);

console.log(
  problems.length ? `\n❌ ${problems.length} ta muammo\n` : '\n✅ Hammasi to‘g‘ri\n'
);

// Tozalash
await Challenge.deleteMany({ ownerId: user.telegramId });
await Post.deleteMany({ channelId: channel._id });
await Channel.updateOne(
  { _id: channel._id },
  { $set: { activeChallengeId: null, planTopic: null } }
);

await disconnectDb();
