import { Telegraf, Markup } from 'telegraf';
import { config } from './config.js';
import { auth, clearState } from './middleware/auth.js';
import { Channel } from './models/Channel.js';
import { escapeHtml, safeEdit, lines } from './utils.js';
import { log, requestLogger } from './logger.js';
import {
  startConnect,
  extractForwardedChannel,
  verifyAndSaveChannel,
  handleTopic,
  startTopicEdit,
} from './handlers/connect.js';
import {
  startWrite,
  pickChannelForWrite,
  handleAutoTopic,
  handlePostTopic,
  generateAndPreview,
  publishDraft,
  retryDraft,
  newTopicForDraft,
  cancelDraft,
} from './handlers/write.js';
import {
  startSchedule,
  pickChannelForSchedule,
  askCount,
  handleCountText,
  handleCountButton,
  applyDistributed,
  handleTimesText,
  toggleAutoPublish,
  turnScheduleOff,
  askTimezone,
  setTimezone,
  handleTimezoneText,
} from './handlers/schedule.js';
import {
  askPlanDays,
  handlePlanDaysText,
  createPlan,
  showPlan,
  startSwap,
  handleSwapNumber,
  clearPlan,
  askExtendDays,
  handleExtendDaysText,
  extendPlan,
  startManualTopic,
  handleManualNumber,
  handleManualTopic,
  askPlanTopic,
  choosePlanTopic,
  handlePlanTopicText,
  togglePause,
  confirmPlan,
  listChallenges,
  openChallenge,
  repeatChallenge,
} from './handlers/plan.js';

export const bot = new Telegraf(config.botToken);

bot.use(requestLogger); // har bir so'rovni konsolga yozadi
bot.use(auth);

// ================================================================ menyu

const mainMenu = Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ Kanal ulash', 'menu:connect'),
    Markup.button.callback('📋 Kanallarim', 'menu:channels'),
  ],
  [
    Markup.button.callback('✍️ Post yozish', 'menu:write'),
    Markup.button.callback('⏰ Reja', 'menu:schedule'),
  ],
  [
    Markup.button.callback('📚 Challengelarim', 'menu:challenges'),
    Markup.button.callback('⚙️ Sozlama', 'menu:settings'),
  ],
]);

const backToMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Menyu', 'menu:main')],
]);

function welcomeText(ctx) {
  const name = ctx.from.first_name ?? '';
  return lines(
    `Salom, <b>${escapeHtml(name)}</b>! 👋`,
    '',
    'Men kanalingiz uchun post yozib, o‘zim joylab beraman.',
    '',
    '<b>Qanday ishlaydi:</b>',
    '1️⃣ Kanalingizga meni admin qilib qo‘shasiz',
    '2️⃣ Kanalni ulaysiz va mavzusini aytasiz',
    '3️⃣ Mavzu berasiz — men post yozaman',
    '4️⃣ Yoki reja tuzasiz — o‘zim avtomatik yozib turaman',
    '',
    'Boshlash uchun <b>➕ Kanal ulash</b> ni bosing.'
  );
}

// ================================================================ /start

bot.start(async (ctx) => {
  await clearState(ctx);
  await ctx.reply(welcomeText(ctx), { parse_mode: 'HTML', ...mainMenu });
});

bot.command('menyu', async (ctx) => {
  await clearState(ctx);
  await ctx.reply('Asosiy menyu:', mainMenu);
});

bot.command('bekor', async (ctx) => {
  await clearState(ctx);
  await ctx.reply('Bekor qilindi.', mainMenu);
});

bot.action('menu:main', async (ctx) => {
  await ctx.answerCbQuery();
  await clearState(ctx);
  await safeEdit(ctx, welcomeText(ctx), mainMenu);
});

// ================================================================ kanal ulash

bot.action('menu:connect', async (ctx) => {
  await ctx.answerCbQuery();
  await startConnect(ctx);
});

bot.command('kanal', async (ctx) => {
  await startConnect(ctx);
});

bot.action(/^topic:edit:(.+)$/, async (ctx) => {
  await startTopicEdit(ctx, ctx.match[1]);
});

// ================================================================ kanallarim

async function showChannels(ctx) {
  // ownerId filtri — foydalanuvchi faqat o'z kanallarini ko'radi
  const channels = await Channel.find({ ownerId: ctx.from.id }).sort({ createdAt: 1 });

  if (channels.length === 0) {
    return safeEdit(
      ctx,
      lines('📋 <b>Kanallarim</b>', '', 'Hali kanal ulanmagan.'),
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Kanal ulash', 'menu:connect')],
        [Markup.button.callback('⬅️ Menyu', 'menu:main')],
      ])
    );
  }

  const out = ['📋 <b>Kanallarim</b>', ''];
  const buttons = [];

  for (const ch of channels) {
    const reja =
      ch.postsPerDay > 0
        ? `kuniga ${ch.postsPerDay} ta (${ch.times.join(', ')})`
        : 'reja yo‘q';

    out.push(
      `${ch.active ? '🟢' : '⚪️'} <b>${escapeHtml(ch.title ?? ch.chatId)}</b>`,
      `   📝 ${escapeHtml(ch.topic)}`,
      `   ⏰ ${reja}`,
      ''
    );

    buttons.push([
      Markup.button.callback(
        `✏️ ${(ch.title ?? ch.chatId).slice(0, 20)}`,
        `topic:edit:${ch._id}`
      ),
    ]);
  }

  buttons.push([Markup.button.callback('⬅️ Menyu', 'menu:main')]);
  await safeEdit(ctx, out.join('\n'), Markup.inlineKeyboard(buttons));
}

