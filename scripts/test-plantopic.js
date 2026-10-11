/**
 * "Challenge mavzusi" sinovi.
 *
 * Kanal mavzusi keng ("Trading, investitsiya, bozor tahlili"),
 * lekin challenge tor mavzuda bo'lsa — reja o'shanga mos chiqadimi?
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';
import { createPlan, planTopicOf } from '../src/handlers/plan.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });
const originalPlanTopic = channel.planTopic;

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
  Post.find({ channelId: channel._id, status: 'planned' }).sort({ scheduledFor: 1 }).lean();

console.log(`\n📚 Kanal mavzusi:  "${channel.topic}"\n`);

// ============ A: kanal mavzusi bo'yicha ============
await Channel.updateOne({ _id: channel._id }, { $set: { planTopic: null } });
let ch = await Channel.findById(channel._id);
console.log(`A) planTopic = null  →  ishlatiladi: "${planTopicOf(ch)}"`);
await createPlan(ctx, String(channel._id), 6);
const generalPlan = (await list()).map((p) => p.topic);
generalPlan.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

// ============ B: tor challenge mavzusi ============
const FOCUS = 'Kripto fyuchers savdosi va risk boshqaruvi';
await Channel.updateOne({ _id: channel._id }, { $set: { planTopic: FOCUS } });
ch = await Channel.findById(channel._id);

console.log(`\nB) planTopic = "${FOCUS}"`);
console.log(`   ishlatiladi: "${planTopicOf(ch)}"`);
await createPlan(ctx, String(channel._id), 6);
const focusPlan = (await list()).map((p) => p.topic);
focusPlan.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

// ============ Tekshiruvlar ============
console.log('\nTekshiruvlar:');
const problems = [];

if (planTopicOf(ch) !== FOCUS) problems.push('planTopicOf tor mavzuni qaytarmadi');

// Tor rejada mavzuga oid so'zlar uchrashi kerak
const KEYWORDS = /fyuchers|kripto|leveraj|marja|likvidatsiya|pozitsiya|risk|bitcoin|birja/i;
const onTopic = focusPlan.filter((t) => KEYWORDS.test(t)).length;
console.log(`   tor rejada mavzuga oid: ${onTopic}/${focusPlan.length}`);
if (onTopic < focusPlan.length / 2) {
  problems.push(`tor reja mavzuga mos emas (${onTopic}/${focusPlan.length})`);
}

// Ikki reja bir xil bo'lmasligi kerak
const overlap = generalPlan.filter((t) => focusPlan.includes(t)).length;
console.log(`   ikki reja ustma-ust tushgani: ${overlap} ta`);
if (overlap > 1) problems.push(`rejalar deyarli bir xil (${overlap} ta bir xil)`);

if (problems.length) {
  console.log('   ❌ ' + problems.join('\n   ❌ '));
} else {
  console.log('   ✅ tor mavzu saqlandi va ishlatildi');
  console.log('   ✅ reja tor mavzuga mos chiqdi');
  console.log('   ✅ keng va tor rejalar farq qiladi');
}

// Tozalash
await Post.deleteMany({ channelId: channel._id, status: 'planned' });
await Channel.updateOne(
  { _id: channel._id },
  { $set: { planTopic: originalPlanTopic ?? null } }
);
console.log('\n(tozalandi)\n');

await disconnectDb();
