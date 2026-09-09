const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function autoSyncGit() {
    const gitDir = path.join(process.cwd(), '.git');
    if (!fs.existsSync(gitDir)) {
        return;
    }

    try {
        console.log('[AUTO-SYNC] Mendeteksi repository git. Memeriksa pembaruan dari GitHub...');
        
        // Pastikan git config safe directory aktif
        try {
            execSync('git config --global --add safe.directory "*" 2>/dev/null || true');
        } catch (_) {}

        // Fetch pembaruan terbaru tanpa merge dulu
        execSync('git fetch origin main', { stdio: 'pipe' });

        // Cek apakah ada commit baru
        const localCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        const remoteCommit = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();

        if (localCommit !== remoteCommit) {
            console.log(`[AUTO-SYNC] Ditemukan pembaruan (${localCommit.slice(0, 7)} -> ${remoteCommit.slice(0, 7)}).`);
            console.log('[AUTO-SYNC] Melakukan sinkronisasi otomatis dan menimpa konflik file lokal...');
            
            // Simpan .env jika ada agar aman
            const envPath = path.join(process.cwd(), '.env');
            let envBackup = null;
            if (fs.existsSync(envPath)) {
                envBackup = fs.readFileSync(envPath);
            }

            // Paksa reset ke remote commit terbaru (mengatasi untracked files conflict)
            execSync('git reset --hard origin/main', { stdio: 'inherit' });
            execSync('git clean -fd -e .env -e auth_info', { stdio: 'inherit' });

            // Kembalikan .env jika sempat terhapus
            if (envBackup && !fs.existsSync(envPath)) {
                fs.writeFileSync(envPath, envBackup);
            }

            console.log('[AUTO-SYNC] Sinkronisasi berhasil! Memulai ulang aplikasi untuk memuat kode baru...');
            process.exit(0); // Keluar dengan kode 0 agar container / PM2 / panel me-restart dengan file baru
        } else {
            console.log('[AUTO-SYNC] Kode lokal sudah versi terbaru.');
        }
    } catch (err) {
        console.warn('[AUTO-SYNC WARNING] Gagal melakukan sinkronisasi otomatis:', err.message);
    }
}

autoSyncGit();
