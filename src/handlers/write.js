import { Markup } from 'telegraf';
import { Channel } from '../models/Channel.js';
import { Post } from '../models/Post.js';
import { setState, clearState } from '../middleware/auth.js';
import { generatePost, suggestTopic } from '../ai.js';
import { publishPost, postUrl, sendToChannel } from '../publish.js';
import { escapeHtml, safeEdit, lines } from '../utils.js';

const RECENT_LIMIT = 10;

// =====================================================================
//  1. "Post yozish" — kanalni tanlash yoki to'g'ridan mavzu so'rash
// =====================================================================

export async function startWrite(ctx) {
  const channels = await Channel.find({ ownerId: ctx.from.id, active: true }).sort({
    createdAt: 1,
  });

  if (channels.length === 0) {
    const text = lines(
      '✍️ <b>Post yozish</b>',
      '',
      'Avval kanal ulash kerak.'
    );
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Kanal ulash', 'menu:connect')],
      [Markup.button.callback('⬅️ Menyu', 'menu:main')],
    ]);
    return ctx.callbackQuery
      ? safeEdit(ctx, text, kb)
      : ctx.reply(text, { parse_mode: 'HTML', ...kb });
  }

  // Bitta kanal bo'lsa — tanlash kerak emas
  if (channels.length === 1) {
    return askTopic(ctx, channels[0]);
  }

  // Bir nechta kanal — tanlash
  const kb = Markup.inlineKeyboard([
    ...channels.map((ch) => [
      Markup.button.callback(
        `📢 ${(ch.title ?? ch.chatId).slice(0, 28)}`,
        `write:pick:${ch._id}`
      ),
    ]),
    [Markup.button.callback('⬅️ Menyu', 'menu:main')],
  ]);

  const text = lines('✍️ <b>Post yozish</b>', '', 'Qaysi kanal uchun?');
  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

export async function pickChannelForWrite(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await ctx.answerCbQuery();
  return askTopic(ctx, channel);
}

async function askTopic(ctx, channel) {
  await setState(ctx, {
    name: 'awaiting_post_topic',
    channelId: String(channel._id),
  });

  const text = lines(
    `✍️ <b>${escapeHtml(channel.title ?? channel.chatId)}</b>`,
    `📝 Kanal mavzusi: <i>${escapeHtml(channel.topic)}</i>`,
    '',
    'Post mavzusini yozing.',
    '',
    'Yoki <b>🎲 O‘zing tanla</b> ni bosing — kanal mavzusidan kelib chiqib',
    'o‘zim mavzu o‘ylab topaman.',
    '',
    'Bekor qilish: /bekor'
  );

  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('🎲 O‘zing tanla', `write:auto:${channel._id}`)],
    [Markup.button.callback('⬅️ Menyu', 'menu:main')],
  ]);

  return ctx.callbackQuery
    ? safeEdit(ctx, text, kb)
    : ctx.reply(text, { parse_mode: 'HTML', ...kb });
}

// =====================================================================
//  2. Mavzu qabul qilindi → post yozish
// =====================================================================

export async function handlePostTopic(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const topic = text.trim();

  if (topic.length < 3) return ctx.reply('Mavzu juda qisqa.');
  if (topic.length > 300) return ctx.reply('Mavzu juda uzun (300 belgidan kam).');

  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /menyu');
  }

  await clearState(ctx);
  return generateAndPreview(ctx, channel, topic);
}

/** "O'zing tanla" — AI mavzuni ham o'zi tanlaydi */
export async function handleAutoTopic(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await ctx.answerCbQuery();
  await clearState(ctx);
  return generateAndPreview(ctx, channel, null); // null = AI o'zi tanlaydi
}

// =====================================================================
//  3. Generatsiya + preview
// =====================================================================

/**
 * Post yozadi, draft sifatida saqlaydi va preview ko'rsatadi.
 * Preview'ning o'zi — kanalga ketadigan matnning aynan ko'rinishi.
 */
export async function generateAndPreview(ctx, channel, topic) {
  // AI 10-15 sekund ishlaydi — foydalanuvchi kutayotganini bilsin
  const status = await ctx.reply('✍️ Post yozilmoqda, 10-15 sekund...');
  const typing = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4000);

  try {
    const recentTopics = await recentTopicsFor(channel._id);

    // Mavzu berilmagan bo'lsa AI o'zi tanlaydi
    let finalTopic = topic;
    if (!finalTopic) {
      finalTopic = await suggestTopic({
        channelTopic: channel.topic,
        recentTopics,
      });
    }

    const text = await generatePost({
      topic: finalTopic,
      channelTopic: channel.topic,
      tone: channel.tone,
      language: channel.language,
      recentTopics,
    });

    const post = await Post.create({
      ownerId: ctx.from.id,
      channelId: channel._id,
      topic: finalTopic,
      text,
      status: 'draft',
      source: 'manual',
    });

    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});

    await sendPreview(ctx, channel, post);
  } catch (err) {
    clearInterval(typing);
    await ctx.telegram.deleteMessage(status.chat.id, status.message_id).catch(() => {});
    throw err;
  }
}

