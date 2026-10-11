/**
 * 1-bosqich tekshiruvi: .env to'g'rimi, MongoDB ulanadimi, indekslar yaratiladimi.
 * Ishlatish:  node scripts/check.js
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';

console.log('\n⚙️  Sozlamalar:');
console.log(`   Model:      ${config.openaiModel}`);
console.log(`   Vaqt zonasi: ${config.defaultTimezone}`);
console.log(`   Bot egasi:   ${config.ownerId ?? '(belgilanmagan - muammo emas)'}`);

await connectDb();

// Indekslarni bazada haqiqatda yaratadi
for (const model of [User, Channel, Post]) {
  await model.createIndexes();
  const idx = await model.collection.indexes();
  console.log(`\n📁 ${model.modelName}`);
  for (const i of idx) {
    const fields = Object.entries(i.key).map(([k, v]) => `${k}:${v}`).join(', ');
    console.log(`   ${i.name.padEnd(28)} { ${fields} }${i.unique ? '  [unique]' : ''}`);
  }
}

// Hozirgi holat
console.log('\n📊 Bazadagi yozuvlar:');
console.log(`   Userlar:  ${await User.countDocuments()}`);
console.log(`   Kanallar: ${await Channel.countDocuments()}`);
console.log(`   Postlar:  ${await Post.countDocuments()}`);

await disconnectDb();
console.log('\n✅ 1-bosqich joyida.\n');
