import type { Language } from '@/lib/i18n';

type TemplateValues = Record<string, number | string>;

type ChromeText = {
  close: string;
  loading: string;
  breadcrumb: string;
  more: string;
  pagination: string;
  goToPreviousPage: string;
  previous: string;
  goToNextPage: string;
  next: string;
  morePages: string;
  sidebar: string;
  mobileSidebarDescription: string;
  openSidebar: string;
  closeSidebar: string;
  toggleSidebar: string;
  invitations: string;
  invitationsDescription: string;
  invitationEmail: string;
  creating: string;
  createInvitation: string;
  invitationFor: string;
  copied: string;
  copyLink: string;
  expires: string;
  retry: string;
  loadingInvitations: string;
  noInvitations: string;
  pending: string;
  accepted: string;
  revoked: string;
  expired: string;
  revoke: string;
  revokeInvitation: string;
  notAvailable: string;
  invitationsCouldNotLoad: string;
  invitationCouldNotCreate: string;
  invitationCouldNotRevoke: string;
  invalidInvitationEmail: string;
  invitationAlreadyPending: string;
  invitationNotFound: string;
  signInAgain: string;
  permissionDenied: string;
  rateLimited: string;
  networkError: string;
  download: string;
};

const en: ChromeText = {
  close: 'Close',
  loading: 'Loading',
  breadcrumb: 'Breadcrumb',
  more: 'More',
  pagination: 'Pagination',
  goToPreviousPage: 'Go to previous page',
  previous: 'Previous',
  goToNextPage: 'Go to next page',
  next: 'Next',
  morePages: 'More pages',
  sidebar: 'Sidebar',
  mobileSidebarDescription: 'Displays the mobile sidebar.',
  openSidebar: 'Open sidebar',
  closeSidebar: 'Close sidebar',
  toggleSidebar: 'Toggle sidebar',
  invitations: 'Invitations',
  invitationsDescription:
    'Invite a teammate by email. The join link is shown once — copy it now; only its hash is stored. The private beta caps enrollment at ten active users.',
  invitationEmail: 'Invitation email',
  creating: 'Creating…',
  createInvitation: 'Create invitation',
  invitationFor: 'Invitation for {email} — copy the join link now; it will not be shown again.',
  copied: 'Copied',
  copyLink: 'Copy link',
  expires: 'Expires {date}.',
  retry: 'Retry',
  loadingInvitations: 'Loading invitations…',
  noInvitations: 'No invitations yet.',
  pending: 'Pending',
  accepted: 'Accepted',
  revoked: 'Revoked',
  expired: 'Expired',
  revoke: 'Revoke',
  revokeInvitation: 'Revoke invitation for {email}',
  notAvailable: 'Not available',
  invitationsCouldNotLoad: 'The invitations could not be loaded.',
  invitationCouldNotCreate: 'The invitation could not be created.',
  invitationCouldNotRevoke: 'The invitation could not be revoked.',
  invalidInvitationEmail: 'Enter a valid invitation email.',
  invitationAlreadyPending: 'An active invitation already exists for this email.',
  invitationNotFound: 'Invitation not found.',
  signInAgain: 'Please sign in again, then try again.',
  permissionDenied: 'You do not have permission to manage invitations.',
  rateLimited: 'Too many requests. Wait a moment and try again.',
  networkError: 'The service could not be reached. Check your connection and try again.',
  download: 'Download',
};

