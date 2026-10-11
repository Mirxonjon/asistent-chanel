import { Markup } from 'telegraf';
import { Channel } from '../models/Channel.js';
import { Post } from '../models/Post.js';
import { setState, clearState } from '../middleware/auth.js';
import { rescheduleChannel } from '../scheduler.js';
import { remainingPlanCount, getActiveChallenge } from './plan.js';
import {
  normalizeTime,
  distributeTimes,
  formatInZone,
  nowInZone,
  isValidTimezone,
} from '../time.js';
import { escapeHtml, safeEdit, lines } from '../utils.js';

const MAX_PER_DAY = 12;

/** Reja holati belgilari */
const PLAN_BADGE = { draft: '⏳', active: '✅', paused: '⏸' };
const PLAN_LABEL = { draft: 'tasdiqlanmagan', active: 'faol', paused: 'pauzada' };
Object.assign(PLAN_BADGE, { completed: '🏁', archived: '📦' });
Object.assign(PLAN_LABEL, { completed: 'tugagan', archived: 'arxivda' });

// =====================================================================
//  1. Kanalni tanlash
// =====================================================================

export async function startSchedule(ctx) {
  const channels = await Channel.find({ ownerId: ctx.from.id, active: true }).sort({
    createdAt: 1,
  });

  if (channels.length === 0) {
    const text = lines('⏰ <b>Reja</b>', '', 'Avval kanal ulash kerak.');
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Kanal ulash', 'menu:connect')],
      [Markup.button.callback('⬅️ Menyu', 'menu:main')],
    ]);
    return ctx.callbackQuery
      ? safeEdit(ctx, text, kb)
      : ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }

  if (channels.length === 1) return showSchedule(ctx, channels[0]);

  const kb = Markup.inlineKeyboard([
    ...channels.map((ch) => [
      Markup.button.callback(
        `${ch.postsPerDay > 0 ? '⏰' : '⚪️'} ${(ch.title ?? ch.chatId).slice(0, 26)}`,
        `sch:pick:${ch._id}`
      ),
    ]),
    [Markup.button.callback('⬅️ Menyu', 'menu:main')],
  ]);

  const text = lines('⏰ <b>Reja</b>', '', 'Qaysi kanal uchun?');
  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

export async function pickChannelForSchedule(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });
  await ctx.answerCbQuery();
  return showSchedule(ctx, channel);
}

// =====================================================================
//  2. Hozirgi reja holati
// =====================================================================

export async function showSchedule(ctx, channel) {
  await clearState(ctx);

  const hasPlan = channel.postsPerDay > 0 && channel.times.length > 0;
  const plannedCount = await remainingPlanCount(channel._id);
  const challenge = await getActiveChallenge(channel);
  const chState = challenge?.state ?? 'draft';

  // Keyingi post mavzusi rejadan olinadimi?
  const nextPlanned = plannedCount
    ? await Post.findOne({ channelId: channel._id, status: 'planned' })
        .sort({ scheduledFor: 1 })
        .select('topic')
        .lean()
    : null;

  const text = lines(
    `⏰ <b>${escapeHtml(channel.title ?? channel.chatId)}</b>`,
    '',
    hasPlan
      ? lines(
          `📊 Kuniga: <b>${channel.postsPerDay} ta</b>`,
          `🕐 Vaqtlar: <b>${channel.times.join(', ')}</b>`,
          `🌍 Zona: ${channel.timezone} (hozir ${nowInZone(channel.timezone)})`,
          `➡️ Keyingi post: <b>${formatInZone(channel.nextRunAt, channel.timezone)}</b>`,
          nextPlanned
            ? `🏷 Mavzu: <i>${escapeHtml(nextPlanned.topic)}</i>`
            : '🏷 Mavzu: <i>AI o‘sha payt o‘ylab topadi</i>',
          plannedCount
            ? `${PLAN_BADGE[chState] ?? '⏳'} Challenge: <b>${plannedCount} ta</b> mavzu · ${PLAN_LABEL[chState] ?? chState}`
            : null,
          '',
          channel.autoPublish
            ? '⚡️ Rejim: <b>darhol joylaydi</b>'
            : '✋ Rejim: <b>avval tasdiq so‘raydi</b>'
        )
      : 'Reja hali tuzilmagan — avtomatik post yo‘q.'
  );

  const buttons = [];

  buttons.push([
    Markup.button.callback(
      hasPlan ? '✏️ Rejani o‘zgartirish' : '➕ Reja tuzish',
      `sch:count:${channel._id}`
    ),
  ]);

  if (hasPlan) {
    // Kontent reja — qaysi kuni qanday mavzu chiqishi
    buttons.push([
      Markup.button.callback(
        plannedCount > 0
          ? `${PLAN_BADGE[chState] ?? '⏳'} Kontent reja (${plannedCount} ta)`
          : '📅 Kontent reja tuzish',
        plannedCount > 0 ? `plan:show:${channel._id}` : `plan:ask:${channel._id}`
      ),
    ]);
    buttons.push([
      Markup.button.callback(
        channel.autoPublish ? '✋ Tasdiq so‘rab tursin' : '⚡️ Darhol joylasin',
        `sch:auto:${channel._id}`
      ),
    ]);
    buttons.push([Markup.button.callback('🚫 Rejani o‘chirish', `sch:off:${channel._id}`)]);
  }

  buttons.push([Markup.button.callback('⬅️ Menyu', 'menu:main')]);

  return ctx.callbackQuery
    ? safeEdit(ctx, text, Markup.inlineKeyboard(buttons))
    : ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
}