/** Preview tugmalari */
export function previewKeyboard(postId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Joylash', `post:pub:${postId}`),
      Markup.button.callback('🔄 Qayta yozish', `post:retry:${postId}`),
    ],
    [
      Markup.button.callback('✏️ Boshqa mavzu', `post:newtopic:${postId}`),
      Markup.button.callback('❌ Bekor', `post:cancel:${postId}`),
    ],
  ]);
}

/**
 * Preview — ikkita xabar: sarlavha va postning o'zi.
 * Postning o'zi aynan kanalga ketadigan ko'rinishda yuboriladi.
 *
 * telegram + chatId qabul qiladi, shuning uchun scheduler ham
 * (ctx'siz) shu funksiyani ishlatadi.
 */
export async function sendPreviewTo(telegram, chatId, channel, post, note = null) {
  await telegram.sendMessage(
    chatId,
    lines(
      note,
      note ? '' : null,
      `📋 <b>Preview</b> — ${escapeHtml(channel.title ?? channel.chatId)}`,
      `🏷 Mavzu: <i>${escapeHtml(post.topic)}</i>`,
      `📏 ${post.text.length} belgi`,
      '',
      '<i>Pastdagi xabar — kanalga aynan shunday ketadi:</i>'
    ),
    { parse_mode: 'HTML' }
  );

  // sendToChannel ishlatamiz — AI noto'g'ri HTML bersa, teglarsiz
  // qayta yuboradi. Aks holda butun preview yiqiladi.
  await sendToChannel(telegram, chatId, post.text, previewKeyboard(post._id));
}

export async function sendPreview(ctx, channel, post) {
  return sendPreviewTo(ctx.telegram, ctx.chat.id, channel, post);
}

/** Oxirgi mavzular — AI takrorlamasligi uchun (scheduler ham ishlatadi) */
export async function recentTopicsFor(channelId) {
  const posts = await Post.find({ channelId })
    .sort({ createdAt: -1 })
    .limit(RECENT_LIMIT)
    .select('topic')
    .lean();
  return posts.map((p) => p.topic).filter(Boolean);
}

// =====================================================================
//  4. Preview tugmalari
// =====================================================================

/** Draftni egasi bilan birga topish — ownerId xavfsizlik uchun */
async function findDraft(ctx, postId) {
  const post = await Post.findOne({ _id: postId, ownerId: ctx.from.id });
  if (!post) {
    await ctx.answerCbQuery('Post topilmadi', { show_alert: true });
    return null;
  }
  const channel = await Channel.findOne({ _id: post.channelId, ownerId: ctx.from.id });
  if (!channel) {
    await ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });
    return null;
  }
  return { post, channel };
}

// --- ✅ Joylash ---

export async function publishDraft(ctx, postId) {
  const found = await findDraft(ctx, postId);
  if (!found) return;
  const { post, channel } = found;

  if (post.status === 'published') {
    return ctx.answerCbQuery('Bu post allaqachon joylangan', { show_alert: true });
  }

  await ctx.answerCbQuery('Joylanmoqda...');

  try {
    const { url } = await publishPost(ctx.telegram, channel, post);

    // Tugmalarni olib tashlab, natijani ko'rsatamiz
    await ctx.editMessageReplyMarkup(
      url
        ? Markup.inlineKeyboard([[Markup.button.url('🔗 Kanalda ko‘rish', url)]]).reply_markup
        : undefined
    ).catch(() => {});

    await ctx.reply(
      lines(
        '✅ <b>Joylandi!</b>',
        `📢 ${escapeHtml(channel.title ?? channel.chatId)}`
      ),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✍️ Yana post', 'menu:write')],
          [Markup.button.callback('⬅️ Menyu', 'menu:main')],
        ]),
      }
    );
  } catch (err) {
    console.error('Joylash xatosi:', err.message);
    await ctx.reply(
      lines(
        '❌ Joylab bo‘lmadi.',
        '',
        `Sabab: <code>${escapeHtml(err.message)}</code>`,
        '',
        'Men kanalda hali ham adminmi? Tekshirib, qaytadan urinib ko‘ring.'
      ),
      { parse_mode: 'HTML' }
    );
  }
}

// --- 🔄 Qayta yozish (shu mavzuda) ---

export async function retryDraft(ctx, postId) {
  const found = await findDraft(ctx, postId);
  if (!found) return;
  const { post, channel } = found;

  await ctx.answerCbQuery('Qaytadan yozilmoqda...');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  // Eskisini rad etilgan deb belgilaymiz, yangisini yozamiz
  await Post.updateOne({ _id: post._id }, { $set: { status: 'rejected' } });
  await generateAndPreview(ctx, channel, post.topic);
}

// --- ✏️ Boshqa mavzu ---

export async function newTopicForDraft(ctx, postId) {
  const found = await findDraft(ctx, postId);
  if (!found) return;
  const { post, channel } = found;

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await Post.updateOne({ _id: post._id }, { $set: { status: 'rejected' } });

  await askTopic(ctx, channel);
}

// --- ❌ Bekor ---

export async function cancelDraft(ctx, postId) {
  const found = await findDraft(ctx, postId);
  if (!found) return;

  await Post.updateOne({ _id: found.post._id }, { $set: { status: 'rejected' } });
  await ctx.answerCbQuery('Bekor qilindi');
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply('❌ Post bekor qilindi.', Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Yangi post', 'menu:write')],
    [Markup.button.callback('⬅️ Menyu', 'menu:main')],
  ]));
}
