import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/User.js';
import { Channel } from '../src/models/Channel.js';
import { Post } from '../src/models/Post.js';

await connectDb();
console.log('\n=== Userlar ===');
for (const u of await User.find().lean()) {
  console.log(`  ${u.telegramId}  ${u.firstName ?? ''} @${u.username ?? '-'}  state=${JSON.stringify(u.state)}`);
}
console.log('\n=== Kanallar ===');
for (const c of await Channel.find().lean()) {
  console.log(`  ${c._id}  "${c.title}"  chatId=${c.chatId}  owner=${c.ownerId}`);
  console.log(`     topic="${c.topic}"  tone=${c.tone}  lang=${c.language}  active=${c.active}`);
}
console.log('\n=== Postlar ===');
const posts = await Post.find().sort({ createdAt: -1 }).limit(5).lean();
if (!posts.length) console.log("  (yo'q)");
for (const p of posts) {
  console.log(`  ${p._id}  ${p.status}  "${p.topic}"  ${p.text?.length ?? 0} belgi`);
}
await disconnectDb();
