/**
 * Shown when a claim of this number was undone by an administrator less than 24 h ago: by the claim page
 * (/login/claim) and by POST /api/auth/claim. Isomorphic. U+00A0 keeps "24 ชั่วโมง" on one line.
 */
export const CLAIM_BLOCKED =
  "ผู้ดูแลยกเลิกการยืนยันชื่อของเบอร์นี้แล้ว จึงเลือกชื่อใหม่ได้หลังจาก 24\u00A0ชั่วโมง หากต้องการใช้งานตอนนี้ กรุณาติดต่อผู้ดูแล";

/** As CLAIM_BLOCKED, when the undone claim was this LINE account's (so no other number helps either). */
export const CLAIM_BLOCKED_LINE =
  "ผู้ดูแลยกเลิกการยืนยันชื่อของบัญชี LINE นี้แล้ว จึงเลือกชื่อใหม่ได้หลังจาก 24\u00A0ชั่วโมง หากต้องการใช้งานตอนนี้ กรุณาติดต่อผู้ดูแล";