const km: ChromeText = {
  close: 'បិទ',
  loading: 'កំពុងផ្ទុក',
  breadcrumb: 'ផ្លូវរុករក',
  more: 'បន្ថែម',
  pagination: 'ការបែងចែកទំព័រ',
  goToPreviousPage: 'ទៅទំព័រមុន',
  previous: 'មុន',
  goToNextPage: 'ទៅទំព័របន្ទាប់',
  next: 'បន្ទាប់',
  morePages: 'ទំព័របន្ថែម',
  sidebar: 'របារចំហៀង',
  mobileSidebarDescription: 'បង្ហាញរបារចំហៀងលើទូរស័ព្ទ។',
  openSidebar: 'បើករបារចំហៀង',
  closeSidebar: 'បិទរបារចំហៀង',
  toggleSidebar: 'បិទ/បើករបារចំហៀង',
  invitations: 'ការអញ្ជើញ',
  invitationsDescription:
    'អញ្ជើញមិត្តរួមក្រុមតាមអ៊ីមែល។ តំណចូលរួមបង្ហាញតែម្តងប៉ុណ្ណោះ — សូមចម្លងឥឡូវនេះ; មានតែ hash របស់វាប៉ុណ្ណោះដែលត្រូវបានរក្សាទុក។ កំណែសាកល្បងឯកជនកំណត់ការចុះឈ្មោះត្រឹមអ្នកប្រើសកម្ម 10 នាក់។',
  invitationEmail: 'អ៊ីមែលសម្រាប់ការអញ្ជើញ',
  creating: 'កំពុងបង្កើត…',
  createInvitation: 'បង្កើតការអញ្ជើញ',
  invitationFor: 'ការអញ្ជើញសម្រាប់ {email} — សូមចម្លងតំណចូលរួមឥឡូវនេះ; វានឹងមិនបង្ហាញម្តងទៀតទេ។',
  copied: 'បានចម្លង',
  copyLink: 'ចម្លងតំណ',
  expires: 'ផុតកំណត់ {date}។',
  retry: 'ព្យាយាមម្តងទៀត',
  loadingInvitations: 'កំពុងផ្ទុកការអញ្ជើញ…',
  noInvitations: 'មិនទាន់មានការអញ្ជើញទេ។',
  pending: 'កំពុងរង់ចាំ',
  accepted: 'បានទទួលយក',
  revoked: 'បានដកហូត',
  expired: 'ផុតកំណត់',
  revoke: 'ដកហូត',
  revokeInvitation: 'ដកហូតការអញ្ជើញសម្រាប់ {email}',
  notAvailable: 'មិនមាន',
  invitationsCouldNotLoad: 'មិនអាចផ្ទុកការអញ្ជើញបានទេ។',
  invitationCouldNotCreate: 'មិនអាចបង្កើតការអញ្ជើញបានទេ។',
  invitationCouldNotRevoke: 'មិនអាចដកហូតការអញ្ជើញបានទេ។',
  invalidInvitationEmail: 'សូមបញ្ចូលអ៊ីមែលសម្រាប់ការអញ្ជើញត្រឹមត្រូវ។',
  invitationAlreadyPending: 'មានការអញ្ជើញសកម្មស្រាប់សម្រាប់អ៊ីមែលនេះ។',
  invitationNotFound: 'រកមិនឃើញការអញ្ជើញទេ។',
  signInAgain: 'សូមចូលគណនីម្ដងទៀត រួចព្យាយាមម្តងទៀត។',
  permissionDenied: 'អ្នកមិនមានសិទ្ធិគ្រប់គ្រងការអញ្ជើញទេ។',
  rateLimited: 'មានសំណើច្រើនពេក។ សូមរង់ចាំបន្តិច រួចព្យាយាមម្តងទៀត។',
  networkError: 'មិនអាចចូលដំណើរការសេវាបានទេ។ សូមពិនិត្យការតភ្ជាប់ រួចព្យាយាមម្តងទៀត។',
  download: 'ទាញយក',
};

