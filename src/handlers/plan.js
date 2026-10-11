import { Markup } from 'telegraf';
import { Channel } from '../models/Channel.js';
import { Post } from '../models/Post.js';
import { Challenge } from '../models/Challenge.js';
import { setState, clearState } from '../middleware/auth.js';
import { generatePlan, suggestTopic } from '../ai.js';
import { computeSchedule, formatInZone } from '../time.js';
import { escapeHtml, safeEdit, lines } from '../utils.js';
import { log } from '../logger.js';

/** Tayyor variantlar */
const DAY_PRESETS = [7, 14, 30];

/** Ko'pi bilan shuncha kunlik reja (30 kun × kuniga 5 ta = 150 post) */
const MAX_DAYS = 60;
const MAX_ITEMS = 150;

// =====================================================================
//  0. "Reja qaysi mavzu bo'yicha?"
// =====================================================================

/** Kanalning hozir ishlab turgan challenge'i */
export async function getActiveChallenge(channel) {
  if (!channel?.activeChallengeId) return null;
  return Challenge.findById(channel.activeChallengeId).lean();
}

/** Reja shu mavzu bo'yicha tuziladi (alohida berilmasa — kanalniki) */
export function planTopicOf(channel) {
  return channel.planTopic?.trim() || channel.topic;
}

