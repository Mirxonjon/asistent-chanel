/**
 * Oddiy konsol logger. Tashqi paket kerak emas.
 *
 * LOG_LEVEL=debug  → hammasi (har bir tugma bosilishi ham)
 * LOG_LEVEL=info   → odatiy (default)
 * LOG_LEVEL=warn   → faqat ogohlantirish va xatolar
 * LOG_LEVEL=error  → faqat xatolar
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

const COLOR = {
  debug: '\x1b[90m', // kulrang
  info: '\x1b[36m', // moviy
  warn: '\x1b[33m', // sariq
  error: '\x1b[31m', // qizil
  reset: '\x1b[0m',
};

function stamp() {
  // 14:05:09
  return new Date().toTimeString().slice(0, 8);
}

function write(level, label, args) {
  if (LEVELS[level] < current) return;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(`${COLOR[level]}${stamp()} ${label}${COLOR.reset}`, ...args);
}

export const log = {
  debug: (...a) => write('debug', '·', a),
  info: (...a) => write('info', 'ℹ', a),
  warn: (...a) => write('warn', '⚠', a),

  /** Xatoni to'liq chiqaradi — stack, OpenAI/Telegram tafsilotlari bilan */
  error(context, err) {
    if (LEVELS.error < current) return;

    console.error(`${COLOR.error}${stamp()} ❌ ${context}${COLOR.reset}`);

    if (!err) return;

    console.error(`   nomi:    ${err.name ?? '-'}`);
    console.error(`   xabar:   ${err.message ?? err}`);

    // OpenAI SDK
    if (err.status) console.error(`   status:  ${err.status}`);
    if (err.code) console.error(`   kod:     ${err.code}`);
    if (err.type) console.error(`   turi:    ${err.type}`);

    // Telegram API
    const tg = err.response ?? err.on;
    if (tg) {
      console.error(`   telegram: ${JSON.stringify(tg).slice(0, 500)}`);
    }

    if (err.stack) {
      const frames = err.stack
        .split('\n')
        .slice(1, 8)
        .map((l) => `   ${l.trim()}`)
        .join('\n');
      console.error(frames);
    }

    if (err.cause) {
      console.error(`   sabab:   ${err.cause.message ?? err.cause}`);
    }
  },
};

/** Telegraf middleware — har bir so'rovni va qancha vaqt ketganini yozadi */
export async function requestLogger(ctx, next) {
  const started = Date.now();

  const who = ctx.from
    ? `${ctx.from.first_name ?? ''}${ctx.from.username ? ` @${ctx.from.username}` : ''} (${ctx.from.id})`
    : '?';

  let what = ctx.updateType;
  if (ctx.callbackQuery?.data) what = `tugma: ${ctx.callbackQuery.data}`;
  else if (ctx.message?.text) what = `matn: ${ctx.message.text.slice(0, 50)}`;
  else if (ctx.message?.forward_origin || ctx.message?.forward_from_chat) what = 'forward';

  log.info(`→ ${who}  ${what}`);

  try {
    await next();
    log.debug(`← tugadi  ${Date.now() - started}ms`);
  } catch (err) {
    log.error(`${who} — ${what}`, err);
    throw err; // bot.catch ham ko'rsin
  }
}