const id: ChromeText = {
  close: 'Tutup',
  loading: 'Memuat',
  breadcrumb: 'Jejak navigasi',
  more: 'Lainnya',
  pagination: 'Paginasi',
  goToPreviousPage: 'Ke halaman sebelumnya',
  previous: 'Sebelumnya',
  goToNextPage: 'Ke halaman berikutnya',
  next: 'Berikutnya',
  morePages: 'Halaman lainnya',
  sidebar: 'Bilah samping',
  mobileSidebarDescription: 'Menampilkan bilah samping seluler.',
  openSidebar: 'Buka bilah samping',
  closeSidebar: 'Tutup bilah samping',
  toggleSidebar: 'Alihkan bilah samping',
  invitations: 'Undangan',
  invitationsDescription:
    'Undang rekan tim melalui email. Tautan bergabung hanya ditampilkan sekali — salin sekarang; hanya hash-nya yang disimpan. Beta privat membatasi pendaftaran hingga sepuluh pengguna aktif.',
  invitationEmail: 'Email undangan',
  creating: 'Membuat…',
  createInvitation: 'Buat undangan',
  invitationFor: 'Undangan untuk {email} — salin tautan bergabung sekarang; tautan ini tidak akan ditampilkan lagi.',
  copied: 'Disalin',
  copyLink: 'Salin tautan',
  expires: 'Berakhir {date}.',
  retry: 'Coba lagi',
  loadingInvitations: 'Memuat undangan…',
  noInvitations: 'Belum ada undangan.',
  pending: 'Menunggu',
  accepted: 'Diterima',
  revoked: 'Dicabut',
  expired: 'Kedaluwarsa',
  revoke: 'Cabut',
  revokeInvitation: 'Cabut undangan untuk {email}',
  notAvailable: 'Tidak tersedia',
  invitationsCouldNotLoad: 'Undangan tidak dapat dimuat.',
  invitationCouldNotCreate: 'Undangan tidak dapat dibuat.',
  invitationCouldNotRevoke: 'Undangan tidak dapat dicabut.',
  invalidInvitationEmail: 'Masukkan email undangan yang valid.',
  invitationAlreadyPending: 'Undangan aktif sudah ada untuk email ini.',
  invitationNotFound: 'Undangan tidak ditemukan.',
  signInAgain: 'Silakan masuk lagi, lalu coba kembali.',
  permissionDenied: 'Anda tidak memiliki izin untuk mengelola undangan.',
  rateLimited: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  networkError: 'Layanan tidak dapat dijangkau. Periksa koneksi Anda lalu coba lagi.',
  download: 'Unduh',
};

