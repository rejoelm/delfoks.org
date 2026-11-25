# Meja Rapat (sumber)

Island React + TypeScript yang dibangun dengan [Dragology](https://github.com/declarative-dragging/dragology) dan dipasang di `meja.html`.

```sh
cd meja-src
npm install
npm run build     # menulis ../assets/meja/meja.js dan meja.css
```

Data diambil dari endpoint Apps Script di `assets/config.js` (`format=json`), sama dengan beranda dan dashboard. Susunan kartu tiap pengunjung disimpan di `localStorage` peramban mereka sendiri.
