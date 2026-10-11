import { Markup } from 'telegraf';
import { Channel } from '../models/Channel.js';
import { setState, clearState } from '../middleware/auth.js';
import { escapeHtml, safeEdit, lines } from '../utils.js';

const backToMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⬅️ Menyu', 'menu:main')],
]);

// ------------------------------------------------- 1. Ko'rsatma ko'rsatish

export async function startConnect(ctx) {
  await setState(ctx, { name: 'awaiting_channel' });

  const text = lines(
    '➕ <b>Kanal ulash</b>',
    '',
    '<b>1-qadam.</b> Meni kanalingizga admin qilib qo‘shing.',
    `   Kanal → Administrators → Add Admin → <code>@${ctx.botInfo.username}</code>`,
    '   «Post Messages» huquqi <b>yoqilgan</b> bo‘lishi shart.',
    '',
    '<b>2-qadam.</b> Kanalni menga ko‘rsating — ikki yo‘l bor:',
    '',
    '   📨 <b>Kanaldan biror postni menga forward qiling</b>',
    '       (eng ishonchli — yopiq kanallar uchun ham ishlaydi)',
    '',
    '   ✍️ yoki kanal manzilini yozing: <code>@kanal_nomi</code>',
    '',
    '<i>Kutib turaman...</i>'
  );

  if (ctx.callbackQuery) await safeEdit(ctx, text, backToMenu);
  else await ctx.reply(text, { parse_mode: 'HTML', ...backToMenu });
}

// ------------------------------------------- Forward'dan kanalni ajratish

/**
 * Bot API 7.0 dan boshlab forward_origin ishlatiladi, lekin eski
 * forward_from_chat ham hali keladi. Ikkisini ham qo'llab-quvvatlaymiz.
 */
export function extractForwardedChannel(message) {
  const origin = message?.forward_origin;
  if (origin?.type === 'channel' && origin.chat) return origin.chat;

  const legacy = message?.forward_from_chat;
  if (legacy?.type === 'channel') return legacy;

  return null;
}

// ------------------------------------------------- 2. Tekshirish va saqlash

/**
 * ENG MUHIM FUNKSIYA. Ikki tomonlama tekshiruv:
 *   1) Botning kanalda post yuborish huquqi bormi?
 *   2) So'rov yuborgan odam shu kanalning admini/egasimi?
 *
 * Ikkinchisi bo'lmasa — istalgan odam begona kanalni o'ziga ulab,
 * unga post joylay oladigan bo'lib qoladi.
 */