const lo: ChromeText = {
  close: 'ປິດ',
  loading: 'ກຳລັງໂຫຼດ',
  breadcrumb: 'ເສັ້ນທາງນຳທາງ',
  more: 'ເພີ່ມເຕີມ',
  pagination: 'ການແບ່ງໜ້າ',
  goToPreviousPage: 'ໄປໜ້າກ່ອນໜ້າ',
  previous: 'ກ່ອນໜ້າ',
  goToNextPage: 'ໄປໜ້າຕໍ່ໄປ',
  next: 'ຕໍ່ໄປ',
  morePages: 'ໜ້າເພີ່ມເຕີມ',
  sidebar: 'ແຖບຂ້າງ',
  mobileSidebarDescription: 'ສະແດງແຖບຂ້າງສຳລັບມືຖື.',
  openSidebar: 'ເປີດແຖບຂ້າງ',
  closeSidebar: 'ປິດແຖບຂ້າງ',
  toggleSidebar: 'ສະຫຼັບແຖບຂ້າງ',
  invitations: 'ຄຳເຊີນ',
  invitationsDescription:
    'ເຊີນສະມາຊິກທີມຜ່ານອີເມວ. ລິ້ງເຂົ້າຮ່ວມຈະສະແດງພຽງຄັ້ງດຽວ — ຄັດລອກດຽວນີ້; ຈະເກັບໄວ້ພຽງ hash ຂອງມັນ. beta ສ່ວນຕົວຈຳກັດການລົງທະບຽນເຖິງ 10 ຜູ້ໃຊ້ທີ່ເຄື່ອນໄຫວ.',
  invitationEmail: 'ອີເມວຄຳເຊີນ',
  creating: 'ກຳລັງສ້າງ…',
  createInvitation: 'ສ້າງຄຳເຊີນ',
  invitationFor: 'ຄຳເຊີນສຳລັບ {email} — ຄັດລອກລິ້ງເຂົ້າຮ່ວມດຽວນີ້; ມັນຈະບໍ່ສະແດງອີກ.',
  copied: 'ຄັດລອກແລ້ວ',
  copyLink: 'ຄັດລອກລິ້ງ',
  expires: 'ໝົດອາຍຸ {date}.',
  retry: 'ລອງໃໝ່',
  loadingInvitations: 'ກຳລັງໂຫຼດຄຳເຊີນ…',
  noInvitations: 'ຍັງບໍ່ມີຄຳເຊີນ.',
  pending: 'ລໍຖ້າ',
  accepted: 'ຍອມຮັບແລ້ວ',
  revoked: 'ຖອນແລ້ວ',
  expired: 'ໝົດອາຍຸ',
  revoke: 'ຖອນ',
  revokeInvitation: 'ຖອນຄຳເຊີນສຳລັບ {email}',
  notAvailable: 'ບໍ່ມີ',
  invitationsCouldNotLoad: 'ບໍ່ສາມາດໂຫຼດຄຳເຊີນໄດ້.',
  invitationCouldNotCreate: 'ບໍ່ສາມາດສ້າງຄຳເຊີນໄດ້.',
  invitationCouldNotRevoke: 'ບໍ່ສາມາດຖອນຄຳເຊີນໄດ້.',
  invalidInvitationEmail: 'ກະລຸນາໃສ່ອີເມວຄຳເຊີນທີ່ຖືກຕ້ອງ.',
  invitationAlreadyPending: 'ມີຄຳເຊີນທີ່ໃຊ້ງານຢູ່ແລ້ວສຳລັບອີເມວນີ້.',
  invitationNotFound: 'ບໍ່ພົບຄຳເຊີນ.',
  signInAgain: 'ກະລຸນາເຂົ້າລະບົບອີກຄັ້ງ ແລ້ວລອງໃໝ່.',
  permissionDenied: 'ທ່ານບໍ່ມີສິດຈັດການຄຳເຊີນ.',
  rateLimited: 'ມີຄຳຮ້ອງຂໍຫຼາຍເກີນໄປ. ລໍຖ້າຈັກໜ່ອຍແລ້ວລອງໃໝ່.',
  networkError: 'ບໍ່ສາມາດເຂົ້າເຖິງບໍລິການໄດ້. ກວດເບິ່ງການເຊື່ອມຕໍ່ ແລ້ວລອງໃໝ່.',
  download: 'ດາວໂຫຼດ',
};

