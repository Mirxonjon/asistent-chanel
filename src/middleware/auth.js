import { User } from '../models/User.js';

/**
 * Har bir xabarda ishlaydi: foydalanuvchini bazadan topadi yoki yaratadi
 * va ctx.user ga qo'yadi.
 *
 * Shu sabab hech qayerda ADMIN_ID qattiq yozilmaydi - har bir komanda
 * ctx.user bilan ishlaydi, ya'ni botni istalgan odam ishlatadi.
 */
export async function auth(ctx, next) {
  const from = ctx.from;

  // Kanal postlari va boshqa botlar - e'tiborsiz qoldiramiz
  if (!from || from.is_bot) return;

  ctx.user = await User.findOneAndUpdate(
    { telegramId: from.id },
    {
      $set: {
        firstName: from.first_name ?? null,
        username: from.username ?? null,
      },
      $setOnInsert: { telegramId: from.id, state: null },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return next();
}

/** Suhbat holatini saqlash. Masalan: setState(ctx, { name: 'awaiting_topic' }) */
export async function setState(ctx, state) {
  ctx.user.state = state;
  await User.updateOne({ _id: ctx.user._id }, { $set: { state } });
}

/** Holatni tozalash - suhbat tugadi */
export async function clearState(ctx) {
  ctx.user.state = null;
  await User.updateOne({ _id: ctx.user._id }, { $set: { state: null } });
}