export async function verifyAndSaveChannel(ctx, chatRef) {
  // --- Kanal mavjudmi va bot uni ko'radimi? ---
  let chat;
  try {
    chat = await ctx.telegram.getChat(chatRef);
  } catch {
    return fail(
      ctx,
      lines(
        '❌ Kanal topilmadi.',
        '',
        'Sabablari:',
        '• Men hali kanalga qo‘shilmaganman',
        '• Kanal manzili xato yozilgan',
        '• Kanal yopiq — bu holda manzil emas, <b>forward</b> qiling',
        '',
        'Tekshirib, qaytadan urinib ko‘ring.'
      )
    );
  }

  if (chat.type !== 'channel') {
    return fail(
      ctx,
      '❌ Bu kanal emas. Guruh yoki shaxsiy chat ulanmaydi — faqat kanal.'
    );
  }

  const chatId = String(chat.id);
  const title = chat.title ?? chatId;

  // --- TEKSHIRUV 1: botning huquqi ---
  let botMember;
  try {
    botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
  } catch {
    return fail(
      ctx,
      lines(
        `❌ <b>${escapeHtml(title)}</b> kanalida men admin emas ekanman.`,
        '',
        `Kanal → Administrators → Add Admin → <code>@${ctx.botInfo.username}</code>`
      )
    );
  }

  if (botMember.status !== 'administrator') {
    return fail(
      ctx,
      lines(
        `❌ Men <b>${escapeHtml(title)}</b> da admin emasman.`,
        '',
        'Meni admin qilib qo‘ying, keyin qaytadan urinib ko‘ring.'
      )
    );
  }

  if (!botMember.can_post_messages) {
    return fail(
      ctx,
      lines(
        `❌ Men <b>${escapeHtml(title)}</b> da adminman, lekin post yuborish huquqim yo‘q.`,
        '',
        'Admin sozlamalarida <b>«Post Messages»</b> ni yoqing.'
      )
    );
  }

  // --- TEKSHIRUV 2: foydalanuvchining huquqi ---
  let userMember;
  try {
    userMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
  } catch {
    return fail(
      ctx,
      lines(
        '❌ Sizning kanaldagi huquqingizni tekshira olmadim.',
        '',
        'Siz kanalning admini bo‘lishingiz kerak.'
      )
    );
  }

  if (!['creator', 'administrator'].includes(userMember.status)) {
    return fail(
      ctx,
      lines(
        `🚫 Siz <b>${escapeHtml(title)}</b> kanalining admini emassiz.`,
        '',
        'Faqat kanal egasi yoki admini uni ulashi mumkin.'
      )
    );
  }

  // --- Allaqachon ulanganmi? ---
  const existing = await Channel.findOne({ ownerId: ctx.from.id, chatId });
  if (existing) {
    await clearState(ctx);
    return ctx.reply(
      lines(
        `ℹ️ <b>${escapeHtml(title)}</b> allaqachon ulangan.`,
        '',
        `Mavzu: ${escapeHtml(existing.topic)}`
      ),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Mavzuni o‘zgartirish', `topic:edit:${existing._id}`)],
          [Markup.button.callback('⬅️ Menyu', 'menu:main')],
        ]),
      }
    );
  }

  // --- Saqlash: mavzu keyingi qadamda so'raladi ---
  const channel = await Channel.create({
    ownerId: ctx.from.id,
    chatId,
    title,
    username: chat.username ? `@${chat.username}` : null,
    topic: '(belgilanmagan)',
    active: false, // mavzu kiritilgach yoqiladi
  });

  await setState(ctx, { name: 'awaiting_topic', channelId: String(channel._id) });

  await ctx.reply(
    lines(
      `✅ <b>${escapeHtml(title)}</b> ulandi!`,
      '',
      'Endi kanal <b>mavzusini</b> yozing — men shunga qarab post yozaman.',
      '',
      '<b>Namunalar:</b>',
      '• <i>Trading, investitsiya, bozor tahlili</i>',
      '• <i>IT yangiliklari va dasturlash maslahatlari</i>',
      '• <i>Sog‘lom turmush tarzi, sport, ovqatlanish</i>',
      '',
      'Qanchalik aniq yozsangiz, postlar shuncha mos chiqadi.'
    ),
    { parse_mode: 'HTML' }
  );
}

/** Xato xabari. Holat o'zgarmaydi — foydalanuvchi qaytadan urinib ko'radi. */
async function fail(ctx, text) {
  await ctx.reply(text, { parse_mode: 'HTML', ...backToMenu });
}

// ------------------------------------------------- 3. Mavzuni qabul qilish

export async function handleTopic(ctx, text) {
  const { channelId } = ctx.user.state ?? {};
  const topic = text.trim();

  if (topic.length < 3) {
    return ctx.reply('Mavzu juda qisqa. Kamida 3 belgi yozing.');
  }
  if (topic.length > 300) {
    return ctx.reply('Mavzu juda uzun. 300 belgidan kam yozing.');
  }

  const channel = await Channel.findOneAndUpdate(
    { _id: channelId, ownerId: ctx.from.id }, // ownerId — xavfsizlik
    { $set: { topic, active: true } },
    { new: true }
  );

  if (!channel) {
    await clearState(ctx);
    return ctx.reply('Kanal topilmadi. /start dan qaytadan boshlang.');
  }

  await clearState(ctx);

  await ctx.reply(
    lines(
      '✅ Hammasi tayyor!',
      '',
      `📢 <b>${escapeHtml(channel.title)}</b>`,
      `📝 Mavzu: ${escapeHtml(topic)}`,
      '',
      'Endi nima qilamiz?'
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✍️ Hoziroq post yozish', 'menu:write')],
        [Markup.button.callback('⏰ Reja tuzish', 'menu:schedule')],
        [Markup.button.callback('⬅️ Menyu', 'menu:main')],
      ]),
    }
  );
}

// ------------------------------------------------- Mavzuni tahrirlash

export async function startTopicEdit(ctx, channelId) {
  const channel = await Channel.findOne({ _id: channelId, ownerId: ctx.from.id });
  if (!channel) return ctx.answerCbQuery('Kanal topilmadi', { show_alert: true });

  await setState(ctx, { name: 'awaiting_topic', channelId: String(channel._id) });
  await ctx.answerCbQuery();
  await ctx.reply(
    lines(
      `✏️ <b>${escapeHtml(channel.title)}</b> uchun yangi mavzu yozing.`,
      '',
      `Hozirgi: <i>${escapeHtml(channel.topic)}</i>`
    ),
    { parse_mode: 'HTML' }
  );
}