const my: ChromeText = {
  close: 'ပိတ်ရန်',
  loading: 'ဖွင့်နေသည်',
  breadcrumb: 'လမ်းညွှန်လမ်းကြောင်း',
  more: 'နောက်ထပ်',
  pagination: 'စာမျက်နှာခွဲခြင်း',
  goToPreviousPage: 'ယခင်စာမျက်နှာသို့ သွားရန်',
  previous: 'ယခင်',
  goToNextPage: 'နောက်စာမျက်နှာသို့ သွားရန်',
  next: 'နောက်',
  morePages: 'နောက်ထပ်စာမျက်နှာများ',
  sidebar: 'ဘေးဘား',
  mobileSidebarDescription: 'မိုဘိုင်းဘေးဘားကို ပြသသည်။',
  openSidebar: 'ဘေးဘားဖွင့်ရန်',
  closeSidebar: 'ဘေးဘားပိတ်ရန်',
  toggleSidebar: 'ဘေးဘားဖွင့်/ပိတ်ရန်',
  invitations: 'ဖိတ်ခေါ်မှုများ',
  invitationsDescription:
    'အသင်းဖော်ကို အီးမေးလ်ဖြင့် ဖိတ်ခေါ်ပါ။ ဝင်ရောက်ရန်လင့်ခ်ကို တစ်ကြိမ်သာ ပြသမည် — ယခုကူးယူပါ; ၎င်း၏ hash ကိုသာ သိမ်းဆည်းထားသည်။ ကိုယ်ပိုင် beta တွင် အသက်ဝင်အသုံးပြုသူ 10 ဦးအထိသာ စာရင်းသွင်းနိုင်သည်။',
  invitationEmail: 'ဖိတ်ခေါ်အီးမေးလ်',
  creating: 'ဖန်တီးနေသည်…',
  createInvitation: 'ဖိတ်ခေါ်မှုဖန်တီးရန်',
  invitationFor: '{email} အတွက် ဖိတ်ခေါ်မှု — ဝင်ရောက်ရန်လင့်ခ်ကို ယခုကူးယူပါ; ထပ်မံပြသမည်မဟုတ်ပါ။',
  copied: 'ကူးယူပြီး',
  copyLink: 'လင့်ခ်ကူးယူရန်',
  expires: '{date} တွင် သက်တမ်းကုန်သည်။',
  retry: 'ထပ်စမ်းရန်',
  loadingInvitations: 'ဖိတ်ခေါ်မှုများကို ဖွင့်နေသည်…',
  noInvitations: 'ဖိတ်ခေါ်မှု မရှိသေးပါ။',
  pending: 'စောင့်ဆိုင်းနေသည်',
  accepted: 'လက်ခံပြီး',
  revoked: 'ရုပ်သိမ်းပြီး',
  expired: 'သက်တမ်းကုန်ပြီး',
  revoke: 'ရုပ်သိမ်းရန်',
  revokeInvitation: '{email} အတွက် ဖိတ်ခေါ်မှုကို ရုပ်သိမ်းရန်',
  notAvailable: 'မရရှိနိုင်ပါ',
  invitationsCouldNotLoad: 'ဖိတ်ခေါ်မှုများကို မဖွင့်နိုင်ပါ။',
  invitationCouldNotCreate: 'ဖိတ်ခေါ်မှုကို မဖန်တီးနိုင်ပါ။',
  invitationCouldNotRevoke: 'ဖိတ်ခေါ်မှုကို မရုပ်သိမ်းနိုင်ပါ။',
  invalidInvitationEmail: 'မှန်ကန်သော ဖိတ်ခေါ်အီးမေးလ်ကို ထည့်ပါ။',
  invitationAlreadyPending: 'ဤအီးမေးလ်အတွက် အသက်ဝင်သော ဖိတ်ခေါ်မှု ရှိပြီးသားဖြစ်သည်။',
  invitationNotFound: 'ဖိတ်ခေါ်မှုကို မတွေ့ပါ။',
  signInAgain: 'ကျေးဇူးပြု၍ ထပ်မံဝင်ရောက်ပြီး ပြန်စမ်းပါ။',
  permissionDenied: 'ဖိတ်ခေါ်မှုများကို စီမံရန် သင့်တွင် ခွင့်ပြုချက်မရှိပါ။',
  rateLimited: 'တောင်းဆိုမှုများလွန်းနေသည်။ ခဏစောင့်ပြီး ထပ်စမ်းပါ။',
  networkError: 'ဝန်ဆောင်မှုကို မရောက်ရှိနိုင်ပါ။ ချိတ်ဆက်မှုကို စစ်ဆေးပြီး ထပ်စမ်းပါ။',
  download: 'ဒေါင်းလုဒ်',
};