bot.action('menu:channels', async (ctx) => {
  await ctx.answerCbQuery();
  await showChannels(ctx);
});

bot.command('kanallarim', async (ctx) => {
  const channels = await Channel.find({ ownerId: ctx.from.id });
  if (channels.length === 0) {
    return ctx.reply('Hali kanal ulanmagan. /kanal bilan ulang.');
  }
  await ctx.reply(
    channels
      .map((c) => `${c.active ? '🟢' : '⚪️'} ${c.title ?? c.chatId} — ${c.topic}`)
      .join('\n')
  );
});

// ================================================================ post yozish

bot.action('menu:write', async (ctx) => {
  await ctx.answerCbQuery();
  await startWrite(ctx);
});

bot.action(/^write:pick:(.+)$/, async (ctx) => {
  await pickChannelForWrite(ctx, ctx.match[1]);
});

bot.action(/^write:auto:(.+)$/, async (ctx) => {
  await handleAutoTopic(ctx, ctx.match[1]);
});

/** /mavzu  yoki  /mavzu Bitcoin narxi nega tushdi */
bot.command('mavzu', async (ctx) => {
  const topic = ctx.payload?.trim();
  if (!topic) return startWrite(ctx);

  // Mavzu berilgan — bitta kanal bo'lsa to'g'ridan yozamiz
  const channels = await Channel.find({ ownerId: ctx.from.id, active: true });
  if (channels.length === 0) return startWrite(ctx);
  if (channels.length === 1) {
    await clearState(ctx);
    return generateAndPreview(ctx, channels[0], topic);
  }
  // Bir nechta kanal — avval kanalni tanlash kerak
  return startWrite(ctx);
});

// ------------------------------------------------- preview tugmalari

bot.action(/^post:pub:(.+)$/, async (ctx) => {
  await publishDraft(ctx, ctx.match[1]);
});

bot.action(/^post:retry:(.+)$/, async (ctx) => {
  await retryDraft(ctx, ctx.match[1]);
});

bot.action(/^post:newtopic:(.+)$/, async (ctx) => {
  await newTopicForDraft(ctx, ctx.match[1]);
});

bot.action(/^post:cancel:(.+)$/, async (ctx) => {
  await cancelDraft(ctx, ctx.match[1]);
});

// ================================================================ reja

bot.action('menu:schedule', async (ctx) => {
  await ctx.answerCbQuery();
  await startSchedule(ctx);
});

bot.command('reja', async (ctx) => {
  await startSchedule(ctx);
});

bot.action(/^sch:pick:(.+)$/, async (ctx) => {
  await pickChannelForSchedule(ctx, ctx.match[1]);
});

bot.action(/^sch:count:(.+)$/, async (ctx) => {
  await askCount(ctx, ctx.match[1]);
});

