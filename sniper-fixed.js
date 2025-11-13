/**
 * MemeJob NCP Token Sniper Bot - Fixed Version v2.2
 * Sửa lỗi CONTRACT_REVERT_EXECUTED - Dùng đúng buyJob ABI
 */

import { AccountId, ContractId, PrivateKey, Hbar, ContractExecuteTransaction, ContractFunctionParameters } from "@hashgraph/sdk";
import {
  CONTRACT_DEPLOYMENTS,
  createAdapter,
  getChain,
  MJClient,
  NativeAdapter,
} from "@buidlerlabs/memejob-sdk-js";
import axios from "axios";

// ==================== CẤU HÌNH ====================
const CONFIG = {
  // Thông tin tài khoản Hedera của bạn
  ACCOUNT_ID: "0.0.10018914",
  PRIVATE_KEY: "302e020100300506032b657004220420c9fbe04bf496cb18189ccd17ce665e6eab484529eca02dd30d8de89ce978db5d",

  // Cài đặt
  NETWORK: "mainnet",
  CHECK_INTERVAL: 3000,  // Check mỗi 3 giây
  BUY_AMOUNT_HBAR: 1,    // Chi 1 HBAR để mua token

  // Token target
  TARGET_TOKEN_NAME: "Labubu",

  // Safety - QUAN TRỌNG
  DRY_RUN: false,         // true = test, false = mua thật
  MIN_TOKENS_OUT: 0,      // Số token tối thiểu muốn nhận (0 = accept any, dùng cho high slippage)
  MIN_MARKET_CAP: 0,      // Chỉ mua token có MC > $X
  MAX_RETRIES: 3,         // Số lần retry khi thất bại

  // Referrer (để nhận commission nếu có)
  REFERRER_ADDRESS: "0x0000000000000000000000000000000000000000", // Zero address = no referrer
};

// ==================== MEMEJOB API CLIENT ====================
class MemeJobAPI {
  constructor() {
    this.baseUrl = "https://memejob.fun";
    this.seenTokens = new Set();
  }