export async function askPlanTopic(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  if (!channel.postsPerDay || !channel.times?.length) {
    return ctx.answerCbQuery('Avval kuniga nechta post va vaqtini belgilang', {
      show_alert: true,
    });
  }

  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await clearState(ctx);

  const current = planTopicOf(channel);
  const isCustom = Boolean(channel.planTopic?.trim());

  const text = lines(
    `🎯 <b>Reja mavzusi</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
    '',
    'Challenge qaysi mavzu bo‘yicha tuzilsin?',
    '',
    `📚 <b>Kanal mavzusi:</b>`,
    `    <i>${escapeHtml(channel.topic)}</i>`,
    isCustom ? `\n🎯 <b>Hozirgi reja mavzusi:</b>\n    <i>${escapeHtml(current)}</i>` : null,
    '',
    'Torroq mavzu tanlasangiz, 30 ta mavzu o‘sha yo‘nalishda',
    'chuqurroq va bosqichma-bosqich bo‘ladi.',
    '',
    '<i>Masalan kanal «Trading» bo‘lsa, challenge faqat</i>',
    '<i>«Texnik tahlil asoslari» bo‘yicha bo‘lishi mumkin.</i>'
  );

  const buttons = [
    [Markup.button.callback('📚 Kanal mavzusi bo‘yicha', `plan:topic:${channel._id}:ch`)],
    [Markup.button.callback('🎯 Boshqa mavzu yozaman', `plan:topic:${channel._id}:new`)],
  ];
  if (isCustom) {
    buttons.push([
      Markup.button.callback(
        '♻️ Hozirgi mavzuni saqlab qolish',
        `plan:topic:${channel._id}:keep`
      ),
    ]);
  }
  buttons.push([Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)]);

  return ctx.callbackQuery
    ? safeEdit(ctx, text, Markup.inlineKeyboard(buttons))
    : ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

/** Tugma tanlandi: ch = kanalniki, keep = o'zgarishsiz, new = yangi so'raymiz */
export async function choosePlanTopic(ctx, channelId, choice) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  if (choice === 'new') {
    await ctx.answerCbQuery();
    await setState(ctx, {
      name: 'awaiting_plan_topic',
      channelId: String(channel._id),
    });

    return ctx.reply(
      lines(
        '🎯 <b>Challenge mavzusini yozing</b>',
        '',
        'Qanchalik aniq bo‘lsa, reja shuncha foydali chiqadi.',
        '',
        '<b>Namunalar:</b>',
        '• <i>Texnik tahlil asoslari — grafik o‘qishdan strategiyagacha</i>',
        '• <i>Kripto fyuchers savdosi va risk boshqaruvi</i>',
        '• <i>Boshlovchilar uchun uzoq muddatli investitsiya</i>',
        '',
        'Bekor qilish: /bekor'
      ),
      { parse_mode: 'HTML' }
    );
  }

  // 'ch' — kanal mavzusiga qaytaramiz, 'keep' — tegmaymiz
  if (choice === 'ch') {
    await Channel.updateOne({ _id: channel._id }, { $set: { planTopic: null } });
  }

  await ctx.answerCbQuery();
  return askPlanDays(ctx, channelId);
}

export async function handlePlanTopicText(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const topic = text.trim().replace(/\s+/g, ' ');

  if (topic.length < 5) return ctx.reply('Mavzu juda qisqa. Kamida 5 belgi yozing.');
  if (topic.length > 300) return ctx.reply('Mavzu juda uzun (300 belgidan kam).');

  const channel = await Channel.findOneAndUpdate(
    { _id: channelId, ownerId: ctx.from.id },
    { $set: { planTopic: topic } },
    { returnDocument: 'after' }
  );

  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /menyu');
  }

  await clearState(ctx);
  log.info(`Reja mavzusi belgilandi: "${topic}" — ${channel.title}`);

  await ctx.reply(
    lines('✅ Reja mavzusi:', `<b>${escapeHtml(topic)}</b>`),
    { parse_mode: 'HTML' }
  );

  return askPlanDays(ctx, channelId);
}

// =====================================================================
//  1. "Necha kunga?"
// =====================================================================

export async function askPlanDays(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  if (!channel.postsPerDay || !channel.times?.length) {
    return ctx.answerCbQuery('Avval kuniga nechta post va vaqtini belgilang', {
      show_alert: true,
    });
  }

  await setState(ctx, { name: 'awaiting_plan_days', channelId: String(channel._id) });

  const basis = planTopicOf(channel);
  const isCustom = Boolean(channel.planTopic?.trim());

  const text = lines(
    `📅 <b>Kontent reja</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
    '',
    `${isCustom ? '🎯' : '📚'} Mavzu: <i>${escapeHtml(basis)}</i>`,
    `📊 Kuniga <b>${channel.postsPerDay} ta</b> post (${channel.times.join(', ')})`,
    '',
    'Necha kunlik reja tuzilsin?',
    '',
    'Men mavzularni oson tomondan murakkabga qarab tartiblayman —',
    'kanal o‘quvchisi ketma-ket o‘qisa, bilimi bosqichma-bosqich oshadi.',
    '',
    `Yoki o‘zingiz raqam yozing (1–${MAX_DAYS}).`
  );

  const kb = Markup.inlineKeyboard([
    DAY_PRESETS.map((d) =>
      Markup.button.callback(`${d} kun`, `plan:make:${channel._id}:${d}`)
    ),
    [Markup.button.callback('🎯 Mavzuni o‘zgartirish', `plan:ask:${channel._id}`)],
    [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
  ]);

  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

/** Foydalanuvchi kun sonini qo'lda yozdi */
export async function handlePlanDaysText(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const days = Number(text.trim());

  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return ctx.reply(`1 dan ${MAX_DAYS} gacha butun son yozing.`);
  }

  await clearState(ctx);
  return createPlan(ctx, channelId, days);
}

// =====================================================================
//  2. Rejani tuzish
// =====================================================================

export async function createPlan(ctx, channelId, days) {
  return buildPlan(ctx, channelId, days, { mode: 'new' });
}

/** Mavjud rejani saqlab, oxiriga yangi kunlar qo'shadi */
export async function extendPlan(ctx, channelId, days) {
  return buildPlan(ctx, channelId, days, { mode: 'extend' });
}

/**
 * Reja tuzishning umumiy yadrosi.
 *
 * mode='new'     — eski rejani o'chirib, noldan tuzadi
 * mode='extend'  — eskisini saqlab, oxirgi sanadan keyin davom ettiradi
 */
async function buildPlan(ctx, channelId, days, { mode }) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.reply('Kanal topilmadi. /menyu');

  const extending = mode === 'extend';

  // --- Mavjud reja: davom ettirsak qayerdan boshlashni bilishimiz kerak ---
  const existing = extending
    ? await Post.find({ channelId: channel._id, status: 'planned' })
        .sort({ scheduledFor: 1 })
        .lean()
    : [];

  const room = MAX_ITEMS - existing.length;
  if (extending && room <= 0) {
    return ctx.answerCbQuery?.(`Reja to‘la (${MAX_ITEMS} ta chegara)`, {
      show_alert: true,
    });
  }

  const count = Math.min(Number(days) * channel.postsPerDay, room || MAX_ITEMS);

  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  await clearState(ctx);

  const status = await ctx.reply(
    extending
      ? `🧠 Yana ${count} ta mavzu o‘ylanmoqda...`
      : `🧠 ${count} ta mavzu o‘ylanmoqda... (20-40 sekund)`
  );
  const typing = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    // --- Challenge yozuvi ---
    let challenge;
    if (extending) {
      challenge = await Challenge.findById(channel.activeChallengeId);
      if (!challenge) throw new Error('Challenge topilmadi — rejani qayta tuzing');
    } else {
      // Eski challenge arxivga ketadi (tarixda qoladi), chiqmagan
      // mavzulari esa o'chiriladi — ular endi kerak emas.
      if (channel.activeChallengeId) {
        await Challenge.updateOne(
          { _id: channel.activeChallengeId, state: { $nin: ['completed'] } },
          { $set: { state: 'archived' } }
        );
      }
      await Post.deleteMany({ channelId: channel._id, status: 'planned' });

      challenge = await Challenge.create({
        ownerId: ctx.from.id,
        channelId: channel._id,
        topic: planTopicOf(channel),
        usesChannelTopic: !channel.planTopic?.trim(),
        days: Number(days),
        postsPerDay: channel.postsPerDay,
        state: 'draft',
      });

      await Channel.updateOne(
        { _id: channel._id },
        { $set: { activeChallengeId: challenge._id } }
      );
    }

    // Takrorlanmasligi uchun: joylanganlar + rejada turganlar
    const published = await publishedTopics(channel._id);
    const avoid = existing.map((e) => e.topic);

    const topics = await generatePlan({
      // Kanal mavzusi emas — aynan REJA mavzusi (alohida berilgan bo'lsa)
      channelTopic: planTopicOf(channel),
      count,
      tone: channel.tone,
      language: channel.language,
      recentTopics: published,
      avoid,
    });

    // Davom ettirsak — oxirgi rejadagi postdan KEYIN boshlaymiz
    const last = existing.at(-1)?.scheduledFor;
    const from = last ? new Date(last.getTime() + 1000) : new Date();
    const slots = computeSchedule(channel.times, channel.timezone, topics.length, from);

    const startIndex = existing.length;
    const docs = topics.map((topic, i) => ({
      ownerId: ctx.from.id,
      channelId: channel._id,
      challengeId: challenge._id,
      topic,
      status: 'planned',
      source: 'auto',
      scheduledFor: slots[i] ?? null,
      planIndex: startIndex + i + 1,
    }));

    await Post.insertMany(docs);

    // Challenge statistikasi
    const bounds = await Post.find({ challengeId: challenge._id, status: 'planned' })
      .sort({ scheduledFor: 1 })
      .select('scheduledFor')
      .lean();

    await Challenge.updateOne(
      { _id: challenge._id },
      {
        $set: {
          totalTopics: (challenge.totalTopics ?? 0) + docs.length,
          startsAt: bounds[0]?.scheduledFor ?? null,
          endsAt: bounds.at(-1)?.scheduledFor ?? null,
          ...(extending ? { days: (challenge.days ?? 0) + Number(days) } : {}),
        },
      }
    );

    log.info(
      `Reja ${extending ? 'davom ettirildi' : 'tuzildi'}: ` +
        `+${docs.length} ta (jami ${startIndex + docs.length}) — ${channel.title}`
    );

    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});

    if (extending) {
      await ctx.reply(
        lines(
          `✅ <b>+${docs.length} ta mavzu qo‘shildi</b>`,
          '',
          `Jami: <b>${startIndex + docs.length} ta</b>`,
          slots.at(-1)
            ? `Oxirgi post: <b>${formatInZone(slots.at(-1), channel.timezone)}</b>`
            : null
        ),
        { parse_mode: 'HTML' }
      );
    }

    return showPlan(ctx, channel._id);
  } catch (err) {
    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});
    throw err;
  }
}

