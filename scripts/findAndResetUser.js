require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
  const [,, emailArg, newPassArg] = process.argv;
  if (!emailArg || !newPassArg) {
    console.log('Usage: node scripts/findAndResetUser.js "<email>" "<newPassword>"');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing in .env');
    process.exit(1);
  }

  // 1) Connect (default DB is fine; we’ll enumerate all DBs)
  await mongoose.connect(uri);
  const conn = mongoose.connection;
  console.log('Connected to MongoDB cluster');

  // 2) List all databases in the cluster
  const client = conn.getClient();
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();

  const email = String(emailArg).toLowerCase().trim();
  const newHash = await bcrypt.hash(String(newPassArg), 12);

  const candidateCollections = ['users', 'user']; // safety: try both
  let updated = false;

  for (const dbInfo of databases) {
    const dbName = dbInfo.name;
    // Skip internal DBs
    if (['admin', 'local', 'config'].includes(dbName)) continue;

    const db = client.db(dbName);
    for (const collName of candidateCollections) {
      try {
        const coll = db.collection(collName);
        const user = await coll.findOne({ email });
        if (user) {
          console.log(`✅ Found user in db="${dbName}", collection="${collName}", _id=${user._id}`);
          const res = await coll.updateOne({ _id: user._id }, { $set: { password: newHash }});
          if (res.modifiedCount === 1) {
            console.log(`✅ Password updated for ${email} in db="${dbName}"`);
            updated = true;
            break;
          } else {
            console.log(`⚠️ Update attempted but modifiedCount=${res.modifiedCount} in db="${dbName}"`);
          }
        }
      } catch (e) {
        // Collection may not exist; ignore and continue
      }
    }
    if (updated) break;
  }

  if (!updated) {
    console.error('❌ No user found in any database with email:', email);
  }

  await mongoose.disconnect();
  process.exit(updated ? 0 : 1);
}

main().catch(async (e) => {
  console.error('Script error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
