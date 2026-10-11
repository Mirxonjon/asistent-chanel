/**
 * Eski maydonlarni bazadan tozalash.
 * planState va paused endi ishlatilmaydi — holat Challenge yozuvida.
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { Channel } from '../src/models/Channel.js';

await connectDb();

const res = await Channel.updateMany(
  { $or: [{ planState: { $exists: true } }, { paused: { $exists: true } }] },
  { $unset: { planState: '', paused: '' } }
);

console.log(`🔧 ${res.modifiedCount} ta kanaldan eski maydonlar olib tashlandi`);
await disconnectDb();