bot.action(/^sch:n:([^:]+):(\d+)$/, async (ctx) => {
  await handleCountButton(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^sch:dist:([^:]+):(\d+)$/, async (ctx) => {
  await applyDistributed(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^sch:auto:(.+)$/, async (ctx) => {
  await toggleAutoPublish(ctx, ctx.match[1]);
});

bot.action(/^sch:off:(.+)$/, async (ctx) => {
  await turnScheduleOff(ctx, ctx.match[1]);
});

bot.action(/^sch:tz:(.+)$/, async (ctx) => {
  await askTimezone(ctx, ctx.match[1]);
});

// Zona nomida ham ":" bo'ladi — oxirigacha olamiz
bot.action(/^sch:settz:([^:]+):(.+)$/, async (ctx) => {
  await setTimezone(ctx, ctx.match[1], ctx.match[2]);
});

// ========================================== hali yozilmagan bo'limlar

const soon = {
  'menu:settings': 'Sozlama',
};

for (const [action, label] of Object.entries(soon)) {
  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery(`${label} — tez orada`);
  });
}

// ================================================================ kontent reja

// Reja tuzish MAVZUDAN boshlanadi: kanalnikimi yoki alohidami
bot.action(/^plan:ask:(.+)$/, async (ctx) => {
  await askPlanTopic(ctx, ctx.match[1]);
});

// ch = kanal mavzusi | new = o'zi yozadi | keep = hozirgisi qolsin
bot.action(/^plan:topic:([^:]+):(ch|new|keep)$/, async (ctx) => {
  await choosePlanTopic(ctx, ctx.match[1], ctx.match[2]);
});

// Kun sonini qayta so'rash (mavzu allaqachon tanlangan)
bot.action(/^plan:days:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await askPlanDays(ctx, ctx.match[1]);
});

bot.action(/^plan:make:([^:]+):(\d+)$/, async (ctx) => {
  await createPlan(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/^plan:show:(.+)$/, async (ctx) => {
  await showPlan(ctx, ctx.match[1]);
});

bot.action(/^plan:more:(.+)$/, async (ctx) => {
  await askExtendDays(ctx, ctx.match[1]);
});

bot.action(/^plan:ext:([^:]+):(\d+)$/, async (ctx) => {
  await extendPlan(ctx, ctx.match[1], Number(ctx.match[2]));
});

bot.action(/^plan:swap:(.+)$/, async (ctx) => {
  await startSwap(ctx, ctx.match[1]);
});

bot.action('menu:challenges', async (ctx) => {
  await listChallenges(ctx);
});

bot.command('challenge', async (ctx) => {
  await listChallenges(ctx);
});

bot.action(/^ch:open:(.+)$/, async (ctx) => {
  await openChallenge(ctx, ctx.match[1]);
});

bot.action(/^ch:again:(.+)$/, async (ctx) => {
  await repeatChallenge(ctx, ctx.match[1]);
});

bot.action(/^plan:confirm:(.+)$/, async (ctx) => {
  await confirmPlan(ctx, ctx.match[1]);
});

bot.action(/^plan:pause:(.+)$/, async (ctx) => {
  await togglePause(ctx, ctx.match[1]);
});

bot.action(/^plan:man:(.+)$/, async (ctx) => {
  await startManualTopic(ctx, ctx.match[1]);
});

bot.action(/^plan:clear:(.+)$/, async (ctx) => {
  await clearPlan(ctx, ctx.match[1]);
});

bot.command('rejam', async (ctx) => {
  const channels = await Channel.find({ ownerId: ctx.from.id, active: true });
  if (channels.length === 0) return ctx.reply('Avval kanal ulang: /kanal');
  if (channels.length === 1) return showPlan(ctx, channels[0]._id);
  return startSchedule(ctx); // bir nechta kanal — avval tanlash
});

// ================================================ xabarlarni yo'naltirish

const CHANNEL_USERNAME = /^@[A-Za-z][A-Za-z0-9_]{3,31}$/;

bot.on('message', async (ctx) => {
  const msg = ctx.message;

  // --- 1. Kanaldan forward qilingan post? ---
  // Holatdan qat'i nazar qabul qilamiz — qulay bo'lsin.
  const forwarded = extractForwardedChannel(msg);
  if (forwarded) {
    return verifyAndSaveChannel(ctx, String(forwarded.id));
  }

  const text = msg.text?.trim();
  if (!text) return; // rasm, sticker, ovoz — e'tiborsiz

  // --- 2. @kanal_nomi yozilgan? ---
  if (CHANNEL_USERNAME.test(text)) {
    return verifyAndSaveChannel(ctx, text);
  }

  // --- 3. Suhbat holatiga qarab ---
  switch (ctx.user.state?.name) {
    case 'awaiting_channel':
      return ctx.reply(
        lines(
          'Kanalni ko‘rsatishning ikki yo‘li bor:',
          '',
          '📨 Kanaldan biror postni menga <b>forward</b> qiling',
          '✍️ yoki manzilini yozing: <code>@kanal_nomi</code>',
          '',
          'Bekor qilish: /bekor'
        ),
        { parse_mode: 'HTML' }
      );

    case 'awaiting_topic':
      return handleTopic(ctx, text);

    case 'awaiting_post_topic':
      return handlePostTopic(ctx, text);

    case 'awaiting_posts_per_day':
      return handleCountText(ctx, text);

    case 'awaiting_times':
      return handleTimesText(ctx, text);

    case 'awaiting_timezone':
      return handleTimezoneText(ctx, text);

    case 'awaiting_plan_days':
      return handlePlanDaysText(ctx, text);

    case 'awaiting_swap_number':
      return handleSwapNumber(ctx, text);

    case 'awaiting_extend_days':
      return handleExtendDaysText(ctx, text);

    case 'awaiting_manual_number':
      return handleManualNumber(ctx, text);

    case 'awaiting_manual_topic':
      return handleManualTopic(ctx, text);

    case 'awaiting_plan_topic':
      return handlePlanTopicText(ctx, text);

    default:
      return ctx.reply(
        'Nima qilishni tushunmadim. Menyuni ochish: /menyu',
        backToMenu
      );
  }
});

// ================================================================ xatolar

bot.catch((err, ctx) => {
  log.error(`Bot xatosi (${ctx?.updateType})`, err);

  // Tugma bosilgan bo'lsa "soat" belgisi aylanib qolmasin
  ctx?.answerCbQuery?.('Xatolik yuz berdi').catch(() => {});

  ctx
    ?.reply('Kechirasiz, xatolik yuz berdi. Qaytadan urinib ko‘ring: /menyu')
    .catch(() => {});
});
