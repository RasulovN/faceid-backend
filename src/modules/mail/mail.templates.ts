/** O'zbek tilidagi HTML email shablonlari */

function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="uz">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(30,50,120,.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:28px 32px;">
            <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:.5px;">FaceID Platform</div>
            <div style="font-size:13px;color:#dbeafe;margin-top:4px;">Yuzni tanish orqali davomat tizimi</div>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:19px;color:#111827;">${title}</h2>
          ${content}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #eef1f6;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6;">
            Bu xat FaceID Platform tomonidan avtomatik yuborildi. Agar bu amalni siz bajarmagan bo‘lsangiz, xatni e’tiborsiz qoldiring.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:10px;background:#2563eb;">
    <a href="${url}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
  </td></tr></table>
  <div style="font-size:12px;color:#6b7280;">Tugma ishlamasa, quyidagi havolani brauzerga nusxalang:<br><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></div>`;
}

export function verificationEmailTemplate(name: string, url: string): string {
  return layout(
    'Email manzilingizni tasdiqlang',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Assalomu alaykum, <b>${name}</b>!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">FaceID Platformada ro‘yxatdan o‘tganingiz uchun rahmat. Hisobingizni faollashtirish uchun email manzilingizni tasdiqlang:</p>
     ${button(url, 'Emailni tasdiqlash')}`,
  );
}

export function passwordResetTemplate(name: string, url: string): string {
  return layout(
    'Parolni tiklash',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Assalomu alaykum, <b>${name}</b>!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Hisobingiz uchun parolni tiklash so‘rovi qabul qilindi. Yangi parol o‘rnatish uchun tugmani bosing. Havola <b>1 soat</b> davomida amal qiladi:</p>
     ${button(url, 'Yangi parol o‘rnatish')}`,
  );
}

export function employeeCredentialsTemplate(
  name: string,
  companyName: string,
  username: string,
  password: string,
  loginUrl: string,
): string {
  return layout(
    'FaceID tizimiga xush kelibsiz',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Assalomu alaykum, <b>${name}</b>!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;"><b>${companyName}</b> kompaniyasi sizni FaceID davomat tizimiga qo‘shdi. Kirish ma’lumotlaringiz:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f3f4f6;border-radius:10px;width:100%;">
       <tr><td style="padding:16px 20px;">
         <div style="font-size:13px;color:#6b7280;">Login</div>
         <div style="font-size:16px;color:#111827;font-weight:600;margin-bottom:12px;">${username}</div>
         <div style="font-size:13px;color:#6b7280;">Parol</div>
         <div style="font-size:16px;color:#111827;font-weight:600;font-family:Consolas,monospace;">${password}</div>
       </td></tr>
     </table>
     <p style="font-size:13px;color:#b45309;background:#fef3c7;padding:10px 14px;border-radius:8px;">Xavfsizlik uchun birinchi kirishdan so‘ng parolni o‘zgartirishni tavsiya qilamiz.</p>
     ${button(loginUrl, 'Tizimga kirish')}`,
  );
}

export function subscriptionExpiringTemplate(
  companyName: string,
  daysLeft: number,
  endsAt: string,
  payUrl: string,
): string {
  return layout(
    'Obuna muddati tugayapti',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Hurmatli <b>${companyName}</b> rahbariyati!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Obunangiz muddati tugashiga <b style="color:#dc2626;">${daysLeft} kun</b> qoldi (${endsAt}). Xizmat uzluksiz davom etishi uchun to‘lovni oldindan amalga oshiring.</p>
     ${button(payUrl, 'To‘lovni amalga oshirish')}`,
  );
}

export function paymentSuccessTemplate(
  companyName: string,
  amountLabel: string,
  tariffName: string,
  months: number,
  receiptUrl: string,
): string {
  return layout(
    'To‘lov qabul qilindi ✅',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Hurmatli <b>${companyName}</b> rahbariyati!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">To‘lovingiz muvaffaqiyatli qabul qilindi va obunangiz faollashtirildi:</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;width:100%;">
       <tr><td style="padding:16px 20px;">
         <div style="font-size:13px;color:#6b7280;">Tarif</div>
         <div style="font-size:16px;color:#111827;font-weight:600;margin-bottom:12px;">${tariffName} · ${months} oy</div>
         <div style="font-size:13px;color:#6b7280;">Summa</div>
         <div style="font-size:20px;color:#059669;font-weight:700;">${amountLabel}</div>
       </td></tr>
     </table>
     ${button(receiptUrl, 'To‘lov chekini ko‘rish')}`,
  );
}

export function paymentRevokedTemplate(
  companyName: string,
  amountLabel: string,
  tariffName: string,
  payUrl: string,
): string {
  return layout(
    'To‘lov qaytarildi',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Hurmatli <b>${companyName}</b> rahbariyati!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;"><b>${tariffName}</b> tarifi uchun <b>${amountLabel}</b> miqdoridagi to‘lov Payme tomonidan bekor qilindi (qaytarildi). Obuna muddati mos ravishda qisqartirildi.</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Xizmat uzluksiz davom etishi uchun to‘lovni qaytadan amalga oshirishingiz mumkin:</p>
     ${button(payUrl, 'To‘lovni amalga oshirish')}`,
  );
}

export function leadApprovedTemplate(name: string, registerUrl: string): string {
  return layout(
    'Murojaatingiz tasdiqlandi 🎉',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Assalomu alaykum, <b>${name}</b>!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">FaceID Platformaga qoldirgan murojaatingizni ko‘rib chiqdik va <b style="color:#059669;">tasdiqladik</b>. Jamoamiz siz bilan tez orada bog‘lanadi — tizimni jonli ko‘rsatib beramiz va kompaniyangizga mos tarifni tanlashda yordam beramiz.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;width:100%;">
       <tr><td style="padding:16px 20px;">
         <div style="font-size:14px;color:#065f46;line-height:1.7;">
           ✔ Yuzni tanish orqali avtomatik davomat<br>
           ✔ Kechikish va qo‘shimcha ish vaqtining aniq hisobi<br>
           ✔ Oylik hisob-kitob (payroll) — har bir so‘m shaffof
         </div>
       </td></tr>
     </table>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Hoziroq o‘zingiz ham ro‘yxatdan o‘tib, <b>14 kunlik bepul sinov</b> davrini boshlashingiz mumkin:</p>
     ${button(registerUrl, 'Ro‘yxatdan o‘tish')}`,
  );
}

export function leadRejectedTemplate(name: string): string {
  return layout(
    'Murojaatingiz bo‘yicha javob',
    `<p style="font-size:15px;color:#374151;line-height:1.7;">Assalomu alaykum, <b>${name}</b>!</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">FaceID Platformaga qoldirgan murojaatingiz uchun tashakkur. Afsuski, hozirgi bosqichda so‘rovingiz bo‘yicha xizmat taqdim eta olmaymiz.</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Vaziyat o‘zgarsa yoki qo‘shimcha savollaringiz bo‘lsa, shu xatga javob yozishingiz mumkin — jamoamiz albatta ko‘rib chiqadi.</p>
     <p style="font-size:15px;color:#374151;line-height:1.7;">Hurmat bilan,<br><b>FaceID Platform jamoasi</b></p>`,
  );
}