// ---------------------------------------- "Yana necha kun qo'shamiz?"

export async function askExtendDays(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  const items = await Post.find({ channelId: channel._id, status: 'planned' })
    .sort({ scheduledFor: -1 })
    .limit(1)
    .lean();

  const lastDate = items[0]?.scheduledFor;
  const total = await remainingPlanCount(channel._id);

  await ctx.answerCbQuery();
  await setState(ctx, {
    name: 'awaiting_extend_days',
    channelId: String(channel._id),
  });

  const text = lines(
    `➕ <b>Rejani davom ettirish</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
    '',
    `Hozir rejada: <b>${total} ta</b> mavzu`,
    lastDate
      ? `Oxirgi post: <b>${formatInZone(lastDate, channel.timezone)}</b>`
      : null,
    '',
    'Yana necha kun qo‘shamiz?',
    '',
    'Mavjud mavzular saqlanadi — yangilari oxiriga qo‘shiladi',
    'va eskilarini takrorlamaydi.'
  );

  const kb = Markup.inlineKeyboard([
    DAY_PRESETS.map((d) =>
      Markup.button.callback(`+${d} kun`, `plan:ext:${channel._id}:${d}`)
    ),
    [Markup.button.callback('⬅️ Orqaga', `plan:show:${channel._id}`)],
  ]);

  return safeEdit(ctx, text, kb);
}

export async function handleExtendDaysText(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const days = Number(text.trim());

  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return ctx.reply(`1 dan ${MAX_DAYS} gacha butun son yozing.`);
  }

  await clearState(ctx);
  return extendPlan(ctx, channelId, days);
}

// =====================================================================
//  3. Rejani ko'rsatish
// =====================================================================

export async function showPlan(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.reply('Kanal topilmadi. /menyu');

  const items = await Post.find({ channelId: channel._id, status: 'planned' })
    .sort({ scheduledFor: 1 })
    .lean();

  if (items.length === 0) {
    const text = lines(
      `📅 <b>Kontent reja</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
      '',
      'Hozircha reja yo‘q.',
      '',
      'Reja tuzsangiz — qaysi kuni qanday mavzu chiqishini',
      'oldindan ko‘rasiz va xohlaganini almashtira olasiz.'
    );
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('📅 Reja tuzish', `plan:ask:${channel._id}`)],
      [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
    ]);
    return ctx.callbackQuery
      ? safeEdit(ctx, text, kb)
      : ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }

  // --- Holat: tasdiqlanganmi, birinchi post qachon, qanday rejimda ---
  const firstPost = items[0]?.scheduledFor;
  const challenge = await getActiveChallenge(channel);
  const state = challenge?.state ?? 'draft';

  const statusLine = {
    draft: '⏳ <b>TASDIQLANMAGAN</b> — postlar hali chiqmaydi',
    active: '✅ <b>FAOL</b> — reja bo‘yicha chiqib turadi',
    paused: '⏸ <b>PAUZADA</b> — vaqtincha to‘xtatilgan',
  }[state];

  const modeLine = channel.autoPublish
    ? '⚡️ Postlar to‘g‘ridan kanalga chiqadi'
    : '✋ Har bir post avval sizga tasdiqqa keladi';

  const out = [
    `📅 <b>Kontent reja</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
    channel.planTopic?.trim()
      ? `🎯 <i>${escapeHtml(channel.planTopic.trim())}</i>`
      : null,
    `${items.length} ta mavzu · ${channel.timezone}`,
    '',
    statusLine,
    state === 'active' && firstPost
      ? `🚀 Birinchi post: <b>${formatInZone(firstPost, channel.timezone)}</b>`
      : null,
    state === 'draft' ? 'Mavzularni ko‘rib chiqing, kerak bo‘lsa' : null,
    state === 'draft' ? 'o‘zgartiring — keyin pastdan tasdiqlang.' : null,
    modeLine,
    '',
  ].filter(Boolean);

  let lastDay = '';
  items.forEach((item, i) => {
    const when = item.scheduledFor
      ? formatInZone(item.scheduledFor, channel.timezone)
      : '—';

    // Sana bir marta, keyin faqat vaqt — ro'yxat ixcham bo'lsin
    const [day, time] = splitWhen(when);
    if (day !== lastDay) {
      out.push(`<b>${day}</b>`);
      lastDay = day;
    }
    out.push(`  <code>${String(i + 1).padStart(2)}</code> ${time} — ${escapeHtml(item.topic)}`);
  });

  // Reja qachon tugashi — "davom ettirish" kerakligini ko'rsatadi
  const endsAt = items.at(-1)?.scheduledFor;
  if (endsAt) {
    out.push('', `<i>Reja ${formatInZone(endsAt, channel.timezone)} da tugaydi</i>`);
  }

  let text = out.join('\n');
  if (text.length > 3800) {
    text = text.slice(0, 3800) + '\n\n<i>...ro‘yxat uzun, qisqartirildi</i>';
  }

  // Holatga qarab birinchi qator o'zgaradi
  const stateRow =
    state === 'draft'
      ? [Markup.button.callback('✅ TASDIQLASH — rejani yoqish', `plan:confirm:${channel._id}`)]
      : [
          Markup.button.callback(
            state === 'paused' ? '▶️ Davom ettirish' : '⏸ Pauza',
            `plan:pause:${channel._id}`
          ),
          Markup.button.callback(
            channel.autoPublish ? '✋ Tasdiq so‘ra' : '⚡️ Darhol joyla',
            `sch:auto:${channel._id}`
          ),
        ];

  const kb = Markup.inlineKeyboard([
    stateRow,
    [Markup.button.callback('➕ Davom ettirish', `plan:more:${channel._id}`)],
    [
      Markup.button.callback('🔄 AI almashtirsin', `plan:swap:${channel._id}`),
      Markup.button.callback('✏️ O‘zim yozaman', `plan:man:${channel._id}`),
    ],
    [Markup.button.callback('🆕 Butun rejani qayta tuzish', `plan:ask:${channel._id}`)],
    [Markup.button.callback('🗑 Rejani o‘chirish', `plan:clear:${channel._id}`)],
    [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
  ]);

  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

/** "11-oktabr 12:00" → ["11-oktabr", "12:00"] */
function splitWhen(when) {
  const m = String(when).match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
  return m ? [m[1], m[2]] : [when, ''];
}

// =====================================================================
//  4. Bitta mavzuni almashtirish
// =====================================================================

export async function startSwap(ctx, channelId) {
  const count = await Post.countDocuments({ channelId, status: 'planned' });
  if (count === 0) return ctx.answerCbQuery('Reja bo‘sh', { show_alert: true });

  await ctx.answerCbQuery();
  await setState(ctx, { name: 'awaiting_swap_number', channelId: String(channelId) });

  await ctx.reply(
    lines(
      '🔄 <b>Mavzu almashtirish</b>',
      '',
      `Qaysi raqamni almashtiray? (1–${count})`,
      '',
      'Bir nechtasini birdan yozsangiz ham bo‘ladi:  <code>3 7 12</code>',
      '',
      'Bekor qilish: /bekor'
    ),
    { parse_mode: 'HTML' }
  );
}

export async function handleSwapNumber(ctx, text) {
  const { channelId } = ctx.user.state ?? {};

  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /menyu');
  }

  const items = await Post.find({ channelId: channel._id, status: 'planned' })
    .sort({ scheduledFor: 1 })
    .lean();

  // "3 7 12" yoki "3,7,12"
  const numbers = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= items.length)
    ),
  ].sort((a, b) => a - b);

  if (numbers.length === 0) {
    return ctx.reply(`1 dan ${items.length} gacha raqam yozing.`);
  }

  await clearState(ctx);

  const status = await ctx.reply(
    `🧠 ${numbers.length} ta yangi mavzu o‘ylanmoqda...`
  );
  const typing = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    // Mavjud mavzularning hammasi "takrorlama" ro'yxatiga kiradi
    const avoid = items.map((i) => i.topic);
    const changed = [];

    for (const n of numbers) {
      const item = items[n - 1];
      const fresh = await suggestTopic({
        channelTopic: planTopicOf(channel),
        recentTopics: avoid,
      });

      await Post.updateOne({ _id: item._id }, { $set: { topic: fresh } });
      avoid.push(fresh);
      changed.push({ n, from: item.topic, to: fresh });
    }

    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});

    await ctx.reply(
      lines(
        '✅ <b>Almashtirildi</b>',
        '',
        ...changed.map((c) =>
          lines(
            `<b>${c.n}.</b> <s>${escapeHtml(c.from)}</s>`,
            `    ↓`,
            `    ${escapeHtml(c.to)}`,
            ''
          )
        )
      ),
      { parse_mode: 'HTML' }
    );

    return showPlan(ctx, channel._id);
  } catch (err) {
    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});
    throw err;
  }
}

// =====================================================================
//  5. O'z mavzusini kiritish
// =====================================================================

export async function startManualTopic(ctx, channelId) {
  const count = await Post.countDocuments({ channelId, status: 'planned' });
  if (count === 0) return ctx.answerCbQuery('Reja bo‘sh', { show_alert: true });

  await ctx.answerCbQuery();
  await setState(ctx, {
    name: 'awaiting_manual_number',
    channelId: String(channelId),
  });

  await ctx.reply(
    lines(
      '✏️ <b>O‘z mavzuingizni yozish</b>',
      '',
      `Qaysi raqamni o‘zgartiramiz? (1–${count})`,
      '',
      'Tezroq usul — raqam va mavzuni birga yozing:',
      '<code>7 = Bitcoin yarimlanishi nima</code>',
      '',
      'Bekor qilish: /bekor'
    ),
    { parse_mode: 'HTML' }
  );
}

/** 1-qadam: raqam (yoki "7 = mavzu" bir yo'la) */
export async function handleManualNumber(ctx, text) {
  const { channelId } = ctx.user.state ?? {};

  const items = await Post.find({ channelId, status: 'planned' })
    .sort({ scheduledFor: 1 })
    .lean();

  if (items.length === 0) {
    await clearState(ctx);
    return ctx.reply('Reja bo‘sh. /menyu');
  }

  // "7 = mavzu"  yoki  "7: mavzu"  yoki  "7 - mavzu"
  const combined = text.match(/^\s*(\d+)\s*[=:\-–]\s*(.+)$/s);
  const num = Number(combined ? combined[1] : text.trim());

  if (!Number.isInteger(num) || num < 1 || num > items.length) {
    return ctx.reply(`1 dan ${items.length} gacha raqam yozing.`);
  }

  const item = items[num - 1];

  // Mavzu ham berilgan — darhol saqlaymiz
  if (combined) {
    return saveManualTopic(ctx, item, num, combined[2]);
  }

  // 2-qadamga o'tamiz
  await setState(ctx, {
    name: 'awaiting_manual_topic',
    channelId: String(channelId),
    postId: String(item._id),
    number: num,
  });

  await ctx.reply(
    lines(
      `✏️ <b>${num}-mavzu</b>`,
      '',
      `Hozirgi: <i>${escapeHtml(item.topic)}</i>`,
      '',
      'Yangi mavzuni yozing.'
    ),
    { parse_mode: 'HTML' }
  );
}

/** 2-qadam: mavzu matni */
export async function handleManualTopic(ctx, text) {
  const { postId, number, channelId } = ctx.user.state ?? {};

  const item = await Post.findOne({
    _id: postId,
    ownerId: ctx.from.id,
    status: 'planned',
  }).lean();

  if (!item) {
    await clearState(ctx);
    return ctx.reply('Mavzu topilmadi — reja o‘zgargan bo‘lishi mumkin. /menyu');
  }

  return saveManualTopic(ctx, item, number, text, channelId);
}

async function saveManualTopic(ctx, item, number, raw, channelId) {
  const topic = raw.trim().replace(/\s+/g, ' ');

  if (topic.length < 3) return ctx.reply('Mavzu juda qisqa. Kamida 3 belgi.');
  if (topic.length > 200) return ctx.reply('Mavzu juda uzun (200 belgidan kam).');

  await Post.updateOne({ _id: item._id }, { $set: { topic } });
  await clearState(ctx);

  log.info(`Mavzu qo'lda o'zgartirildi: #${number} → "${topic}"`);

  await ctx.reply(
    lines(
      '✅ <b>O‘zgartirildi</b>',
      '',
      `<b>${number}.</b> <s>${escapeHtml(item.topic)}</s>`,
      '    ↓',
      `    <b>${escapeHtml(topic)}</b>`
    ),
    { parse_mode: 'HTML' }
  );

  return showPlan(ctx, channelId ?? item.channelId);
}

