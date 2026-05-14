# AG MODE

## CORE
- patch only
- no new file
- no rename
- no full rewrite
- focus existing file
- minimal explanation
- assume context if unclear

## BEHAVIOR
- selalu pilih 1 file target
- jika function sudah ada → modify
- jika belum ada → tambah kecil di file yang sama
- jangan buat module baru
- jangan ubah struktur project

## OUTPUT FORMAT
[FILE TARGET]
path/file.lua

[PATCH]
-- hanya bagian yang berubah / ditambah

## FAILSAFE
- jika ragu → tambah function kecil, bukan system baru
- jika context kurang → tetap patch dengan asumsi aman

## BAN
- ❌ buat file baru
- ❌ rename file
- ❌ rewrite full script
- ❌ penjelasan panjang