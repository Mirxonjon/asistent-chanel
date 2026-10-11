/**
 * Tasdiqlash oqimi sinovi: draft → active → paused → active
 * Eng muhimi: TASDIQLANMAGAN reja post chiqarmasligi kerak.
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';
import {
  createPlan,
  confirmPlan,
  togglePause,
  remainingPlanCount,
  getActiveChallenge,
} from '../src/handlers/plan.js';
import { Challenge } from '../src/models/Challenge.js';

await connectDb();

const user = await User.findOne();
const channel = await Channel.findOne({ ownerId: user.telegramId });

const alerts = [];
const ctx = {
  from: { id: user.telegramId, first_name: user.firstName, is_bot: false },
  chat: { id: user.telegramId },
  user,
  callbackQuery: { data: 'x' },
  async answerCbQuery(t) {
    if (t) alerts.push(t);
  },
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

/** Holat endi Challenge yozuvida */
const state = async () => {
  const ch = await Channel.findById(channel._id).lean();
  const challenge = await getActiveChallenge(ch);
  return challenge?.state ?? null;
};

/** Scheduler shu kanalni ishlaydimi? (processChannel dagi shart) */
const schedulerWouldPost = async () => {
  const left = await remainingPlanCount(channel._id);
  return !(left > 0 && (await state()) !== 'active');
};

const problems = [];
const check = (cond, msg) => {
  console.log(`   ${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) problems.push(msg);
};

console.log(`\nKanal: "${channel.title}"\n`);

// --- 1. Reja tuzish → draft bo'lishi kerak ---
console.log('1) Reja tuzilmoqda (3 kun)...');
ctx.callbackQuery = null;
await createPlan(ctx, String(channel._id), 3);
console.log(`   mavzular: ${await remainingPlanCount(channel._id)} ta`);
console.log(`   holat: ${await state()}`);
check((await state()) === 'draft', 'yangi reja draft holatida tug‘ildi');
check(!(await schedulerWouldPost()), 'tasdiqlanmagan reja post CHIQARMAYDI');

// --- 2. Pauza urinishi rad etilishi kerak ---
console.log('\n2) Tasdiqlanmagan rejani pauzaga qo‘yishga urinish...');
alerts.length = 0;
ctx.callbackQuery = { data: 'x' };
await togglePause(ctx, String(channel._id));
check((await state()) === 'draft', 'holat o‘zgarmadi');
check(/tasdiqlang/i.test(alerts.join(' ')), `ogohlantirish chiqdi: "${alerts[0] ?? '—'}"`);

// --- 3. Tasdiqlash ---
console.log('\n3) ✅ Tasdiqlash...');
await confirmPlan(ctx, String(channel._id));
console.log(`   holat: ${await state()}`);
check((await state()) === 'active', 'draft → active');
check(await schedulerWouldPost(), 'endi scheduler post chiqaradi');

// --- 4. Pauza ---
console.log('\n4) ⏸ Pauza...');
await togglePause(ctx, String(channel._id));
check((await state()) === 'paused', 'active → paused');
check(!(await schedulerWouldPost()), 'pauzada post chiqmaydi');

// --- 5. Davom ---
console.log('\n5) ▶️ Davom ettirish...');
await togglePause(ctx, String(channel._id));
check((await state()) === 'active', 'paused → active');
check(await schedulerWouldPost(), 'yana post chiqadi');

// --- 6. Bo'sh rejani tasdiqlash rad etilsin ---
console.log('\n6) Bo‘sh rejani tasdiqlashga urinish...');
await Post.deleteMany({ channelId: channel._id, status: 'planned' });
await Challenge.updateOne(
  { _id: (await Channel.findById(channel._id)).activeChallengeId },
  { $set: { state: 'draft' } }
);
alerts.length = 0;
await confirmPlan(ctx, String(channel._id));
check((await state()) === 'draft', 'bo‘sh reja tasdiqlanmadi');
check(/bo‘sh|bosh/i.test(alerts.join(' ')), `ogohlantirish: "${alerts[0] ?? '—'}"`);

console.log(
  problems.length ? `\n❌ ${problems.length} ta muammo\n` : '\n✅ Hammasi to‘g‘ri ishladi\n'
);

await Post.deleteMany({ channelId: channel._id });
await Challenge.deleteMany({ ownerId: user.telegramId });
await Channel.updateOne({ _id: channel._id }, { $set: { activeChallengeId: null } });
await disconnectDb();
