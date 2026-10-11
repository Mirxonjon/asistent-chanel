import cron from 'node-cron';
import { Channel } from './models/Channel.js';
import { Post } from './models/Post.js';
import { generatePost, suggestTopic } from './ai.js';
import { publishPost, postUrl } from './publish.js';
import { recentTopicsFor, sendPreviewTo } from './handlers/write.js';
import {
  takeNextPlanned,
  remainingPlanCount,
  planTopicOf,
  getActiveChallenge,
} from './handlers/plan.js';
import { Challenge } from './models/Challenge.js';
import { computeNextRunAt } from './time.js';
import { sleep, escapeHtml, lines } from './utils.js';

/** Bir tick'da nechta kanalga ishlov beriladi */
const BATCH_LIMIT = 20;

/** Kanallar orasidagi pauza — OpenAI va Telegram rate-limit uchun */
const GAP_MS = 2000;

/**
 * Vaqti o'tib ketgan post qancha kechikkan bo'lsa ham yuborilsin?
 * Bot bir necha kun o'chib turgan bo'lsa, uyg'onganda hamma
 * o'tib ketgan postni ketma-ket yuborib kanalni spam qilmasligi kerak.
 */
const MAX_LATE_MS = 30 * 60 * 1000; // 30 daqiqa

/**
 * Tick bir vaqtda faqat bitta ishlasin.
 * Bitta post ~12 sekund yoziladi, 10 kanal = 2 daqiqadan ko'p.
 * Bu flag bo'lmasa cron ticklari bir-birining ustiga chiqib ketadi.
 */
let running = false;

// =====================================================================
//  Ishga tushirish
// =====================================================================

export function startScheduler(bot) {
  // Har daqiqada. Og'ir emas: so'rov indeksli va 99% holatda bo'sh qaytadi.
  cron.schedule('* * * * *', () => {
    tick(bot).catch((err) => console.error('❌ Scheduler xatosi:', err.message));
  });

  console.log('⏰ Scheduler yoqildi (har daqiqada tekshiradi)');
}

// =====================================================================
//  Bir tick
// =====================================================================

async function tick(bot) {
  if (running) return; // oldingi tick hali tugamagan
  running = true;

  try {
    const now = new Date();

    // Indeksli so'rov: { active: 1, nextRunAt: 1 }
    // Vaqti kelmagan bo'lsa MongoDB indeks boshiga qaraydi va bo'sh qaytaradi.
    const due = await Channel.find({
      active: true,
      postsPerDay: { $gt: 0 },
      nextRunAt: { $ne: null, $lte: now },
    }).limit(BATCH_LIMIT);

    if (due.length === 0) return;

    console.log(`⏰ ${due.length} kanalning vaqti keldi`);

    // Navbat bilan — parallel emas
    for (const channel of due) {
      try {
        await processChannel(bot, channel, now);
      } catch (err) {
        console.error(`❌ ${channel.title ?? channel.chatId}:`, err.message);
      }
      await sleep(GAP_MS);
    }
  } finally {
    running = false;
  }
}

// =====================================================================
//  Bitta kanal
// =====================================================================

async function processChannel(bot, channel, now) {
  const scheduledFor = channel.nextRunAt;

  // ⚠️ MUHIM: keyingi vaqtni DARHOL yozamiz, generatsiyadan OLDIN.
  // Aks holda xato bo'lsa nextRunAt o'tgan vaqtda qolib, cron har
  // daqiqada qayta urinib, OpenAI hisobini bo'shatadi.
  await rescheduleChannel(channel, now);

  // --- Juda kechikkanmi? (bot o'chib turgan) ---
  const lateMs = now.getTime() - scheduledFor.getTime();
  if (lateMs > MAX_LATE_MS) {
    console.log(
      `⏭  ${channel.title}: ${Math.round(lateMs / 60000)} daqiqa kech — o'tkazib yuborildi`
    );
    return;
  }

  // --- Mavzu: AVVAL kontent rejadan ---
  // Reja bo'lsa foydalanuvchi mavzuni oldindan ko'rgan va tasdiqlagan.
  // Reja tugagan yoki tuzilmagan bo'lsa — AI o'zi o'ylab topadi.
  const recentTopics = await recentTopicsFor(channel._id);

  // Reja bor, lekin tasdiqlanmagan yoki pauzada bo'lsa — post chiqmaydi.
  // (Reja umuman yo'q kanallar avvalgidek ishlayveradi.)
  const planLeft = await remainingPlanCount(channel._id);
  const challenge = await getActiveChallenge(channel);

  if (planLeft > 0 && challenge?.state !== 'active') {
    console.log(
      `⏸  ${channel.title}: challenge holati "${challenge?.state ?? 'topilmadi'}" — o'tkazib yuborildi`
    );
    return;
  }

  const planned = await takeNextPlanned(channel._id, now);

  const topic = planned
    ? planned.topic
    : await suggestTopic({ channelTopic: channel.topic, recentTopics });

  console.log(
    `📝 ${channel.title}: "${topic}" ${planned ? '(rejadan)' : '(AI tanladi)'}`
  );

  const text = await generatePost({
    topic,
    // Rejadan kelgan mavzu bo'lsa — matn ham o'sha challenge
    // kontekstida yozilsin, kanalning umumiy mavzusida emas.
    channelTopic: planned ? planTopicOf(channel) : channel.topic,
    tone: channel.tone,
    language: channel.language,
    recentTopics,
  });

  // Rejadagi yozuvni qayta ishlatamiz — dublikat yaratmaymiz
  const post = planned
    ? await Post.findByIdAndUpdate(
        planned._id,
        { $set: { text, status: 'draft' } },
        { new: true }
      )
    : await Post.create({
        ownerId: channel.ownerId,
        channelId: channel._id,
        topic,
        text,
        status: 'draft',
        source: 'auto',
      });

  // --- Joylash yoki tasdiqqa yuborish ---
  if (channel.autoPublish) {
    const { url } = await publishPost(bot.telegram, channel, post);
    console.log(`✅ ${channel.title}: joylandi — "${topic}"`);
    await notifyOwner(bot, channel, post, url);
  } else {
    await sendPreviewTo(
      bot.telegram,
      channel.ownerId,
      channel,
      post,
      '⏰ <b>Reja bo‘yicha post tayyor</b>'
    );
    console.log(`📨 ${channel.title}: tasdiqqa yuborildi — "${topic}"`);
  }

  // Reja tugayotgan bo'lsa egasini ogohlantiramiz
  if (planned) {
    await warnIfPlanRunningOut(bot, channel);
    await completeChallengeIfDone(bot, channel, challenge);
  }
}

