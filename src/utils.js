/** Telegram HTML uchun xavfli belgilarni tozalash */
export function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * editMessageText matn o'zgarmasa "message is not modified" xatosini beradi.
 * Shuni jim o'tkazib yuboramiz.
 */
export async function safeEdit(ctx, text, extra = {}) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...extra });
  } catch (err) {
    if (!String(err.message).includes('not modified')) throw err;
  }
}

/** Satrlarni bitta matnga qo'shish (null/undefined tashlab ketiladi) */
export function lines(...parts) {
  return parts
    .flat()
    .filter((p) => p !== null && p !== undefined)
    .join('\n');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
