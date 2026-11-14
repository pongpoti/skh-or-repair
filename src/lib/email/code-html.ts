import { BRAND_MARK_CID } from "./brand-mark";

/**
 * The HTML part of the sign-in code email, drawn like the app's sign-in pages (components/auth-shell.tsx): the
 * surgeon mark, the ORSKH.APP wordmark, and a cream card on the warm canvas, in the colours of app/globals.css.
 * Mail apps only keep inline styles and tables, so everything is written that way. Like the text version it has no
 * links and loads nothing from the web (no web fonts, no remote images: the mark is an inline cid image), so the app's
 * fonts show only where they are installed and the system font elsewhere. The app has only a light theme, so the
 * email asks to stay light ("light only", the one value the Gmail apps honour). The code's cell is padded 10 px more
 * on the left to balance the letter-spacing after the last digit (Outlook ignores padding on a span).
 */

// app/globals.css
const C = {
  canvas: "#faf5ee",
  surface: "#fdfaf5",
  line: "#e9e0d5",
  ink: "#241c16",
  ink2: "#4a3b30",
  muted: "#5f5045",
  brandStrong: "#2e2219",
  brandTint: "#f1e7da",
  // the .btn-secondary border, rgb(124 96 66 / 0.28), over brand-tint
  tanEdge: "#d0c1b0",
} as const;

const FONT = "Inter,'Noto Sans Thai Looped','Noto Sans Thai',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Tahoma,Arial,sans-serif";

// Invisible filler after the preheader, so the inbox preview stops there instead of running on into the body.
const PREHEADER_FILL = "&#8199;&#847;".repeat(90);

// The wordmark's ".APP" is split by zero-width non-joiners and the footer says only "ORSKH", so no mail app reads
// "ORSKH.APP" as a web address and turns it into a link: the email has no links.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function codeHtml(code: string, name: string, ttlMin: number): string {
  const c = escapeHtml(code);
  const n = escapeHtml(name);
  const font = `font-family:${FONT};`;
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>รหัสเข้าสู่ระบบ ORSKH</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  body { margin: 0; padding: 0; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font: inherit !important; }
  @media (max-width: 480px) {
    .card-pad { padding: 28px 20px 24px !important; }
    .code-cell { padding-left: 20px !important; }
    .code { font-size: 32px !important; letter-spacing: 8px !important; }
  }
</style>
<!--[if mso]><style>td, p, span { font-family: 'Segoe UI', Tahoma, Arial, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0;">รหัสของคุณคือ ${c} ใช้ได้ ${ttlMin} นาที${PREHEADER_FILL}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="440" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;">
<tr><td class="card-pad" style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:32px 28px 28px;${font}">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:0;">
<img src="cid:${BRAND_MARK_CID}" width="64" height="64" alt="ORSKH" style="display:block;width:64px;height:64px;border:0;border-radius:20px;">
</td></tr>
<tr><td align="center" style="padding:14px 0 0;${font}font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.2px;color:${C.ink};">ORSKH<span style="font-weight:500;color:${C.muted};">&zwnj;.&zwnj;APP</span></td></tr>
<tr><td align="center" style="padding:2px 0 0;${font}font-size:15px;line-height:22px;font-weight:600;color:${C.ink2};">รหัสเข้าสู่ระบบตารางห้องผ่าตัด</td></tr>
</table>

<p style="margin:24px 0 0;${font}font-size:15px;line-height:24px;color:${C.ink};">เรียน ${n}</p>
<p style="margin:4px 0 0;${font}font-size:14px;line-height:22px;color:${C.muted};">กรอกรหัสนี้ในหน้ายืนยันตัวตนทางอีเมล</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">
<tr><td align="center" class="code-cell" style="background:${C.brandTint};border:1px solid ${C.tanEdge};border-radius:12px;padding:18px 12px 18px 22px;">
<span class="code" style="${font}font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;color:${C.brandStrong};font-variant-numeric:tabular-nums;white-space:nowrap;">${c}</span>
</td></tr>
</table>
<p style="margin:10px 0 0;text-align:center;${font}font-size:13px;line-height:20px;color:${C.muted};">ใช้ได้ ${ttlMin} นาที และใช้ได้ครั้งเดียว</p>

</td></tr>
<tr><td align="center" style="padding:16px 8px 0;${font}font-size:12px;line-height:18px;color:${C.muted};">อีเมลนี้ส่งโดยอัตโนมัติจากระบบตารางห้องผ่าตัด ORSKH</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