const th: ChromeText = {
  close: 'ปิด',
  loading: 'กำลังโหลด',
  breadcrumb: 'เส้นทางนำทาง',
  more: 'เพิ่มเติม',
  pagination: 'การแบ่งหน้า',
  goToPreviousPage: 'ไปยังหน้าก่อนหน้า',
  previous: 'ก่อนหน้า',
  goToNextPage: 'ไปยังหน้าถัดไป',
  next: 'ถัดไป',
  morePages: 'หน้าเพิ่มเติม',
  sidebar: 'แถบด้านข้าง',
  mobileSidebarDescription: 'แสดงแถบด้านข้างบนมือถือ',
  openSidebar: 'เปิดแถบด้านข้าง',
  closeSidebar: 'ปิดแถบด้านข้าง',
  toggleSidebar: 'สลับแถบด้านข้าง',
  invitations: 'คำเชิญ',
  invitationsDescription:
    'เชิญเพื่อนร่วมทีมทางอีเมล ลิงก์เข้าร่วมจะแสดงเพียงครั้งเดียว — คัดลอกตอนนี้; ระบบจะเก็บเฉพาะ hash ของลิงก์เท่านั้น รุ่นเบต้าส่วนตัวจำกัดการลงทะเบียนผู้ใช้ที่ใช้งานอยู่ไว้ที่ 10 คน',
  invitationEmail: 'อีเมลสำหรับคำเชิญ',
  creating: 'กำลังสร้าง…',
  createInvitation: 'สร้างคำเชิญ',
  invitationFor: 'คำเชิญสำหรับ {email} — คัดลอกลิงก์เข้าร่วมตอนนี้; ระบบจะไม่แสดงอีกครั้ง',
  copied: 'คัดลอกแล้ว',
  copyLink: 'คัดลอกลิงก์',
  expires: 'หมดอายุ {date}',
  retry: 'ลองอีกครั้ง',
  loadingInvitations: 'กำลังโหลดคำเชิญ…',
  noInvitations: 'ยังไม่มีคำเชิญ',
  pending: 'รอดำเนินการ',
  accepted: 'ยอมรับแล้ว',
  revoked: 'เพิกถอนแล้ว',
  expired: 'หมดอายุแล้ว',
  revoke: 'เพิกถอน',
  revokeInvitation: 'เพิกถอนคำเชิญสำหรับ {email}',
  notAvailable: 'ไม่พร้อมใช้งาน',
  invitationsCouldNotLoad: 'ไม่สามารถโหลดคำเชิญได้',
  invitationCouldNotCreate: 'ไม่สามารถสร้างคำเชิญได้',
  invitationCouldNotRevoke: 'ไม่สามารถเพิกถอนคำเชิญได้',
  invalidInvitationEmail: 'โปรดกรอกอีเมลสำหรับคำเชิญที่ถูกต้อง',
  invitationAlreadyPending: 'มีคำเชิญที่ใช้งานอยู่สำหรับอีเมลนี้แล้ว',
  invitationNotFound: 'ไม่พบคำเชิญ',
  signInAgain: 'โปรดลงชื่อเข้าใช้อีกครั้ง แล้วลองใหม่',
  permissionDenied: 'คุณไม่มีสิทธิ์จัดการคำเชิญ',
  rateLimited: 'มีคำขอมากเกินไป รอสักครู่แล้วลองใหม่',
  networkError: 'ไม่สามารถเข้าถึงบริการได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่',
  download: 'ดาวน์โหลด',
};

const fil: ChromeText = {
  close: 'Isara',
  loading: 'Naglo-load',
  breadcrumb: 'Landas ng pag-navigate',
  more: 'Higit pa',
  pagination: 'Pagpapahina',
  goToPreviousPage: 'Pumunta sa nakaraang pahina',
  previous: 'Nakaraan',
  goToNextPage: 'Pumunta sa susunod na pahina',
  next: 'Susunod',
  morePages: 'Higit pang mga pahina',
  sidebar: 'Panel sa gilid',
  mobileSidebarDescription: 'Ipinapakita ang panel sa gilid sa mobile.',
  openSidebar: 'Buksan ang panel sa gilid',
  closeSidebar: 'Isara ang panel sa gilid',
  toggleSidebar: 'Ipakita o itago ang panel sa gilid',
  invitations: 'Mga imbitasyon',
  invitationsDescription:
    'Mag-imbita ng ka-team sa pamamagitan ng email. Isang beses lang ipinapakita ang link para sumali — kopyahin ito ngayon; hash lang nito ang naka-save. Nililimitahan ng pribadong beta ang enrollment sa sampung aktibong user.',
  invitationEmail: 'Email ng imbitasyon',
  creating: 'Ginagawa…',
  createInvitation: 'Gumawa ng imbitasyon',
  invitationFor: 'Imbitasyon para kay {email} — kopyahin ngayon ang link para sumali; hindi na ito muling ipapakita.',
  copied: 'Nakopya',
  copyLink: 'Kopyahin ang link',
  expires: 'Mag-e-expire {date}.',
  retry: 'Subukan muli',
  loadingInvitations: 'Nilo-load ang mga imbitasyon…',
  noInvitations: 'Wala pang imbitasyon.',
  pending: 'Naghihintay',
  accepted: 'Tinanggap',
  revoked: 'Binawi',
  expired: 'Nag-expire',
  revoke: 'Bawiin',
  revokeInvitation: 'Bawiin ang imbitasyon para kay {email}',
  notAvailable: 'Hindi available',
  invitationsCouldNotLoad: 'Hindi ma-load ang mga imbitasyon.',
  invitationCouldNotCreate: 'Hindi magawa ang imbitasyon.',
  invitationCouldNotRevoke: 'Hindi mabawi ang imbitasyon.',
  invalidInvitationEmail: 'Maglagay ng wastong email ng imbitasyon.',
  invitationAlreadyPending: 'May aktibong imbitasyon na para sa email na ito.',
  invitationNotFound: 'Hindi nakita ang imbitasyon.',
  signInAgain: 'Mag-sign in muli, pagkatapos ay subukan ulit.',
  permissionDenied: 'Wala kang pahintulot na pamahalaan ang mga imbitasyon.',
  rateLimited: 'Masyadong maraming kahilingan. Maghintay sandali at subukan muli.',
  networkError: 'Hindi maabot ang serbisyo. Suriin ang koneksyon at subukan muli.',
  download: 'I-download',
};

