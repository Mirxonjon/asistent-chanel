import { stripHtml } from './ai.js';
import { Post } from './models/Post.js';
import { log } from './logger.js';

/** Telegram HTML ni rad etganini bildiruvchi xatolar */
const HTML_ERROR =
  /can't parse entities|unsupported start tag|unclosed|can't find end tag|entity/i;

/**
 * Matnni kanalga yuboradi.
 *
 * AI qancha tozalansa ham, ba'zan Telegram HTML ni rad etishi mumkin.
 * Bunda post yo'qolmasligi uchun teglarsiz qayta yuboramiz — foydalanuvchi
 * uchun chiroyliroq emas, lekin post joylanadi.
 */
export async function sendToChannel(telegram, chatId, text, extra = {}) {
  try {
    return await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  } catch (err) {
    if (!HTML_ERROR.test(err.message)) throw err;

    log.warn('Telegram HTML ni rad etdi, teglarsiz yuborilmoqda:', err.message);
    return telegram.sendMessage(chatId, stripHtml(text), {
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }
}

/**
 * Draft postni kanalga joylaydi va bazada belgilaydi.
 * Bot (preview tugmasi) va scheduler (avto post) ikkisi ham shuni ishlatadi.
 *
 * @returns {Promise<{ messageId: number, url: string|null }>}
 */
export async function publishPost(telegram, channel, post) {
  const sent = await sendToChannel(telegram, channel.chatId, post.text);

  await Post.updateOne(
    { _id: post._id },
    {
      $set: {
        status: 'published',
        messageId: sent.message_id,
        publishedAt: new Date(),
      },
    }
  );

  return { messageId: sent.message_id, url: postUrl(channel, sent.message_id) };
}

/** Ochiq kanal bo'lsa postga havola tuzadi */
export function postUrl(channel, messageId) {
  if (channel.username) {
    return `https://t.me/${channel.username.replace('@', '')}/${messageId}`;
  }
  // Yopiq kanal: -1001234567890 → c/1234567890
  const m = String(channel.chatId).match(/^-100(\d+)$/);
  return m ? `https://t.me/c/${m[1]}/${messageId}` : null;
}