// =====================================================================
//  3. Kuniga nechta post?
// =====================================================================

export async function askCount(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await ctx.answerCbQuery();
  await setState(ctx, {
    name: 'awaiting_posts_per_day',
    channelId: String(channel._id),
  });

  await safeEdit(
    ctx,
    lines(
      `⏰ <b>${escapeHtml(channel.title ?? channel.chatId)}</b>`,
      '',
      '<b>Kuniga nechta post joylansin?</b>',
      '',
      `Raqam yozing (1 dan ${MAX_PER_DAY} gacha).`,
      '',
      'Bekor qilish: /bekor'
    ),
    Markup.inlineKeyboard([
      [
        Markup.button.callback('1', `sch:n:${channel._id}:1`),
        Markup.button.callback('2', `sch:n:${channel._id}:2`),
        Markup.button.callback('3', `sch:n:${channel._id}:3`),
        Markup.button.callback('4', `sch:n:${channel._id}:4`),
      ],
      [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
    ])
  );
}

/** Raqam matn bilan kiritildi */
export async function handleCountText(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const count = Number(text.trim());

  if (!Number.isInteger(count) || count < 1 || count > MAX_PER_DAY) {
    return ctx.reply(`1 dan ${MAX_PER_DAY} gacha butun raqam yozing.`);
  }

  return afterCount(ctx, channelId, count);
}

/** Raqam tugma bilan tanlandi */
export async function handleCountButton(ctx, channelId, count) {
  await ctx.answerCbQuery();
  return afterCount(ctx, channelId, Number(count));
}

/** Raqam ma'lum — endi vaqtlarni qanday belgilashni so'raymiz */
async function afterCount(ctx, channelId, count) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /menyu');
  }

  await setState(ctx, {
    name: 'awaiting_times',
    channelId: String(channel._id),
    count,
  });

  const suggested = distributeTimes(count);

  const text = lines(
    `📊 Kuniga <b>${count} ta</b> post.`,
    '',
    '<b>Vaqtlarni qanday belgilaymiz?</b>',
    '',
    `🎲 <b>Avtomatik</b> — men taqsimlayman: <code>${suggested.join(', ')}</code>`,
    '',
    `⏰ <b>O‘zim</b> — ${count} ta vaqtni yozing, masalan:`,
    `<code>${suggested.join(' ')}</code>`,
    '',
    `🌍 Zona: <b>${channel.timezone}</b> (hozir ${nowInZone(channel.timezone)})`
  );

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('🎲 Avtomatik taqsimla', `sch:dist:${channel._id}:${count}`)],
    [Markup.button.callback('🌍 Zonani o‘zgartirish', `sch:tz:${channel._id}`)],
    [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
  ]);

  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

// =====================================================================
//  4. Vaqtlarni saqlash
// =====================================================================

/** 🎲 Avtomatik taqsimlash */
export async function applyDistributed(ctx, channelId, count) {
  await ctx.answerCbQuery();
  const times = distributeTimes(Number(count));
  return saveSchedule(ctx, channelId, Number(count), times);
}

/** ⏰ Qo'lda kiritilgan vaqtlar: "09:00 14:00 20:00" */
export async function handleTimesText(ctx, text) {
  const { channelId, count } = ctx.user.state ?? {};

  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);

  const times = parts.map(normalizeTime);
  const bad = parts.filter((_, i) => times[i] === null);

  if (bad.length) {
    return ctx.reply(
      lines(
        `❌ Tushunmadim: <code>${escapeHtml(bad.join(', '))}</code>`,
        '',
        'Vaqtni <code>SS:DD</code> ko‘rinishida yozing, masalan:',
        '<code>09:00 14:00 20:00</code>'
      ),
      { parse_mode: 'HTML' }
    );
  }

  const unique = [...new Set(times)].sort();

  if (unique.length !== count) {
    return ctx.reply(
      lines(
        `❌ ${count} ta vaqt kerak, siz ${unique.length} ta berdingiz.`,
        unique.length !== times.length ? '(takrorlangan vaqtlar olib tashlandi)' : null,
        '',
        `Aniq ${count} ta vaqt yozing.`
      ),
      { parse_mode: 'HTML' }
    );
  }

  return saveSchedule(ctx, channelId, count, unique);
}