// =====================================================================
//  6. Pauza / davom
// =====================================================================

/** ✅ Tasdiqlash — draft → active. Shundan keyingina postlar chiqa boshlaydi. */
export async function confirmPlan(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  const count = await remainingPlanCount(channel._id);
  if (count === 0) {
    return ctx.answerCbQuery('Reja bo‘sh — avval mavzular tuzing', { show_alert: true });
  }

  if (!channel.activeChallengeId) {
    return ctx.answerCbQuery('Challenge topilmadi', { show_alert: true });
  }

  await Challenge.updateOne(
    { _id: channel.activeChallengeId },
    { $set: { state: 'active', confirmedAt: new Date() } }
  );
  await ctx.answerCbQuery('✅ Tasdiqlandi — reja ishga tushdi');
  log.info(`Reja tasdiqlandi: ${count} ta mavzu — ${channel.title}`);

  const first = await Post.findOne({ channelId: channel._id, status: 'planned' })
    .sort({ scheduledFor: 1 })
    .lean();

  await ctx.reply(
    lines(
      '✅ <b>Reja tasdiqlandi va ishga tushdi!</b>',
      '',
      `📢 ${escapeHtml(channel.title ?? channel.chatId)}`,
      `📅 ${count} ta mavzu navbatda`,
      first
        ? `🚀 Birinchi post: <b>${formatInZone(first.scheduledFor, channel.timezone)}</b>`
        : null,
      '',
      channel.autoPublish
        ? '⚡️ Postlar to‘g‘ridan kanalga chiqadi.'
        : '✋ Har bir post avval sizga tasdiqqa keladi.'
    ),
    { parse_mode: 'HTML' }
  );

  return showPlan(ctx, channel._id);
}

