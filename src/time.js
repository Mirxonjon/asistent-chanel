/**
 * Vaqt zonasi hisoblari.
 *
 * Muammo: foydalanuvchi "09:00" deydi, lekin bu qaysi zonadagi 09:00?
 * Server Amerikada bo'lsa, Toshkentdagi 09:00 butunlay boshqa vaqt.
 *
 * Yechim: kanalning timezone'i bo'yicha "09:00" ni aniq UTC momentiga
 * aylantiramiz va bazada nextRunAt sifatida saqlaymiz. Keyin scheduler
 * oddiygina `nextRunAt <= hozir` deb tekshiradi — hech qanday zona hisobi yo'q.
 *
 * Tashqi kutubxona ishlatilmaydi — Intl.DateTimeFormat yetarli.
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "09:00" to'g'ri formatdami? */
export function isValidTime(value) {
  return TIME_RE.test(String(value).trim());
}

/** "9:5" → "09:05".  Noto'g'ri bo'lsa null. */
export function normalizeTime(value) {
  const m = String(value).trim().match(/^(\d{1,2})[:.\s]?(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Zona nomi haqiqiymi? ("Asia/Tashkent" ✓, "Mars/Olympus" ✗) */
export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Berilgan moment uchun zonaning UTC'dan siljishi (daqiqada).
 * Toshkent uchun +300 (UTC+5).
 */
export function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // Intl ba'zan 24 qaytaradi (yarim tunda)
    Number(parts.minute),
    Number(parts.second)
  );

  return Math.round((asIfUtc - date.getTime()) / 60000);
}

/** Berilgan moment zonada qaysi kun/soat? */
export function zonedParts(date, timeZone) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, x) => {
      if (x.type !== 'literal') acc[x.type] = x.value;
      return acc;
    }, {});

  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/**
 * Zonadagi "yil-oy-kun soat:daqiqa" ni UTC Date ga aylantiradi.
 * Ikki marta hisoblaymiz — DST o'tish kunlarida siljish o'zgarib ketadi.
 */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let ts = wallClock;

  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMinutes(new Date(ts), timeZone);
    ts = wallClock - offset * 60000;
  }

  return new Date(ts);
}

/**
 * Keyingi post vaqtini topadi.
 *
 * @param {string[]} times    - ["09:00", "14:00", "20:00"]
 * @param {string} timeZone   - "Asia/Tashkent"
 * @param {Date} [from]       - shu momentdan keyingi eng yaqin vaqt
 * @returns {Date|null}
 */
export function computeNextRunAt(times, timeZone, from = new Date()) {
  const valid = (times ?? []).map(normalizeTime).filter(Boolean).sort();
  if (valid.length === 0) return null;

  const tz = isValidTimezone(timeZone) ? timeZone : 'UTC';
  const base = zonedParts(from, tz);

  // Bugun + 2 kun ichida albatta topiladi
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    // Date.UTC oy/yil oshishini o'zi hisoblaydi (31 + 1 → keyingi oy)
    const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset));

    for (const t of valid) {
      const [hh, mm] = t.split(':').map(Number);
      const candidate = zonedTimeToUtc(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + 1,
        shifted.getUTCDate(),
        hh,
        mm,
        tz
      );
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }

  return null;
}

/**
 * Ketma-ket N ta post vaqtini qaytaradi.
 *
 * computeNextRunAt faqat bittasini beradi; reja uchun 30 tasi kerak,
 * shuning uchun har safar oldingisidan keyin davom etamiz.
 *
 * @returns {Date[]} uzunligi count (yoki undan kam, agar vaqt topilmasa)
 */
export function computeSchedule(times, timeZone, count, from = new Date()) {
  const out = [];
  let cursor = from;

  for (let i = 0; i < count; i++) {
    const next = computeNextRunAt(times, timeZone, cursor);
    if (!next) break;
    out.push(next);
    cursor = new Date(next.getTime() + 1000); // keyingisini qidiramiz
  }

  return out;
}

/**
 * Kuniga N ta postni ish vaqtiga teng taqsimlaydi.
 * 1 → ["12:00"],  2 → ["09:00","19:00"],  3 → ["09:00","14:00","19:00"]
 */
export function distributeTimes(count, startHour = 9, endHour = 21) {
  const n = Math.max(1, Math.min(24, Number(count) || 1));
  if (n === 1) return ['12:00'];

  const span = endHour - startHour; // soatda
  const step = span / (n - 1);

  const out = [];
  for (let i = 0; i < n; i++) {
    const totalMinutes = Math.round((startHour + step * i) * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = Math.round(totalMinutes % 60);
    // 5 daqiqaga yaxlitlaymiz — chiroyliroq ko'rinadi
    const rounded = Math.round(mm / 5) * 5;
    const carry = rounded === 60 ? 1 : 0;
    out.push(
      `${String((hh + carry) % 24).padStart(2, '0')}:${String(carry ? 0 : rounded).padStart(2, '0')}`
    );
  }

  return [...new Set(out)].sort();
}

const MONTHS_UZ = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

/**
 * Sanani zonada o'zbekcha ko'rsatish: "15-iyun, 09:00"
 * Intl locale'ga tayanmaydi — har qanday tizimda bir xil chiqadi.
 */
export function formatInZone(date, timeZone) {
  if (!date) return '—';
  const p = zonedParts(date, isValidTimezone(timeZone) ? timeZone : 'UTC');
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${p.day}-${MONTHS_UZ[p.month - 1]}, ${hh}:${mm}`;
}

/** Zonadagi hozirgi vaqtni "09:00" ko'rinishida */
export function nowInZone(timeZone) {
  const p = zonedParts(new Date(), isValidTimezone(timeZone) ? timeZone : 'UTC');
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