async function saveSchedule(ctx, channelId, count, times) {
  const channel = await Channel.findOneAndUpdate(
    { _id: channelId, ownerId: ctx.from.id },
    { $set: { postsPerDay: count, times } },
    { returnDocument: 'after' }
  );

  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /menyu');
  }

  // nextRunAt ni hisoblab bazaga yozamiz — scheduler shuni o'qiydi
  const next = await rescheduleChannel(channel);
  await clearState(ctx);

  const text = lines(
    '✅ <b>Reja saqlandi!</b>',
    '',
    `📢 ${escapeHtml(channel.title ?? channel.chatId)}`,
    `📊 Kuniga ${count} ta post`,
    `🕐 ${times.join(', ')}  (${channel.timezone})`,
    `➡️ Birinchi post: <b>${formatInZone(next, channel.timezone)}</b>`,
    '',
    channel.autoPublish
      ? '⚡️ Postlar <b>darhol joylanadi</b>.'
      : '✋ Har bir post avval <b>sizga tasdiqqa</b> keladi.'
  );

  return ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback(
          channel.autoPublish ? '✋ Tasdiq so‘rab tursin' : '⚡️ Darhol joylasin',
          `sch:auto:${channel._id}`
        ),
      ],
      [Markup.button.callback('⬅️ Menyu', 'menu:main')],
    ]),
  });
}

// =====================================================================
//  5. Rejim almashtirish / o'chirish
// =====================================================================

export async function toggleAutoPublish(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  channel.autoPublish = !channel.autoPublish;
  await Channel.updateOne(
    { _id: channel._id },
    { $set: { autoPublish: channel.autoPublish } }
  );

  await ctx.answerCbQuery(
    channel.autoPublish ? '⚡️ Endi darhol joylaydi' : '✋ Endi tasdiq so‘raydi'
  );

  return showSchedule(ctx, channel);
}

export async function turnScheduleOff(ctx, channelId) {
  const channel = await Channel.findOneAndUpdate(
    { _id: channelId, ownerId: ctx.from.id },
    { $set: { postsPerDay: 0, times: [], nextRunAt: null } },
    { returnDocument: 'after' }
  );

  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await ctx.answerCbQuery('🚫 Reja o‘chirildi');
  return showSchedule(ctx, channel);
}

// =====================================================================
//  6. Vaqt zonasi
// =====================================================================

export async function askTimezone(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await ctx.answerCbQuery();
  await setState(ctx, { name: 'awaiting_timezone', channelId: String(channel._id) });

  const common = [
    ['Asia/Tashkent', 'Toshkent (UTC+5)'],
    ['Asia/Almaty', 'Olmaota (UTC+5)'],
    ['Europe/Moscow', 'Moskva (UTC+3)'],
    ['Asia/Dubai', 'Dubay (UTC+4)'],
    ['Europe/Istanbul', 'Istanbul (UTC+3)'],
  ];

  await safeEdit(
    ctx,
    lines(
      '🌍 <b>Vaqt zonasi</b>',
      '',
      `Hozir: <b>${channel.timezone}</b> (${nowInZone(channel.timezone)})`,
      '',
      'Pastdan tanlang yoki zona nomini yozing (masalan <code>Asia/Seoul</code>).'
    ),
    Markup.inlineKeyboard([
      ...common.map(([tz, label]) => [
        Markup.button.callback(label, `sch:settz:${channel._id}:${tz}`),
      ]),
      [Markup.button.callback('⬅️ Orqaga', `sch:pick:${channel._id}`)],
    ])
  );
}

export async function setTimezone(ctx, channelId, tz) {
  if (!isValidTimezone(tz)) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('Bu zona tanilmadi', { show_alert: true });
    }
    return ctx.reply(
      lines(
        `❌ <code>${escapeHtml(tz)}</code> — bunday zona yo‘q.`,
        '',
        'Namuna: <code>Asia/Tashkent</code>, <code>Europe/Moscow</code>'
      ),
      { parse_mode: 'HTML' }
    );
  }

  const channel = await Channel.findOneAndUpdate(
    { _id: channelId, ownerId: ctx.from.id },
    { $set: { timezone: tz } },
    { returnDocument: 'after' }
  );
  if (!channel) return ctx.reply('Kanal topilmadi. /menyu');

  // Zona o'zgardi — keyingi post vaqtini qayta hisoblash shart
  await rescheduleChannel(channel);
  const fresh = await Channel.findById(channel._id);

  if (ctx.callbackQuery) await ctx.answerCbQuery(`🌍 ${tz}`);
  await clearState(ctx);
  return showSchedule(ctx, fresh);
}

export async function handleTimezoneText(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  return setTimezone(ctx, channelId, text.trim());
}
