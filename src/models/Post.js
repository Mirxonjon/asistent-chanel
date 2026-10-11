import mongoose from 'mongoose';

/**
 * Yozilgan post. Ikki vazifasi bor:
 *  1) tarix / statistika
 *  2) AI ga "oxirgi 10 post mavzusi" ni berish - mavzular takrorlanmasligi uchun
 */
const postSchema = new mongoose.Schema(
  {
    ownerId: { type: Number, required: true },
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },

    /** Qaysi challenge'ga tegishli (bo'lmasa — alohida yozilgan post) */
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Challenge',
      default: null,
    },

    topic: String,
    text: String, // Telegram HTML formatida

    status: {
      type: String,
      // planned = rejada turibdi, matni hali yozilmagan
      enum: ['planned', 'draft', 'published', 'rejected'],
      default: 'draft',
    },
    source: {
      type: String,
      enum: ['manual', 'auto'], // manual = user mavzu berdi, auto = reja bo'yicha
      default: 'manual',
    },

    /** Rejadagi post qachon chiqishi kerak (status='planned' uchun) */
    scheduledFor: Date,

    /** Rejadagi tartib raqami — foydalanuvchi "5-mavzuni almashtir" desa */
    planIndex: Number,

    messageId: Number, // kanalga joylangandan keyingi Telegram message_id
    publishedAt: Date,
  },
  { timestamps: true }
);

// "Oxirgi postlar" - mavzu takrorlanmasligi uchun va /postlar komandasi uchun
postSchema.index({ channelId: 1, createdAt: -1 });
postSchema.index({ ownerId: 1, createdAt: -1 });

// Scheduler: kanalning keyingi rejadagi postini topish
postSchema.index({ channelId: 1, status: 1, scheduledFor: 1 });

// Challenge ichidagi postlar
postSchema.index({ challengeId: 1, scheduledFor: 1 });

export const Post = mongoose.model('Post', postSchema);