/** ⏸ / ▶️ — active ↔ paused */
export async function togglePause(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  const challenge = await getActiveChallenge(channel);

  // Tasdiqlanmagan rejani pauzaga qo'yish ma'nosiz
  if (!challenge || challenge.state === 'draft') {
    return ctx.answerCbQuery('Avval rejani tasdiqlang', { show_alert: true });
  }

  const next = challenge.state === 'paused' ? 'active' : 'paused';
  await Challenge.updateOne({ _id: challenge._id }, { $set: { state: next } });

  await ctx.answerCbQuery(
    next === 'paused' ? '⏸ To‘xtatildi — postlar chiqmaydi' : '▶️ Davom etmoqda'
  );
  log.info(`Reja holati: ${next} — ${channel.title}`);

  return showPlan(ctx, channel._id);
}

// =====================================================================
//  7. Rejani o'chirish
// =====================================================================

export async function clearPlan(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  const { deletedCount } = await Post.deleteMany({
    channelId: channel._id,
    status: 'planned',
  });

  await ctx.answerCbQuery(`${deletedCount} ta mavzu o‘chirildi`);
  log.info(`Reja o'chirildi: ${deletedCount} ta — ${channel.title}`);

  return showPlan(ctx, channel._id);
}

// =====================================================================
//  8. Challengelarim — tarix
// =====================================================================

