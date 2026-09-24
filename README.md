# XITERZ VOICE V1

Realtime voice-room prototype menggunakan WebRTC + WebSocket signaling.

## Jalankan lokal

Pastikan Node.js terpasang.

```bash
npm install
npm start
```

Buka:
http://localhost:3000

## Catatan penting

- Browser akan meminta izin microphone.
- Untuk akses microphone lewat internet, gunakan HTTPS.
- Server ini adalah signaling server; audio memakai WebRTC.
- V1 memakai STUN Google sebagai contoh. Untuk koneksi yang lebih kuat di jaringan tertentu, tambahkan TURN server.
- Maksimal 10 anggota per room pada V1.
