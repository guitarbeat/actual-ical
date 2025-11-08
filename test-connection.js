const { execSync } = require('child_process');

console.log('🔍 Testing Actual Budget Connection...\n');

const server = process.env.ACTUAL_SERVER;
const password = process.env.ACTUAL_MAIN_PASSWORD;
const syncId = process.env.ACTUAL_SYNC_ID;

console.log('Server:', server);
console.log('Has Password:', !!password);
console.log('Has Sync ID:', !!syncId);
console.log('');

if (!server || !password || !syncId) {
  console.error('❌ Missing required environment variables');
  console.log('Make sure you set: ACTUAL_SERVER, ACTUAL_MAIN_PASSWORD, ACTUAL_SYNC_ID');
  process.exit(1);
}

try {
  console.log('🌐 Testing server connectivity...');
  const result = execSync(`curl -s -o /dev/null -w "%{http_code}" "${server}"`, { timeout: 10000 });
  const status = result.toString().trim();
  console.log('Server Response:', status);

  if (status === '200' || status === '302' || status === '301' || status === '308') {
    console.log('✅ Server is reachable');
  } else {
    console.log('⚠️  Server responded with unexpected status:', status);
  }
} catch (error) {
  console.error('❌ Cannot reach server:', error.message);
  console.log('\n💡 Possible issues:');
  console.log('   - Wrong URL (try https:// vs http://)');
  console.log('   - Server is down');
  console.log('   - Firewall blocking connection');
  console.log('   - DNS resolution issues');
  process.exit(1);
}

console.log('\n🔧 Next: Run the app to test full Actual API connection');
console.log('   npm start (or however you run it)');
console.log('   Check the logs for detailed connection results');