const STATE_BADGE = {
  draft: '⏳',
  active: '✅',
  paused: '⏸',
  completed: '🏁',
  archived: '📦',
};

const STATE_LABEL = {
  draft: 'tasdiqlanmagan',
  active: 'faol',
  paused: 'pauzada',
  completed: 'tugagan',
  archived: 'arxivda',
};

/** Hamma challengelar ro'yxati — eng yangisi tepada */
export async function listChallenges(ctx) {
  const challenges = await Challenge.find({ ownerId: ctx.from.id })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  if (challenges.length === 0) {
    const text = lines(
      '📚 <b>Challengelarim</b>',
      '',
      'Hali challenge tuzilmagan.',
      '',
      'Challenge — bu oldindan tuzilgan mavzular ketma-ketligi.',
      'Kanal o‘quvchisi ularni tartib bilan o‘qib, mavzuni',
      'bosqichma-bosqich o‘rganadi.'
    );
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('⏰ Reja bo‘limi', 'menu:schedule')],
      [Markup.button.callback('⬅️ Menyu', 'menu:main')],
    ]);
    return ctx.callbackQuery
      ? safeEdit(ctx, text, kb)
      : ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }

  // Kanal nomlarini bir so'rovda olamiz
  const channels = await Channel.find({ ownerId: ctx.from.id })
    .select('title chatId')
    .lean();
  const nameOf = new Map(channels.map((c) => [String(c._id), c.title ?? c.chatId]));

  // Har bir challenge uchun: nechtasi joylangan
  const counts = await Post.aggregate([
    { $match: { ownerId: ctx.from.id, challengeId: { $ne: null } } },
    { $group: { _id: { c: '$challengeId', s: '$status' }, n: { $sum: 1 } } },
  ]);

  const stat = new Map();
  for (const row of counts) {
    const key = String(row._id.c);
    const entry = stat.get(key) ?? { published: 0, planned: 0 };
    if (row._id.s === 'published') entry.published = row.n;
    if (row._id.s === 'planned') entry.planned = row.n;
    stat.set(key, entry);
  }

  const out = ['📚 <b>Challengelarim</b>', ''];
  const buttons = [];

  for (const ch of challenges) {
    const s = stat.get(String(ch._id)) ?? { published: 0, planned: 0 };
    const total = ch.totalTopics || s.published + s.planned;
    const badge = STATE_BADGE[ch.state] ?? '•';

    out.push(
      `${badge} <b>${escapeHtml(ch.topic)}</b>`,
      `    📢 ${escapeHtml(nameOf.get(String(ch.channelId)) ?? '—')}`,
      `    📊 ${s.published}/${total} joylangan · ${STATE_LABEL[ch.state] ?? ch.state}`,
      ''
    );

    buttons.push([
      Markup.button.callback(
        `${badge} ${ch.topic.slice(0, 32)}`,
        `ch:open:${ch._id}`
      ),
    ]);
  }

  buttons.push([Markup.button.callback('⬅️ Menyu', 'menu:main')]);

  let text = out.join('\n');
  if (text.length > 3800) text = text.slice(0, 3800) + '\n<i>...</i>';

  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return ctx.callbackQuery
    ? safeEdit(ctx, text, Markup.inlineKeyboard(buttons))
    : ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

