import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTime,
  normalizeTime,
  isValidTimezone,
  tzOffsetMinutes,
  zonedTimeToUtc,
  computeNextRunAt,
  distributeTimes,
} from '../src/time.js';

// ---------------------------------------------------------- format

test('isValidTime', () => {
  assert.ok(isValidTime('09:00'));
  assert.ok(isValidTime('23:59'));
  assert.ok(isValidTime('00:00'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('9:00'));
  assert.ok(!isValidTime('09:60'));
  assert.ok(!isValidTime('salom'));
});

test('normalizeTime turli yozilishlarni tuzatadi', () => {
  assert.equal(normalizeTime('9:05'), '09:05');
  assert.equal(normalizeTime('09:05'), '09:05');
  assert.equal(normalizeTime('9.05'), '09:05');
  assert.equal(normalizeTime('0900'), '09:00');
  assert.equal(normalizeTime('25:00'), null);
  assert.equal(normalizeTime('09:99'), null);
});

test('isValidTimezone', () => {
  assert.ok(isValidTimezone('Asia/Tashkent'));
  assert.ok(isValidTimezone('UTC'));
  assert.ok(!isValidTimezone('Mars/Olympus'));
});

// ---------------------------------------------------------- siljish

test('Toshkent UTC+5 (DST yo‘q)', () => {
  const yanvar = new Date('2026-01-15T00:00:00Z');
  const iyul = new Date('2026-07-15T00:00:00Z');
  assert.equal(tzOffsetMinutes(yanvar, 'Asia/Tashkent'), 300);
  assert.equal(tzOffsetMinutes(iyul, 'Asia/Tashkent'), 300);
});

test('UTC siljishi nol', () => {
  assert.equal(tzOffsetMinutes(new Date('2026-06-01T12:00:00Z'), 'UTC'), 0);
});

test('DST bor zonada siljish o‘zgaradi (New York)', () => {
  const qish = tzOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York');
  const yoz = tzOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York');
  assert.equal(qish, -300); // EST
  assert.equal(yoz, -240); // EDT
});

// ---------------------------------------------------------- aylantirish

test('Toshkentdagi 09:00 → UTC 04:00', () => {
  const utc = zonedTimeToUtc(2026, 6, 15, 9, 0, 'Asia/Tashkent');
  assert.equal(utc.toISOString(), '2026-06-15T04:00:00.000Z');
});

test('Toshkentdagi 00:30 → oldingi kun UTC 19:30', () => {
  const utc = zonedTimeToUtc(2026, 6, 15, 0, 30, 'Asia/Tashkent');
  assert.equal(utc.toISOString(), '2026-06-14T19:30:00.000Z');
});

// ---------------------------------------------------------- keyingi vaqt

test('computeNextRunAt — kun ichidagi keyingi vaqtni tanlaydi', () => {
  // Toshkentda 10:00 (UTC 05:00)
  const from = new Date('2026-06-15T05:00:00Z');
  const next = computeNextRunAt(['09:00', '14:00', '20:00'], 'Asia/Tashkent', from);
  // 14:00 Toshkent = 09:00 UTC
  assert.equal(next.toISOString(), '2026-06-15T09:00:00.000Z');
});

test('computeNextRunAt — kun tugasa ertangi birinchi vaqt', () => {
  // Toshkentda 21:00 (UTC 16:00), oxirgi vaqt 20:00 o'tgan
  const from = new Date('2026-06-15T16:00:00Z');
  const next = computeNextRunAt(['09:00', '20:00'], 'Asia/Tashkent', from);
  // Ertaga 09:00 Toshkent = 04:00 UTC
  assert.equal(next.toISOString(), '2026-06-16T04:00:00.000Z');
});

test('computeNextRunAt — oy oxirida keyingi oyga o‘tadi', () => {
  // 30-iyun 21:00 Toshkent (UTC 16:00)
  const from = new Date('2026-06-30T16:00:00Z');
  const next = computeNextRunAt(['09:00'], 'Asia/Tashkent', from);
  assert.equal(next.toISOString(), '2026-07-01T04:00:00.000Z');
});

test('computeNextRunAt — yil oxirida keyingi yilga o‘tadi', () => {
  const from = new Date('2026-12-31T19:30:00Z'); // Toshkentda 1-yanvar 00:30
  const next = computeNextRunAt(['09:00'], 'Asia/Tashkent', from);
  assert.equal(next.toISOString(), '2027-01-01T04:00:00.000Z');
});

test('computeNextRunAt — hozirgi daqiqaning o‘zini tanlamaydi', () => {
  const from = new Date('2026-06-15T04:00:00Z'); // aynan 09:00 Toshkent
  const next = computeNextRunAt(['09:00'], 'Asia/Tashkent', from);
  assert.ok(next.getTime() > from.getTime(), 'keyingi kunga o‘tishi kerak');
  assert.equal(next.toISOString(), '2026-06-16T04:00:00.000Z');
});

test('computeNextRunAt — vaqt yo‘q bo‘lsa null', () => {
  assert.equal(computeNextRunAt([], 'Asia/Tashkent'), null);
  assert.equal(computeNextRunAt(null, 'Asia/Tashkent'), null);
});

test('computeNextRunAt — tartibsiz berilgan vaqtlarni saralaydi', () => {
  const from = new Date('2026-06-15T02:00:00Z'); // Toshkentda 07:00
  const next = computeNextRunAt(['20:00', '09:00', '14:00'], 'Asia/Tashkent', from);
  assert.equal(next.toISOString(), '2026-06-15T04:00:00.000Z'); // 09:00
});

test('computeNextRunAt — noto‘g‘ri zona UTC ga tushadi, xato bermaydi', () => {
  // UTC ga tushganda 09:00 hali kelmagan (hozir 05:00 UTC) — bugungi kun
  const from = new Date('2026-06-15T05:00:00Z');
  const next = computeNextRunAt(['09:00'], 'Mars/Olympus', from);
  assert.equal(next.toISOString(), '2026-06-15T09:00:00.000Z');

  // 09:00 UTC o'tgan bo'lsa — ertaga
  const after = new Date('2026-06-15T10:00:00Z');
  assert.equal(
    computeNextRunAt(['09:00'], 'Mars/Olympus', after).toISOString(),
    '2026-06-16T09:00:00.000Z'
  );
});

// ---------------------------------------------------------- taqsimlash

test('distributeTimes', () => {
  assert.deepEqual(distributeTimes(1), ['12:00']);

  const two = distributeTimes(2);
  assert.equal(two.length, 2);
  assert.equal(two[0], '09:00');
  assert.equal(two[1], '21:00');

  const three = distributeTimes(3);
  assert.equal(three.length, 3);
  assert.equal(three[0], '09:00');
  assert.equal(three[2], '21:00');

  // Hammasi to'g'ri formatda va takrorlanmaydi
  for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    const times = distributeTimes(n);
    assert.equal(new Set(times).size, times.length, `${n}: takror bor`);
    for (const t of times) {
      assert.ok(isValidTime(t), `${n}: noto‘g‘ri format ${t}`);
    }
  }
});

test('distributeTimes chegaralarni hurmat qiladi', () => {
  assert.deepEqual(distributeTimes(0), ['12:00']); // 0 → 1 ga
  assert.ok(distributeTimes(100).length <= 24);
});
