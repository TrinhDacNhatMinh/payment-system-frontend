// Synthetic signed-link shape only. No real merchant secret or HMAC is used in tests.
export const depositKey = '550e8400-e29b-41d4-a716-446655440000';
export const depositGatewayConfig = {
  apiBaseUrl: 'http://localhost:8080',
  merchantCode: 'TESTCODE',
};

export function makeVnpayReturnFragment() {
  const query = new URLSearchParams({
    vnp_TxnRef: makeDepositOrder().orderId,
    vnp_Amount: '5000000',
    vnp_OrderInfo: 'Top up + coffee & lunch',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TransactionNo: '12345',
    vnp_PayDate: '20261022100500',
    vnp_TmnCode: 'TESTCODE',
    vnp_SecureHash: 'a'.repeat(128),
  }).toString();
  return `vnpayReturn=${encodeURIComponent(query)}`;
}

export function makeDepositOrder() {
  const orderId = 'VNPAY_0123456789ABCDEF';
  const amount = 50000;
  const query = new URLSearchParams({
    vnp_TxnRef: orderId,
    vnp_Amount: String(amount * 100),
    vnp_TmnCode: depositGatewayConfig.merchantCode,
    vnp_ReturnUrl: `${depositGatewayConfig.apiBaseUrl}/api/v1/payment/vnpay-return`,
    vnp_CurrCode: 'VND',
    vnp_Command: 'pay',
    vnp_Version: '2.1.0',
    vnp_CreateDate: '20261022100000',
    vnp_ExpireDate: '20261022101500',
    vnp_SecureHash: 'a'.repeat(128),
    vnp_OrderInfo: 'Nap tien vao vi',
  });
  return {
    orderId,
    idempotencyKey: depositKey,
    amount,
    currency: 'VND',
    status: 'PENDING',
    createdAt: '2026-10-22T10:00:00',
    paymentUrlExpiresAt: '2026-10-22T10:15:00',
    paidAt: null,
    canContinuePayment: true,
    paymentUrl: `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${query.toString()}`,
  };
}