/** Bitta challenge ichini ko'rish — mavzular va natija */
export async function openChallenge(ctx, challengeId) {
  const ch = await Challenge.findOne({
    _id: challengeId,
    ownerId: ctx.from.id,
  }).lean();

  if (!ch) return ctx.answerCbQuery('Challenge topilmadi', { show_alert: true });

  const channel = await Channel.findById(ch.channelId).lean();

  // Faol challenge bo'lsa — to'liq boshqaruv ekranini ochamiz
  if (channel && String(channel.activeChallengeId) === String(ch._id)) {
    return showPlan(ctx, ch.channelId);
  }

  // Arxivdagi/tugagan challenge — faqat ko'rish
  const posts = await Post.find({ challengeId: ch._id })
    .sort({ scheduledFor: 1 })
    .select('topic status scheduledFor publishedAt')
    .lean();

  const published = posts.filter((p) => p.status === 'published').length;

  const out = [
    `${STATE_BADGE[ch.state] ?? '•'} <b>${escapeHtml(ch.topic)}</b>`,
    `📢 ${escapeHtml(channel?.title ?? '—')}`,
    `📊 ${published}/${ch.totalTopics} joylangan · ${STATE_LABEL[ch.state] ?? ch.state}`,
    ch.startsAt && channel
      ? `📅 ${formatInZone(ch.startsAt, channel.timezone)} — ${formatInZone(ch.endsAt, channel.timezone)}`
      : null,
    '',
  ].filter(Boolean);

  posts.forEach((p, i) => {
    const mark = p.status === 'published' ? '✅' : p.status === 'planned' ? '○' : '·';
    out.push(`${mark} <code>${String(i + 1).padStart(2)}</code> ${escapeHtml(p.topic)}`);
  });

  let text = out.join('\n');
  if (text.length > 3800) text = text.slice(0, 3800) + '\n<i>...</i>';

  const buttons = [];
  if (ch.state !== 'completed') {
    buttons.push([
      Markup.button.callback('🔁 Shu mavzuda yangi challenge', `ch:again:${ch._id}`),
    ]);
  } else {
    buttons.push([
      Markup.button.callback('🔁 Yana shu mavzuda', `ch:again:${ch._id}`),
    ]);
  }
  buttons.push([Markup.button.callback('⬅️ Challengelarim', 'menu:challenges')]);

  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  return safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
}

