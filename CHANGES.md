# Token Sniper Bot - Changelog v2.2

## Các thay đổi chính để sửa lỗi CONTRACT_REVERT_EXECUTED

### 🔧 Vấn đề đã sửa:

1. **Sử dụng đúng ABI của hàm `buyJob`**
   - Trước: Gọi SDK buy() với parameters không đúng
   - Sau: Gọi trực tiếp contract với `buyJob(memeAddress, amount, referrer)`

2. **Convert Token ID sang EVM Address**
   - Hedera token ID format: `0.0.xxxxx`
   - Contract cần EVM address format: `0x...`
   - Thêm hàm `tokenIdToEvmAddress()` để convert đúng

3. **Payable Transaction**
   - Dùng `setPayableAmount()` để gửi HBAR kèm theo transaction
   - HBAR này sẽ được dùng để mua token

4. **Gas Limit**
   - Tăng gas lên 800,000 để đủ cho transaction phức tạp

5. **Better Error Handling**
   - Parse chi tiết lỗi CONTRACT_REVERT_EXECUTED
   - Hiển thị nguyên nhân có thể: liquidity, slippage, token chưa ready

### 📋 Cấu trúc buyJob theo ABI:

```javascript
buyJob(
  address memeAddress,    // EVM address của token (convert từ 0.0.xxxxx)
  uint256 amount,         // Số token tối thiểu muốn nhận (slippage protection)
  address referrer        // Địa chỉ referrer (hoặc zero address)
)
```

### 🔄 Flow mua token mới:

1. **Associate Token** - Đảm bảo account có thể nhận token
2. **Convert Token ID** - Từ Hedera format sang EVM format
3. **Prepare Parameters** - Theo đúng ABI specification
4. **Execute Transaction** - Với payable HBAR amount
5. **Wait for Receipt** - Verify transaction success

### ⚙️ Cấu hình quan trọng:

```javascript
const CONFIG = {
  BUY_AMOUNT_HBAR: 1,     // Số HBAR sẽ chi để mua
  MIN_TOKENS_OUT: 0,      // Số token tối thiểu nhận được (0 = accept any)
  REFERRER_ADDRESS: "0x0000000000000000000000000000000000000000", // Zero = no referrer
  DRY_RUN: false,         // true = test mode
  MAX_RETRIES: 3,         // Retry khi fail
};
```

### 🎯 Khuyến nghị:

1. **Test với DRY_RUN = true trước** để xem flow hoạt động
2. **Bắt đầu với số HBAR nhỏ** (1-5 HBAR) để test
3. **MIN_TOKENS_OUT = 0** cho lần đầu (accept any slippage)
4. **Monitor transaction** trên HashScan để debug

### 🐛 Debug CONTRACT_REVERT_EXECUTED:

Nếu vẫn gặp lỗi này, check:
- [ ] Token đã được tạo và active chưa?
- [ ] Có đủ liquidity trong pool chưa?
- [ ] HBAR amount có hợp lệ không? (> 0)
- [ ] Account có đủ HBAR không?
- [ ] Token address convert đúng chưa?

### 📊 Test Command:

```bash
# Install dependencies
npm install

# Test mode
# Sửa DRY_RUN = true trong CONFIG
node sniper-fixed.js

# Live mode (thật)
# Sửa DRY_RUN = false trong CONFIG
node sniper-fixed.js
```

## Changes Summary:

- ✅ Fixed buyJob ABI implementation
- ✅ Added Token ID to EVM address conversion
- ✅ Proper payable transaction handling
- ✅ Increased gas limit to 800k
- ✅ Enhanced error messages
- ✅ Exponential backoff retry logic
- ✅ Clean client shutdown
