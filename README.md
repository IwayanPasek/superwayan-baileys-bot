# WhatsApp to API to AI Bot (SuperWayan) 🤖

Bot WhatsApp interaktif berbasis AI yang mendukung eksekusi tindakan otonom (*Autonomous Action Loop*), moderasi grup cerdas, dan integrasi multi-provider AI (**Google Gemini**, **OpenAI ChatGPT**, dan **Anthropic Claude**). Dibangun menggunakan library modern [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys).

---

## 🌟 Fitur Utama

- **Multi-Provider AI**: Beralih antar model AI dengan mudah via konfigurasi `.env` (`gemini`, `openai`, `claude`).
- **Autonomous & Nested Action Loop**: Bot dapat menjalankan analisis bertahap (*Fase Mulai* hingga *Fase Selesai*) untuk tugas-tugas grup yang kompleks.
- **Dukungan Manajemen Anggota**:
  - `KICK`: Mengeluarkan anggota dari grup via tag tunggal (`@user`), banyak tag sekaligus (`@user1 @user2`), maupun instruksi spesifik. Dilengkapi proteksi agar tidak mengeluarkan Owner/Creator, Admin grup, atau Bot itu sendiri.
  - `ADD`: Menambahkan partisipan ke dalam grup (dengan toggle pengaman).
  - `PROMOTE` & `DEMOTE`: Mengangkat atau mencabut status admin grup.
- **Manajemen & Pengaturan Grup**:
  - Ubah nama grup (`SETNAME`) & deskripsi (`SETDESC`).
  - Buka/tutup akses obrolan grup (`OPEN_GROUP` / `CLOSE_GROUP`).
  - Ambil link tautan undangan grup (`LINK`).
  - Keluar dari grup (`LEAVE_GROUP`).
- **Interaksi & Utilitas Obrolan**:
  - Poling grup otomatis (`POLL`).
  - Pengingat terjadwal (`SCHEDULE`).
  - Kirim pesan pribadi / DM (`SEND_DM`).
  - Hapus pesan tertentu atau balasan (`DELETE`).
  - Informasi profil publik anggota (`PROFILE_INFO`).
  - Ringkasan aktivitas grup (*Group Analytics*).
- **Moderasi & Keamanan**:
  - Deteksi dan penghapusan tautan/link otomatis bagi member non-owner.
  - Pembatasan aksi destruktif harian (*Rate Limiting* / *Safety Cap*).
  - Simulasi tanda baca (*Auto-Read*) dan status mengetik (*Composing*).

---

## 📁 Struktur Direktori

```text
├── index.js                      # Entry point utama (Express server & bootloader)
├── package.json                  # Dependensi proyek
├── .env.example                  # Template variabel lingkungan
├── .gitignore                    # Proteksi file rahasia & sesi autentikasi
└── src/
    ├── config/
    │   ├── env.js                # Parser & validasi environment variables
    │   └── prompt.js             # System instruction baku AI
    ├── ai/
    │   └── provider.js           # Multi-provider SDK & timeout handler
    ├── actions/
    │   ├── index.js              # Registry parser aksi & executor
    │   ├── memberActions.js      # Handler KICK, ADD, PROMOTE, DEMOTE
    │   ├── groupActions.js       # Handler manajemen grup
    │   └── messageActions.js     # Handler pesan, DM, poling, schedule
    ├── runners/
    │   ├── singlePrompt.js       # Alur pesan tunggal & retry
    │   └── autonomousLoop.js     # Alur iterasi autonomous loop
    ├── utils/
    │   ├── jid.js                # Utilitas JID, tag, dan partisipan
    │   ├── privileges.js         # Validasi hak akses admin & owner
    │   ├── interaction.js        # Helper mengetik, reaksi, poling, jadwal
    │   ├── moderation.js         # Anti-link & analitik riwayat chat
    │   └── messageHelper.js      # Parser pesan & formatter status
    └── bot/
        └── socket.js             # Koneksi Baileys & event listener
```

---

## 🚀 Panduan Instalasi & Penggunaan

### 1. Prasyarat
- [Node.js](https://nodejs.org/) versi 18 ke atas.
- Nomor WhatsApp aktif yang akan dijadikan bot.

### 2. Kloning & Instalasi Dependensi
```bash
git clone https://github.com/username/whatsapp-to-api-to-ai.git
cd "whatsapp-to-api-to-ai"
npm install
```

### 3. Konfigurasi Lingkungan (`.env`)
Salin file template `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Buka file `.env` dan lengkapi konfigurasi berikut:
```ini
PORT=30493

# Nomor Owner bot (Format internasional tanpa '+', misal 628xxxxxxxxxx)
OWNER_NUMBER=628xxxxxxxxxx
BOT_NUMBER=628xxxxxxxxxx

# Provider AI yang digunakan (gemini / openai / claude)
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
AI_API_KEY=AIzaSy...
```

### 4. Menjalankan Bot
```bash
npm start
```
Saat pertama kali dijalankan, kode QR akan muncul di terminal. Buka WhatsApp di ponsel Anda:
* Buka **Pengaturan** > **Perangkat Tertaut** > **Tautkan Perangkat**, lalu pindai kode QR tersebut.

---

## 🛡️ Keamanan & Privasi

> [!CAUTION]
> **PENTING**: Folder `auth_info/` dan file `.env` berisi kredensial sensitif WhatsApp dan kunci API pribadi Anda. Pastikan kedua entri tersebut selalu terdaftar di `.gitignore` dan **JANGAN PERNAH** mem-push folder `auth_info/` atau file `.env` ke repository publik.

---

## 📄 Lisensi
Didistribusikan di bawah Lisensi [MIT](LICENSE).