/** Eski challenge mavzusini olib, yangisini tuzishga o'tish */
export async function repeatChallenge(ctx, challengeId) {
  const ch = await Challenge.findOne({
    _id: challengeId,
    ownerId: ctx.from.id,
  }).lean();
  if (!ch) return ctx.answerCbQuery('Challenge topilmadi', { show_alert: true });

  await Channel.updateOne(
    { _id: ch.channelId, ownerId: ctx.from.id },
    { $set: { planTopic: ch.usesChannelTopic ? null : ch.topic } }
  );

  await ctx.answerCbQuery('Mavzu olindi');
  return askPlanDays(ctx, ch.channelId);
}

// =====================================================================
//  Yordamchi
// =====================================================================

/** Allaqachon joylangan mavzular — reja ularni takrorlamasin */
async function publishedTopics(channelId, limit = 30) {
  const posts = await Post.find({ channelId, status: 'published' })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .select('topic')
    .lean();
  return posts.map((p) => p.topic).filter(Boolean);
}

/**
 * Scheduler uchun: kanalning keyingi rejadagi mavzusi.
 * Bo'lmasa null qaytaradi — u holda scheduler o'zi mavzu o'ylab topadi.
 */
export async function takeNextPlanned(channelId, now = new Date()) {
  return Post.findOne({
    channelId,
    status: 'planned',
    scheduledFor: { $lte: new Date(now.getTime() + 60_000) }, // 1 daqiqa zapas
  })
    .sort({ scheduledFor: 1 })
    .lean();
}

/** Rejada nechta mavzu qolgan */
export async function remainingPlanCount(channelId) {
  return Post.countDocuments({ channelId, status: 'planned' });
}
