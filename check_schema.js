require('dotenv').config();
const db = require('./src/db/database');

async function checkSchema() {
  try {
    const ai_profiles = await db.queryMany(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'ai_profiles'
    `);
    console.log('--- AI_PROFILES ---');
    console.log(ai_profiles);
    
    const messages = await db.queryMany(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'messages'
    `);
    console.log('--- MESSAGES ---');
    console.log(messages);

    const conversations = await db.queryMany(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'conversations'
    `);
    console.log('--- CONVERSATIONS ---');
    console.log(conversations);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