  async fetchLatestTokens() {
    try {
      const response = await axios.post(
        this.baseUrl,
        JSON.stringify(["creation-time", 1, 50, ""]),
        {
          headers: {
            accept: "text/x-component",
            "content-type": "text/plain;charset=UTF-8",
            "next-action": "78dca6436335c79d603d8ad5925fb9e694715a2e72",
            origin: "https://memejob.fun",
            referer: "https://memejob.fun/?sortType=creation-time",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          params: {
            sortType: "creation-time",
          },
        }
      );

      const tokens = this.parseTokens(response.data);
      return tokens;
    } catch (error) {
      console.error("❌ Lỗi khi fetch tokens:", error.message);
      return [];
    }
  }

  parseTokens(data) {
    try {
      const dataStr = data.toString();
      const tokens = [];

      const tokenIdMatches = dataStr.matchAll(/0\.0\.(\d+)/g);
      const tokenIds = [...new Set([...tokenIdMatches].map(m => m[0]))];

      console.log(`\n🔍 Tìm thấy ${tokenIds.length} token IDs trong response`);

      for (const tokenId of tokenIds.slice(0, 10)) {
        const tokenInfo = this.extractTokenInfo(dataStr, tokenId);
        if (tokenInfo && tokenInfo.name) {
          tokens.push(tokenInfo);
        }
      }

      return tokens;
    } catch (error) {
      console.error("❌ Lỗi parse tokens:", error.message);
      return [];
    }
  }

  extractTokenInfo(data, tokenId) {
    const index = data.indexOf(tokenId);
    if (index === -1) return null;

    const start = Math.max(0, index - 500);
    const end = Math.min(data.length, index + 1500);
    const section = data.substring(start, end);

    const nameMatch = section.match(/"name"\s*:\s*"([^"]+)"/i) ||
                     section.match(/name["\s:]+([A-Za-z0-9\s]+?)["',]/i);
    const symbolMatch = section.match(/"symbol"\s*:\s*"([^"]+)"/i) ||
                       section.match(/symbol["\s:]+([A-Za-z0-9]+?)["',]/i);
    const creatorMatch = section.match(/"creator"\s*:\s*"(0\.0\.\d+)"/i);
    const marketCapMatch = section.match(/"marketCap"\s*:\s*"?([0-9.]+)"?/i);

    const token = {
      tokenId: tokenId,
      name: nameMatch ? nameMatch[1].trim() : null,
      symbol: symbolMatch ? symbolMatch[1].trim() : null,
      creator: creatorMatch ? creatorMatch[1] : null,
      marketCap: marketCapMatch ? parseFloat(marketCapMatch[1]) : 0,
      timestamp: Date.now(),
    };

    return token;
  }

  isNewToken(tokenId) {
    if (this.seenTokens.has(tokenId)) {
      return false;
    }
    this.seenTokens.add(tokenId);
    return true;
  }
}

// ==================== SNIPER BOT ====================
class NCPSniperBot {
  constructor(config) {
    this.config = config;
    this.api = new MemeJobAPI();
    this.client = null;
    this.hederaClient = null;
    this.contractId = null;
    this.isRunning = false;
    this.stats = {
      checked: 0,
      found: 0,
      purchased: 0,
      failed: 0,
    };
  }

  async initialize() {
    try {
      console.log("\n🚀 Khởi động NCP Sniper Bot v2.2 (Fixed - buyJob)...");
      console.log(`📍 Network: ${this.config.NETWORK}`);
      console.log(`💰 Sẽ chi: ${this.config.BUY_AMOUNT_HBAR} HBAR mỗi lần mua`);
      console.log(`🎯 Target Token: ${this.config.TARGET_TOKEN_NAME}`);
      console.log(`🧪 Mode: ${this.config.DRY_RUN ? "DRY RUN (Test)" : "LIVE (Thật)"}`);
      console.log("=====================================\n");

      this.contractId = ContractId.fromString(
        CONTRACT_DEPLOYMENTS[this.config.NETWORK].contractId
      );

      // Tạo Hedera client cho low-level operations
      const { Client } = await import("@hashgraph/sdk");
      this.hederaClient = this.config.NETWORK === "mainnet"
        ? Client.forMainnet()
        : Client.forTestnet();

      this.hederaClient.setOperator(
        AccountId.fromString(this.config.ACCOUNT_ID),
        PrivateKey.fromStringED25519(this.config.PRIVATE_KEY)
      );

      // Tạo MJ Client cho các operations khác
      this.client = new MJClient(
        createAdapter(NativeAdapter, {
          operator: {
            accountId: AccountId.fromString(this.config.ACCOUNT_ID),
            privateKey: PrivateKey.fromStringED25519(this.config.PRIVATE_KEY),
          },
        }),
        {
          chain: getChain(this.config.NETWORK),
          contractId: this.contractId,
        }
      );

      console.log("✅ Khởi động thành công!\n");
      console.log(`📋 Contract ID: ${this.contractId.toString()}\n`);
      return true;
    } catch (error) {
      console.error("❌ Lỗi khởi động:", error.message);
      return false;
    }
  }

  async checkForTargetToken() {
    try {
      const tokens = await this.api.fetchLatestTokens();

      if (tokens.length === 0) {
        console.log("⏳ Không tìm thấy token mới...");
        return;
      }

      console.log(`\n📊 Tìm thấy ${tokens.length} tokens:`);

      for (const token of tokens) {
        this.stats.checked++;

        if (!this.api.isNewToken(token.tokenId)) {
          continue;
        }

        console.log(`\n  🪙 Token: ${token.name || "Unknown"}`);
        console.log(`     Symbol: ${token.symbol || "?"}`);
        console.log(`     ID: ${token.tokenId}`);
        console.log(`     Market Cap: $${token.marketCap.toFixed(2)}`);

        if (this.isTargetToken(token)) {
          console.log(`\n  🎯 FOUND TARGET TOKEN: ${token.name}!`);
          this.stats.found++;

          // Check market cap filter
          if (token.marketCap < this.config.MIN_MARKET_CAP) {
            console.log(`  ⚠️  Market cap quá thấp ($${token.marketCap}), bỏ qua`);
            continue;
          }

          await this.buyToken(token);
        }
      }
    } catch (error) {
      console.error("❌ Lỗi trong check loop:", error.message);
    }
  }

  isTargetToken(token) {
    const targetName = this.config.TARGET_TOKEN_NAME.toUpperCase();
    const tokenName = (token.name || "").toUpperCase();
    const tokenSymbol = (token.symbol || "").toUpperCase();

    return tokenName.includes(targetName) || tokenSymbol.includes(targetName);
  }

  /**
   * Convert Hedera token ID (0.0.xxxxx) to EVM address
   */
  tokenIdToEvmAddress(tokenId) {
    // Parse token ID: 0.0.xxxxx
    const parts = tokenId.split('.');
    const num = parseInt(parts[2]);

    // Convert to hex and pad to 40 characters (20 bytes)
    const hex = num.toString(16).padStart(40, '0');
    return '0x' + hex;
  }

  async buyToken(token) {
    console.log(`\n💰 Chuẩn bị mua ${token.name}...`);
    console.log(`   Token ID: ${token.tokenId}`);
    console.log(`   Sẽ chi: ${this.config.BUY_AMOUNT_HBAR} HBAR`);

    if (this.config.DRY_RUN) {
      console.log("   🔸 DRY RUN - KHÔNG MUA THẬT");
      console.log("   ✅ Giao dịch giả lập thành công!\n");
      this.stats.purchased++;
      return;
    }

    // Retry logic
    for (let attempt = 1; attempt <= this.config.MAX_RETRIES; attempt++) {
      try {
        console.log(`\n   ⏳ Đang thực hiện giao dịch (Lần ${attempt}/${this.config.MAX_RETRIES})...`);

        // BƯỚC 1: Associate token trước
        console.log(`   🔗 Bước 1: Associate token...`);
        try {
          const tokenInstance = await this.client.getToken(token.tokenId);
          await tokenInstance.associate();
          console.log(`   ✅ Associate thành công!`);
          await this.sleep(1500); // Đợi transaction settle
        } catch (assocError) {
          if (assocError.message?.includes("TOKEN_ALREADY_ASSOCIATED")) {
            console.log(`   ℹ️  Token đã được associate trước đó`);
          } else {
            console.log(`   ⚠️  Lỗi associate (tiếp tục): ${assocError.message}`);
          }
        }

        // BƯỚC 2: Gọi buyJob với đúng ABI
        console.log(`   💸 Bước 2: Gọi buyJob contract...`);

        // Convert token ID sang EVM address
        const memeAddress = this.tokenIdToEvmAddress(token.tokenId);
        console.log(`   📝 Token EVM address: ${memeAddress}`);

        // Prepare parameters theo ABI:
        // buyJob(address memeAddress, uint256 amount, address referrer)
        const params = new ContractFunctionParameters()
          .addAddress(memeAddress)                           // Token address
          .addUint256(this.config.MIN_TOKENS_OUT)           // Min tokens out (slippage protection)
          .addAddress(this.config.REFERRER_ADDRESS);        // Referrer address

        // Create transaction
        const transaction = new ContractExecuteTransaction()
          .setContractId(this.contractId)
          .setGas(800000)                                    // Tăng gas limit
          .setPayableAmount(new Hbar(this.config.BUY_AMOUNT_HBAR))  // HBAR to spend
          .setFunction("buyJob", params);

        console.log(`   📤 Sending transaction...`);
        console.log(`   ⛽ Gas: 800000`);
        console.log(`   💵 Payable Amount: ${this.config.BUY_AMOUNT_HBAR} HBAR`);

        // Execute
        const txResponse = await transaction.execute(this.hederaClient);
        console.log(`   ⏳ Đang chờ receipt...`);

        const receipt = await txResponse.getReceipt(this.hederaClient);

        if (receipt.status.toString() === "SUCCESS") {
          console.log("   ✅ MUA THÀNH CÔNG!");
          console.log(`   Transaction ID: ${txResponse.transactionId.toString()}`);
          console.log(`   Status: ${receipt.status.toString()}\n`);

          this.stats.purchased++;
          await this.sendNotification(token, {
            transactionId: txResponse.transactionId.toString(),
            status: receipt.status.toString(),
          });
          return; // Success, exit retry loop
        } else {
          throw new Error(`Transaction failed with status: ${receipt.status.toString()}`);
        }

      } catch (error) {
        console.error(`   ❌ Lần ${attempt} thất bại: ${error.message}`);

        // Log chi tiết lỗi
        if (error.status) {
          console.error(`   📊 Status: ${error.status._code || error.status}`);
        }

        // Parse CONTRACT_REVERT_EXECUTED details
        if (error.message?.includes("CONTRACT_REVERT_EXECUTED")) {
          console.error(`   ⚠️  CONTRACT_REVERT - Có thể do:`);
          console.error(`      • Liquidity không đủ`);
          console.error(`      • Slippage quá cao`);
          console.error(`      • Token chưa sẵn sàng để trade`);
        }

        // Nếu còn lần retry, đợi rồi thử lại
        if (attempt < this.config.MAX_RETRIES) {
          const waitTime = 2000 * attempt; // Exponential backoff
          console.log(`   🔄 Thử lại sau ${waitTime/1000} giây...`);
          await this.sleep(waitTime);
        } else {
          console.error(`   ❌ ĐÃ HẾT SỐ LẦN THỬ!\n`);
          this.stats.failed++;
        }
      }
    }
  }

  async sendNotification(token, result) {
    const message = `
🎉 ĐÃ MUA TOKEN THÀNH CÔNG!
━━━━━━━━━━━━━━━━
🪙 Token: ${token.name}
🆔 ID: ${token.tokenId}
💰 Đã chi: ${this.config.BUY_AMOUNT_HBAR} HBAR
📈 Market Cap ban đầu: $${token.marketCap.toFixed(2)}
✅ Status: ${result.status}
🔗 TX: ${result.transactionId}
━━━━━━━━━━━━━━━━
    `;
    console.log(message);
  }

  async start() {
    const initialized = await this.initialize();
    if (!initialized) {
      console.error("Không thể khởi động bot!");
      return;
    }

    this.isRunning = true;

    console.log("👀 Bắt đầu theo dõi tokens...\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    while (this.isRunning) {
      await this.checkForTargetToken();

      console.log(`\n📊 Stats: Checked: ${this.stats.checked} | Found: ${this.stats.found} | Purchased: ${this.stats.purchased} | Failed: ${this.stats.failed}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      await this.sleep(this.config.CHECK_INTERVAL);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop() {
    console.log("\n🛑 Đang dừng bot...");
    this.isRunning = false;

    // Cleanup
    if (this.hederaClient) {
      this.hederaClient.close();
    }

    console.log("\n📊 THỐNG KÊ CUỐI CÙNG:");
    console.log(`   Tokens checked: ${this.stats.checked}`);
    console.log(`   Target found: ${this.stats.found}`);
    console.log(`   Purchased: ${this.stats.purchased}`);
    console.log(`   Failed: ${this.stats.failed}`);
    console.log("\n👋 Bot đã dừng!\n");
  }
}

// ==================== MAIN ====================
async function main() {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   NCP Token Sniper Bot v2.2 (Fixed)  ║
  ║   Tự động mua token NCP trên MemeJob ║
  ║   Dùng đúng buyJob ABI              ║
  ╚═══════════════════════════════════════╝
  `);

  const bot = new NCPSniperBot(CONFIG);

  process.on("SIGINT", () => {
    bot.stop();
    process.exit(0);
  });

  await bot.start();
}

main().catch((error) => {
  console.error("💥 Lỗi nghiêm trọng:", error);
  process.exit(1);
});
