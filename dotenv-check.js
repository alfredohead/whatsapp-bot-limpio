
require('dotenv').config();

if (!process.env.TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN no está definido en process.env");
  process.exit(1);
} else {
  console.log("✅ TELEGRAM_TOKEN encontrado:");
  console.log("Token:", process.env.TELEGRAM_TOKEN);
}