export const chromeTranslations: Record<Language, ChromeText> = {
  en,
  km,
  id,
  lo,
  my,
  th,
  fil,
};

const localeByLanguage: Record<Language, string> = {
  en: 'en-US',
  km: 'km-KH',
  id: 'id-ID',
  lo: 'lo-LA',
  my: 'my-MM',
  th: 'th-TH',
  fil: 'fil-PH',
};

function interpolate(template: string, values: TemplateValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    key in values ? String(values[key]) : match
  ));
}

export type ChromeCopy = {
  language: Language;
  locale: string;
  t: (key: keyof ChromeText, values?: TemplateValues) => string;
};

export function getChromeCopy(language: Language): ChromeCopy {
  const text = chromeTranslations[language];
  return {
    language,
    locale: localeByLanguage[language],
    t: (key, values) => interpolate(text[key], values),
  };
}

export function formatChromeDate(
  language: Language,
  value: string | null | undefined,
  fallback: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(localeByLanguage[language], options).format(date);
}

type InvitationErrorLike = {
  code?: unknown;
  status?: unknown;
};

/**
 * API payloads can contain operational or upstream English. Keep those out of
 * the interface while retaining specific, actionable recovery states.
 */
export function chromeInvitationErrorMessage(
  error: unknown,
  copy: ChromeCopy,
  fallbackKey: keyof Pick<ChromeText,
    'invitationsCouldNotLoad' | 'invitationCouldNotCreate' | 'invitationCouldNotRevoke'
  >,
): string {
  const code = typeof error === 'object' && error !== null
    ? (error as InvitationErrorLike).code
    : undefined;
  const status = typeof error === 'object' && error !== null
    ? (error as InvitationErrorLike).status
    : undefined;

  switch (code) {
    case 'INVALID_INVITATION_EMAIL': return copy.t('invalidInvitationEmail');
    case 'INVITATION_ALREADY_PENDING': return copy.t('invitationAlreadyPending');
    case 'INVITATION_NOT_FOUND': return copy.t('invitationNotFound');
    case 'AUTH_REQUIRED':
    case 'UNAUTHORIZED': return copy.t('signInAgain');
    case 'OWNER_REQUIRED':
    case 'FORBIDDEN': return copy.t('permissionDenied');
    case 'RATE_LIMITED':
    case 'TOO_MANY_REQUESTS': return copy.t('rateLimited');
    case 'NETWORK_ERROR': return copy.t('networkError');
    default:
      if (status === 401) return copy.t('signInAgain');
      if (status === 403) return copy.t('permissionDenied');
      if (status === 429) return copy.t('rateLimited');
      return copy.t(fallbackKey);
  }
}
