import mongoose from 'mongoose';

/**
 * Har bir Telegram foydalanuvchisi. Hech qanday limit yo'q -
 * bu yozuv faqat kimligini va suhbat holatini eslab qolish uchun.
 */
const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    firstName: String,
    username: String,

    /**
     * Suhbat holati. Bot "keyingi xabar nima kutilayotganini" shu yerda eslab turadi.
     * Masalan: { name: 'awaiting_topic', channelId: '...' }
     * null = hech narsa kutilmayapti.
     * Bazada saqlanadi, shuning uchun bot qayta yoqilsa ham holat yo'qolmaydi.
     */
    state: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