/** Oxirgi mavzu ham chiqib bo'lgach challenge tugadi deb belgilaymiz */
async function completeChallengeIfDone(bot, channel, challenge) {
  if (!challenge || challenge.state !== 'active') return;
  if ((await remainingPlanCount(channel._id)) > 0) return;

  await Challenge.updateOne(
    { _id: challenge._id },
    { $set: { state: 'completed', completedAt: new Date() } }
  );
  console.log(`🏁 ${channel.title}: challenge tugadi — "${challenge.topic}"`);

  await bot.telegram
    .sendMessage(
      channel.ownerId,
      lines(
        '🏁 <b>Challenge tugadi!</b>',
        '',
        `📢 ${escapeHtml(channel.title ?? channel.chatId)}`,
        `🎯 ${escapeHtml(challenge.topic)}`,
        `📊 ${challenge.totalTopics} ta post joylandi`,
        '',
        'Yangi challenge tuzasizmi?'
      ),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🆕 Yangi challenge', callback_data: `plan:ask:${channel._id}` }],
            [{ text: '📚 Challengelarim', callback_data: 'menu:challenges' }],
          ],
        },
      }
    )
    .catch(() => {});
}

/** Rejada 3 ta yoki undan kam mavzu qolsa — bir marta eslatma */
const LOW_PLAN_THRESHOLD = 3;

async function warnIfPlanRunningOut(bot, channel) {
  const left = await remainingPlanCount(channel._id);
  if (left !== LOW_PLAN_THRESHOLD) return; // aynan shu songa tushganda bir marta

  await bot.telegram
    .sendMessage(
      channel.ownerId,
      lines(
        '⚠️ <b>Reja tugayapti</b>',
        `📢 ${escapeHtml(channel.title ?? channel.chatId)}`,
        '',
        `Rejada atigi <b>${left} ta</b> mavzu qoldi.`,
        'Tugagach men o‘zim mavzu o‘ylab topaveraman,',
        'lekin rejani davom ettirsangiz nima chiqishini oldindan ko‘rasiz.'
      ),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Rejani davom ettirish', callback_data: `plan:more:${channel._id}` }],
          ],
        },
      }
    )
    .catch(() => {});
}

/** Avto joylangandan keyin egasiga qisqa xabar */
async function notifyOwner(bot, channel, post, url) {
  const text = lines(
    '✅ <b>Reja bo‘yicha post joylandi</b>',
    `📢 ${escapeHtml(channel.title ?? channel.chatId)}`,
    `🏷 ${escapeHtml(post.topic)}`,
    url ? `\n<a href="${url}">🔗 Ko‘rish</a>` : null
  );

  await bot.telegram
    .sendMessage(channel.ownerId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    })
    .catch((err) => {
      // Foydalanuvchi botni bloklagan bo'lishi mumkin — post joylandi, muhim emas
      console.warn(`⚠️  Egasiga xabar bormadi (${channel.ownerId}):`, err.message);
    });
}

// =====================================================================
//  Keyingi vaqtni hisoblash
// =====================================================================

/**
 * nextRunAt ni qayta hisoblaydi.
 * /reja o'zgarganda ham shu funksiya chaqiriladi.
 */
export async function rescheduleChannel(channel, from = new Date()) {
  const next =
    channel.postsPerDay > 0 && channel.times?.length
      ? computeNextRunAt(channel.times, channel.timezone, from)
      : null;

  await Channel.updateOne(
    { _id: channel._id },
    { $set: { nextRunAt: next, lastRunAt: from } }
  );

  return next;
}

/**
 * Bot ishga tushganda: reja bor, lekin nextRunAt yo'q yoki o'tib ketgan
 * kanallarni tartibga soladi. (Masalan bot uzoq o'chib turgan bo'lsa.)
 */
export async function repairSchedules() {
  const now = new Date();
  const broken = await Channel.find({
    active: true,
    postsPerDay: { $gt: 0 },
    $or: [{ nextRunAt: null }, { nextRunAt: { $lt: new Date(now - MAX_LATE_MS) } }],
  });

  if (broken.length === 0) return 0;

  for (const channel of broken) {
    await rescheduleChannel(channel, now);
  }

  console.log(`🔧 ${broken.length} kanalning rejasi tartibga solindi`);
  return broken.length;
}
